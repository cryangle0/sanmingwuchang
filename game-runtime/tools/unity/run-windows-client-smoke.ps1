param(
    [ValidateRange(10, 180)]
    [int] $TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Measure-JwgbImageRegion {
    param(
        [Parameter(Mandatory = $true)]
        [System.Drawing.Bitmap] $Bitmap,

        [Parameter(Mandatory = $true)]
        [int] $XMin,

        [Parameter(Mandatory = $true)]
        [int] $YMin,

        [Parameter(Mandatory = $true)]
        [int] $XMax,

        [Parameter(Mandatory = $true)]
        [int] $YMax,

        [ValidateRange(1, 16)]
        [int] $Stride = 4
    )

    $sampleCount = 0
    $darkPixelCount = 0
    $brightPixelCount = 0
    $saturatedPixelCount = 0
    $greenPixelCount = 0
    $warmPixelCount = 0
    $luminanceSum = 0.0
    $luminanceSquaredSum = 0.0
    $uniqueColors = [System.Collections.Generic.HashSet[int]]::new()

    for ($y = $YMin; $y -lt $YMax; $y += $Stride) {
        for ($x = $XMin; $x -lt $XMax; $x += $Stride) {
            $color = $Bitmap.GetPixel($x, $y)
            $sampleCount++
            [void] $uniqueColors.Add($color.ToArgb())

            $maximumChannel = [Math]::Max(
                $color.R,
                [Math]::Max($color.G, $color.B)
            )
            $minimumChannel = [Math]::Min(
                $color.R,
                [Math]::Min($color.G, $color.B)
            )
            $luminance = (
                (0.2126 * $color.R) +
                (0.7152 * $color.G) +
                (0.0722 * $color.B)
            )
            $luminanceSum += $luminance
            $luminanceSquaredSum += $luminance * $luminance

            if ($luminance -lt 30) {
                $darkPixelCount++
            }
            if ($luminance -gt 180) {
                $brightPixelCount++
            }
            if (
                ($maximumChannel - $minimumChannel) -gt 50 -and
                $maximumChannel -gt 110
            ) {
                $saturatedPixelCount++
            }
            if (
                $color.G -gt ($color.R + 35) -and
                $color.G -gt ($color.B + 20) -and
                $color.G -gt 100
            ) {
                $greenPixelCount++
            }
            if (
                (
                    $color.R -gt ($color.G + 35) -and
                    $color.R -gt ($color.B + 35) -and
                    $color.R -gt 130
                ) -or (
                    $color.R -gt 180 -and
                    $color.G -gt 80 -and
                    $color.B -lt 80
                )
            ) {
                $warmPixelCount++
            }
        }
    }

    $meanLuminance = $luminanceSum / $sampleCount
    $luminanceVariance = [Math]::Max(
        0,
        ($luminanceSquaredSum / $sampleCount) -
            ($meanLuminance * $meanLuminance)
    )
    [pscustomobject] @{
        SampleCount = $sampleCount
        UniqueColorCount = $uniqueColors.Count
        MeanLuminance = $meanLuminance
        LuminanceStandardDeviation = [Math]::Sqrt($luminanceVariance)
        DarkPixelCount = $darkPixelCount
        DarkPixelRatio = $darkPixelCount / $sampleCount
        BrightPixelCount = $brightPixelCount
        BrightPixelRatio = $brightPixelCount / $sampleCount
        SaturatedPixelCount = $saturatedPixelCount
        GreenPixelCount = $greenPixelCount
        WarmPixelCount = $warmPixelCount
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'BuildArtifactVerification.ps1')

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)
$projectPath = Join-Path $repositoryRoot 'unity'
$artifact = Get-JwgbBuildArtifact `
    -Target 'windows' `
    -ProjectPath $projectPath
if (-not (Test-Path -LiteralPath $artifact.ExecutablePath -PathType Leaf)) {
    throw 'Windows client is missing. Run npm run unity:build:windows first.'
}

$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
$reportPath = Join-Path $reportDirectory 'windows-live-smoke.json'
$screenshotPath = Join-Path $reportDirectory 'windows-live-smoke.png'
$logPath = Join-Path $projectPath 'Logs\windows-live-smoke.log'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force |
    Out-Null
foreach ($path in @($reportPath, $screenshotPath, $logPath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

$arguments = @(
    '-screen-fullscreen', '0',
    '-screen-width', '1280',
    '-screen-height', '720',
    '-logFile', $logPath,
    '-jwgbAutoStartLocal',
    '-jwgbLiveSmokeReport', $reportPath,
    '-jwgbLiveSmokeScreenshot', $screenshotPath
)
$process = Start-Process `
    -FilePath $artifact.ExecutablePath `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -PassThru
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force
    throw "Windows client smoke exceeded $TimeoutSeconds seconds."
}
if ($process.ExitCode -ne 0) {
    throw "Windows client smoke exited with code $($process.ExitCode)."
}

if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
    throw "Live smoke report is missing: $reportPath"
}
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($report.schema -ne 'jwgb.unity.live-smoke.v2') {
    throw "Unexpected live smoke schema: $($report.schema)"
}
if ($report.mode -ne 'local-authoritative-simulation') {
    throw "Unexpected live smoke mode: $($report.mode)"
}
if ($report.tick -lt 120) {
    throw "Live smoke ended too early at tick $($report.tick)."
}
if ($report.playerCount -ne 8) {
    throw "Expected 8 live players, got $($report.playerCount)."
}
if ([string]::IsNullOrWhiteSpace($report.stateHash)) {
    throw 'Live smoke state hash is empty.'
}
if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) {
    throw "Live smoke screenshot is missing: $screenshotPath"
}
$screenshot = Get-Item -LiteralPath $screenshotPath
if ($screenshot.Length -le 10KB) {
    throw "Live smoke screenshot is unexpectedly small: $($screenshot.Length)"
}

Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::FromFile($screenshotPath)
try {
    if (
        $bitmap.Width -ne $report.screenWidth -or
        $bitmap.Height -ne $report.screenHeight
    ) {
        throw (
            'Live smoke screenshot dimensions do not match the report: ' +
            "$($bitmap.Width)x$($bitmap.Height) versus " +
            "$($report.screenWidth)x$($report.screenHeight)."
        )
    }

    $fullImage = Measure-JwgbImageRegion `
        -Bitmap $bitmap `
        -XMin 0 `
        -YMin 0 `
        -XMax $bitmap.Width `
        -YMax $bitmap.Height `
        -Stride 4
    $topHud = Measure-JwgbImageRegion `
        -Bitmap $bitmap `
        -XMin 0 `
        -YMin 0 `
        -XMax $bitmap.Width `
        -YMax ([int] ($bitmap.Height * 0.18)) `
        -Stride 2
    $bottomHud = Measure-JwgbImageRegion `
        -Bitmap $bitmap `
        -XMin 0 `
        -YMin ([int] ($bitmap.Height * 0.78)) `
        -XMax $bitmap.Width `
        -YMax $bitmap.Height `
        -Stride 2
    $battlefield = Measure-JwgbImageRegion `
        -Bitmap $bitmap `
        -XMin ([int] ($bitmap.Width * 0.15)) `
        -YMin ([int] ($bitmap.Height * 0.15)) `
        -XMax ([int] ($bitmap.Width * 0.85)) `
        -YMax ([int] ($bitmap.Height * 0.82)) `
        -Stride 2

    if ($fullImage.UniqueColorCount -lt 64) {
        throw (
            'Live smoke screenshot has too little color diversity: ' +
            "$($fullImage.UniqueColorCount) sampled colors."
        )
    }
    if ($fullImage.LuminanceStandardDeviation -lt 8) {
        throw (
            'Live smoke screenshot is blank or nearly uniform: luminance ' +
            "standard deviation $($fullImage.LuminanceStandardDeviation)."
        )
    }
    if (
        $fullImage.DarkPixelRatio -lt 0.02 -or
        $fullImage.BrightPixelRatio -lt 0.0004
    ) {
        throw 'Live smoke screenshot is missing expected HUD contrast.'
    }
    if (
        $topHud.DarkPixelRatio -lt 0.04 -or
        $topHud.BrightPixelRatio -lt 0.0005 -or
        $bottomHud.DarkPixelRatio -lt 0.04 -or
        $bottomHud.BrightPixelRatio -lt 0.0005
    ) {
        throw 'Live smoke screenshot is missing the top or bottom HUD.'
    }
    if (
        $battlefield.SaturatedPixelCount -lt 30 -or
        $battlefield.GreenPixelCount -lt 4 -or
        $battlefield.WarmPixelCount -lt 10
    ) {
        throw 'Live smoke screenshot is missing expected battlefield actors.'
    }
} finally {
    $bitmap.Dispose()
}

