param(
    [ValidateRange(10, 120)]
    [int] $TimeoutSeconds = 30,

    [ValidateRange(20, 10000)]
    [int] $CaptureTick = 120,

    [ValidateRange(2, 30)]
    [int] $CompetitorCount = 30,

    [string] $WslDistribution = 'Ubuntu-22.04'
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
    -Target 'linux-server' `
    -ProjectPath $projectPath
if (-not (Test-Path -LiteralPath $artifact.ExecutablePath -PathType Leaf)) {
    throw 'Linux server is missing. Run npm run unity:build:linux-server first.'
}

$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
$reportPath = Join-Path $reportDirectory 'linux-server-live-smoke.json'
$logPath = Join-Path $projectPath 'Logs\linux-server-live-smoke.log'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $logPath) -Force |
    Out-Null
foreach ($path in @($reportPath, $logPath)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

function ConvertTo-WslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $WindowsPath
    )

    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($fullPath -notmatch '^(?<drive>[A-Za-z]):\\(?<path>.*)$') {
        throw "WSL smoke requires a drive-letter path: $fullPath"
    }

    $drive = $Matches.drive.ToLowerInvariant()
    $relativePath = $Matches.path.Replace('\', '/')
    return "/mnt/$drive/$relativePath"
}

$linuxBuildDirectory = ConvertTo-WslPath $artifact.OutputDirectory
$linuxReportPath = ConvertTo-WslPath $reportPath
$linuxLogPath = ConvertTo-WslPath $logPath
$arguments = @(
    '-d', $WslDistribution,
    '--cd', $linuxBuildDirectory,
    '--',
    './JourneyWestGreatBrawl.x86_64',
    '-batchmode',
    '-nographics',
    '-logFile', $linuxLogPath,
    '-jwgbServerSmokeReport', $linuxReportPath,
    '-jwgbServerSmokeTick', $CaptureTick,
    '-jwgbSeed', 20260724,
    '-jwgbCompetitors', $CompetitorCount
)
$process = Start-Process `
    -FilePath 'wsl.exe' `
    -ArgumentList $arguments `
    -WindowStyle Hidden `
    -PassThru
if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force
    throw "Linux server smoke exceeded $TimeoutSeconds seconds."
}
if ($process.ExitCode -ne 0) {
    throw "Linux server smoke exited with code $($process.ExitCode)."
}

if (-not (Test-Path -LiteralPath $reportPath -PathType Leaf)) {
    throw "Linux server smoke report is missing: $reportPath"
}
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
if ($report.schema -ne 'jwgb.unity.server-live-smoke.v3') {
    throw "Unexpected server smoke schema: $($report.schema)"
}
if (
    $report.mode -ne
        'authoritative-simulation-netcode-runtime-ghosts'
) {
    throw "Unexpected server mode: $($report.mode)"
}
if (-not $report.networkListening) {
    throw 'Linux server did not report an active listening interface.'
}
if ($report.networkPort -ne 7979) {
    throw "Expected Linux server port 7979, got $($report.networkPort)."
}
if ($report.tick -lt $CaptureTick) {
    throw "Linux server ended too early at tick $($report.tick)."
}
if ($report.configuredCompetitors -ne $CompetitorCount) {
    throw (
        "Expected $CompetitorCount configured competitors, got " +
        "$($report.configuredCompetitors)."
    )
}
if ($report.playerCount -ne $CompetitorCount) {
    throw (
        "Expected $CompetitorCount server players, got " +
        "$($report.playerCount)."
    )
}
if ([string]::IsNullOrWhiteSpace($report.stateHash)) {
    throw 'Linux server smoke state hash is empty.'
}
if (-not $report.ghostRegistrationComplete) {
    throw 'Linux server did not register runtime Ghost prefabs.'
}
if ($report.replicatedGhostSnapshotTick -ne $report.tick) {
    throw (
        'Linux server replicated Ghost tick does not match the captured ' +
        "snapshot: $($report.replicatedGhostSnapshotTick) vs " +
        "$($report.tick)."
    )
}
if ($report.replicatedWorldGhostCount -ne 1) {
    throw (
        'Linux server did not project exactly one MatchWorld Ghost: ' +
        "$($report.replicatedWorldGhostCount)."
    )
}
if ($report.replicatedPlayerGhostCount -ne $report.playerCount) {
    throw (
        'Linux server Player Ghost count does not match the snapshot: ' +
        "$($report.replicatedPlayerGhostCount) vs " +
        "$($report.playerCount)."
    )
}
if (
    $report.replicatedProjectileGhostCount -ne
        $report.projectileCount
) {
    throw (
        'Linux server Projectile Ghost count does not match the ' +
        "snapshot: $($report.replicatedProjectileGhostCount) vs " +
        "$($report.projectileCount)."
    )
}
if (
    $report.replicatedWindWallGhostCount -ne
        $report.windWallCount
) {
    throw (
        'Linux server WindWall Ghost count does not match the snapshot: ' +
        "$($report.replicatedWindWallGhostCount) vs " +
        "$($report.windWallCount)."
    )
}
if ($report.peakReplicatedGhostCount -lt $CompetitorCount) {
    throw (
        'Linux server peak replicated Ghost count never covered the ' +
        "full roster: $($report.peakReplicatedGhostCount)."
    )
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
        "Linux server smoke log contains fatal entries:`n" +
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
    'Linux server live smoke passed: ' +
    "tick $($report.tick), $($report.playerCount) players, " +
    "hash $($report.stateHash), peak replicated Ghosts " +
    "$($report.peakReplicatedGhostCount), mode $($report.mode)."
)
