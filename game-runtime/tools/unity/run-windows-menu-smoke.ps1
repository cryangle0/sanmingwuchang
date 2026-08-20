param(
    [ValidateRange(10, 180)]
    [int] $TimeoutSeconds = 60
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

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
$reportPath = Join-Path $reportDirectory 'windows-menu-smoke.json'
$screenshotPath = Join-Path $reportDirectory 'windows-menu-smoke.png'
$logPath = Join-Path $projectPath 'Logs\windows-menu-smoke.log'
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
    '-jwgbMenuSmokeReport', $reportPath,
    '-jwgbMenuSmokeScreenshot', $screenshotPath
)
$process = Start-Process `
    -FilePath $artifact.ExecutablePath `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -PassThru
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force
    throw "Windows menu smoke exceeded $TimeoutSeconds seconds."
}
if ($process.ExitCode -ne 0) {
    throw "Windows menu smoke exited with code $($process.ExitCode)."
}

if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
    throw "Menu smoke report is missing: $reportPath"
}
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($report.schema -ne 'jwgb.unity.menu-smoke.v4') {
    throw "Unexpected menu smoke schema: $($report.schema)"
}
if (
    $report.heroChoiceCount -ne 38 -or
    $report.firstHeroId -ne 'H001' -or
    $report.lastHeroId -ne 'H038' -or
    $report.selectedHeroId -ne 'H038'
) {
    throw (
        'Expected all H001-H038 hero choices and H038 selection, got ' +
        "$($report.heroChoiceCount) choices " +
        "$($report.firstHeroId)-$($report.lastHeroId), " +
        "selected $($report.selectedHeroId)."
    )
}
if (
    -not $report.localModeButtonPresent -or
    -not $report.onlineModeButtonPresent -or
    -not $report.onlineControlsPresent -or
    -not $report.reconnectControlsPresent
) {
    throw 'Menu is missing matchmaking or reconnect controls.'
}
if (
    $report.competitorMinimum -ne 2 -or
    $report.competitorMaximum -ne 30 -or
    $report.defaultCompetitorCount -ne 8
) {
    throw (
        'Unexpected competitor selector range/default: ' +
        "$($report.competitorMinimum)-$($report.competitorMaximum), " +
        "default $($report.defaultCompetitorCount)."
    )
}
if (-not $report.startButtonVisible) {
    throw 'Menu start button is not visible.'
}
if ($report.hasActiveSession) {
    throw 'Default client menu started a match before player confirmation.'
}
if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) {
    throw "Menu smoke screenshot is missing: $screenshotPath"
}
$screenshot = Get-Item -LiteralPath $screenshotPath
if ($screenshot.Length -le 10KB) {
    throw "Menu smoke screenshot is unexpectedly small: $($screenshot.Length)"
}

Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::FromFile($screenshotPath)
try {
    if (
        $bitmap.Width -ne $report.screenWidth -or
        $bitmap.Height -ne $report.screenHeight
    ) {
        throw (
            'Menu screenshot dimensions do not match the report: ' +
            "$($bitmap.Width)x$($bitmap.Height) versus " +
            "$($report.screenWidth)x$($report.screenHeight)."
        )
    }

    $sampleCount = 0
    $darkCount = 0
    $brightCount = 0
    $warmCount = 0
    $uniqueColors = [System.Collections.Generic.HashSet[int]]::new()
    for ($y = 0; $y -lt $bitmap.Height; $y += 4) {
        for ($x = 0; $x -lt $bitmap.Width; $x += 4) {
            $color = $bitmap.GetPixel($x, $y)
            $sampleCount++
            [void] $uniqueColors.Add($color.ToArgb())
            $luminance = (
                (0.2126 * $color.R) +
                (0.7152 * $color.G) +
                (0.0722 * $color.B)
            )
            if ($luminance -lt 35) {
                $darkCount++
            }
            if ($luminance -gt 180) {
                $brightCount++
            }
            if (
                $color.R -gt 170 -and
                $color.G -gt 60 -and
                $color.G -lt 150 -and
                $color.B -lt 80
            ) {
                $warmCount++
            }
        }
    }
    if ($uniqueColors.Count -lt 48) {
        throw (
            'Menu screenshot has too little color diversity: ' +
            "$($uniqueColors.Count) sampled colors."
        )
    }
    if (
        ($darkCount / $sampleCount) -lt 0.5 -or
        $brightCount -lt 20 -or
        $warmCount -lt 20
    ) {
        throw 'Menu screenshot is missing expected contrast or selection color.'
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
    '(?im)^\s*(?:Shader error|Assertion failed|Crash!!!)\b'
)
$logText = Get-Content -LiteralPath $logPath -Raw
$fatalLogMatches = @(foreach ($pattern in $fatalLogPatterns) {
    [regex]::Matches($logText, $pattern) |
        ForEach-Object { $_.Value.Trim() }
})
if ($fatalLogMatches.Count -gt 0) {
    throw (
        "Windows menu smoke log contains fatal entries:`n" +
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
    'Windows menu smoke passed: local/online modes, H001-H038 heroes, ' +
    'competitor range 2-30, ' +
    "$($uniqueColors.Count) sampled colors."
)