$fatalLogPatterns = @(
    '(?im)^\s*(?:NullReferenceException|MissingReferenceException|' +
        'ArgumentException|InvalidOperationException|' +
        'TypeInitializationException|DllNotFoundException|' +
        'EntryPointNotFoundException|IndexOutOfRangeException|' +
        'UnityException):',
    '(?im)^\s*(?:Shader error|Assertion failed|Crash!!!)\b',
    '(?im)^.*Theme.*(?:not found|missing).*$',
    '(?im)^.*Shader.*(?:not found|unsupported).*$'
)
$logText = Get-Content -LiteralPath $logPath -Raw
$fatalLogMatches = @(foreach ($pattern in $fatalLogPatterns) {
    [regex]::Matches($logText, $pattern) | ForEach-Object { $_.Value.Trim() }
})
if ($fatalLogMatches.Count -gt 0) {
    throw (
        "Windows client smoke log contains fatal entries:`n" +
        ($fatalLogMatches -join "`n")
    )
}

$formattedReport = Format-JwgbJson (
    $report |
        ConvertTo-Json -Depth 4 -Compress
)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    $reportPath,
    $formattedReport + "`n",
    $utf8WithoutBom
)

Write-Output (
    'Windows live smoke passed: ' +
    "tick $($report.tick), $($report.playerCount) players, " +
    "hash $($report.stateHash), " +
    "$($fullImage.UniqueColorCount) sampled colors."
)
