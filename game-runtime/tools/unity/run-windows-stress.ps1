param(
    [ValidateRange(0, 300)]
    [double] $WarmupSeconds = 3,

    [ValidateRange(1, 600)]
    [double] $SampleSeconds = 15,

    [ValidateRange(10, 900)]
    [int] $TimeoutSeconds = 90
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
    -Target 'windows-stress' `
    -ProjectPath $projectPath
if (-not (Test-Path -LiteralPath $artifact.ExecutablePath -PathType Leaf)) {
    throw (
        'Windows stress Player is missing. Run ' +
        'npm run unity:build:windows-stress first.'
    )
}

$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
$reportPath = Join-Path $reportDirectory 'performance-windows-stress.json'
$screenshotPath = Join-Path $reportDirectory 'performance-windows-stress.png'
$logPath = Join-Path $projectPath 'Logs\windows-stress-player.log'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
New-Item `
    -ItemType Directory `
    -Path (Split-Path -Parent $logPath) `
    -Force |
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
    '-jwgbPerformanceReport', $reportPath,
    '-jwgbPerformanceScreenshot', $screenshotPath,
    '-jwgbPerformanceSampleLabel',
    'windows-hidden-automated-validation',
    '-jwgbPerformanceWarmupSeconds',
    $WarmupSeconds.ToString(
        [System.Globalization.CultureInfo]::InvariantCulture),
    '-jwgbPerformanceSampleSeconds',
    $SampleSeconds.ToString(
        [System.Globalization.CultureInfo]::InvariantCulture),
    '-jwgbQuitAfterPerformanceSample'
)
$process = Start-Process `
    -FilePath $artifact.ExecutablePath `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -PassThru
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force
    throw "Windows stress Player exceeded $TimeoutSeconds seconds."
}

if ($process.ExitCode -ne 0) {
    throw "Windows stress Player exited with code $($process.ExitCode)."
}

if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
    throw "Performance report is missing: $reportPath"
}

$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($report.schema -ne 'jwgb.unity.synthetic-performance.v1') {
    throw "Unexpected performance report schema: $($report.schema)"
}

if ($report.renderedAgentCount -ne 423) {
    throw (
        'Expected 423 rendered agents, got ' +
        "$($report.renderedAgentCount)."
    )
}

if ($report.frameTimeMs.count -le 0) {
    throw 'Performance report contains no frame samples.'
}

if ($report.droppedFrameSamples -ne 0) {
    throw (
        'Performance report dropped ' +
        "$($report.droppedFrameSamples) frame samples."
    )
}

if (-not (Test-Path -LiteralPath $screenshotPath -PathType Leaf)) {
    throw "Performance screenshot is missing: $screenshotPath"
}

$screenshot = Get-Item -LiteralPath $screenshotPath
if ($screenshot.Length -le 10KB) {
    throw "Performance screenshot is unexpectedly small: $($screenshot.Length)"
}

Write-Output (
    'Windows stress sample passed: ' +
    "$($report.renderedAgentCount) agents, " +
    "$($report.frameTimeMs.count) frames, " +
    "p95 $([Math]::Round($report.frameTimeMs.p95, 3)) ms."
)
