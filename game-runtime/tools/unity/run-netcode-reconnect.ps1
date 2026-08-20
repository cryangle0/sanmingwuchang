param(
    [ValidateRange(30, 120)]
    [int] $TimeoutSeconds = 60,

    [ValidateRange(1, 65535)]
    [int] $Port = 7979,

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
$windowsArtifact = Get-JwgbBuildArtifact `
    -Target 'windows' `
    -ProjectPath $projectPath
$linuxArtifact = Get-JwgbBuildArtifact `
    -Target 'linux-server' `
    -ProjectPath $projectPath
if (-not (
    Test-Path -LiteralPath $windowsArtifact.ExecutablePath -PathType Leaf
)) {
    throw 'Windows client is missing. Run npm run unity:build:windows first.'
}
if (-not (
    Test-Path -LiteralPath $linuxArtifact.ExecutablePath -PathType Leaf
)) {
    throw (
        'Linux server is missing. ' +
        'Run npm run unity:build:linux-server first.'
    )
}

function ConvertTo-WslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $WindowsPath
    )

    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($fullPath -notmatch '^(?<drive>[A-Za-z]):\\(?<path>.*)$') {
        throw (
            'WSL reconnect smoke requires a drive-letter path: ' +
            $fullPath
        )
    }
    $drive = $Matches.drive.ToLowerInvariant()
    $relativePath = $Matches.path.Replace('\', '/')
    return "/mnt/$drive/$relativePath"
}

function Get-WslClientAddress {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Distribution
    )

    $networkingMode = & wsl.exe `
        -d $Distribution `
        -- `
        sh -lc "command -v wslinfo >/dev/null 2>&1 && wslinfo --networking-mode || true"
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to query WSL networking mode for $Distribution."
    }
    if (([string] $networkingMode).Trim() -eq 'mirrored') {
        return '127.0.0.1'
    }

    $routeOutput = & wsl.exe `
        -d $Distribution `
        -- `
        sh -lc "ip -4 route get 1.1.1.1 | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -n 1"
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to query WSL IPv4 address for $Distribution."
    }
    return ([string] $routeOutput).Trim()
}

function Assert-NoFatalUnityLog {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [string] $Label
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label log is missing: $Path"
    }
    $patterns = @(
        '(?im)^\s*(?:NullReferenceException|MissingReferenceException|' +
            'ArgumentException|InvalidOperationException|' +
            'TypeInitializationException|DllNotFoundException|' +
            'EntryPointNotFoundException|IndexOutOfRangeException|' +
            'UnityException):',
        '(?im)^\s*(?:Shader error|Assertion failed|Crash!!!)\b'
    )
    $text = Get-Content -LiteralPath $Path -Raw
    $matches = @(foreach ($pattern in $patterns) {
        [regex]::Matches($text, $pattern) |
            ForEach-Object { $_.Value.Trim() }
    })
    if ($matches.Count -gt 0) {
        throw "$Label log contains fatal entries:`n$($matches -join "`n")"
    }
}

function Start-ReconnectClient {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ReportPath,

        [Parameter(Mandatory = $true)]
        [string] $LogPath,

        [Parameter(Mandatory = $true)]
        [int] $MinimumTick,

        [string] $ReconnectTicket,

        [int] $LastEventMatchSequence = 0,

        [int] $LastEventCursor = 0
    )

    $arguments = @(
        '-batchmode',
        '-nographics',
        '-logFile', $LogPath,
        '-jwgbNetworkClient',
        '-jwgbHeroId', 'H038',
        '-jwgbServerAddress', $serverAddress,
        '-jwgbServerPort', $Port,
        '-jwgbNetworkSmokeReport', $ReportPath,
        '-jwgbNetworkSmokeMinTick', $MinimumTick,
        '-jwgbNetworkSmokeTimeoutSeconds', ($TimeoutSeconds - 10)
    )
    if (-not [string]::IsNullOrWhiteSpace($ReconnectTicket)) {
        $arguments += @(
            '-jwgbReconnectTicket',
            $ReconnectTicket,
            '-jwgbLastEventMatchSequence',
            $LastEventMatchSequence,
            '-jwgbLastEventCursor',
            $LastEventCursor
        )
    }
    return Start-Process `
        -FilePath $windowsArtifact.ExecutablePath `
        -ArgumentList $arguments `
        -WindowStyle Hidden `
        -PassThru
}

$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
$logDirectory = Join-Path $projectPath 'Logs'
$serverReportPath = Join-Path $reportDirectory (
    'netcode-reconnect-server-smoke.json'
)
$initialReportPath = Join-Path $reportDirectory (
    'netcode-reconnect-initial-client.json'
)
$resumedReportPath = Join-Path $reportDirectory (
    'netcode-reconnect-resumed-client.json'
)
$summaryReportPath = Join-Path $reportDirectory (
    'netcode-reconnect-smoke.json'
)
$serverLogPath = Join-Path $logDirectory (
    'netcode-reconnect-server-smoke.log'
)
$initialLogPath = Join-Path $logDirectory (
    'netcode-reconnect-initial-client.log'
)
$resumedLogPath = Join-Path $logDirectory (
    'netcode-reconnect-resumed-client.log'
)
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
foreach ($path in @(
    $serverReportPath,
    $initialReportPath,
    $resumedReportPath,
    $summaryReportPath,
    $serverLogPath,
    $initialLogPath,
    $resumedLogPath
)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

$serverAddress = Get-WslClientAddress -Distribution $WslDistribution
$linuxBuildDirectory = ConvertTo-WslPath $linuxArtifact.OutputDirectory
$linuxServerReportPath = ConvertTo-WslPath $serverReportPath
$linuxServerLogPath = ConvertTo-WslPath $serverLogPath
$serverArguments = @(
    '-d', $WslDistribution,
    '--cd', $linuxBuildDirectory,
    '--',
    './JourneyWestGreatBrawl.x86_64',
    '-batchmode',
    '-nographics',
    '-logFile', $linuxServerLogPath,
    '-jwgbNetworkServer',
    '-jwgbServerAddress', '0.0.0.0',
    '-jwgbServerPort', $Port,
    '-jwgbServerSmokeReport', $linuxServerReportPath,
    '-jwgbServerSmokeTick', 260,
    '-jwgbSeed', 20260724,
    '-jwgbCompetitors', 30
)

$serverProcess = $null
$initialProcess = $null
$resumedProcess = $null
try {
    $serverProcess = Start-Process `
        -FilePath 'wsl.exe' `
        -ArgumentList $serverArguments `
        -WindowStyle Hidden `
        -PassThru
    Start-Sleep -Seconds 2
    if ($serverProcess.HasExited) {
        throw (
            'Reconnect server exited before the first client, code ' +
            "$($serverProcess.ExitCode)."
        )
    }

    $initialProcess = Start-ReconnectClient `
        -ReportPath $initialReportPath `
        -LogPath $initialLogPath `
        -MinimumTick 80
    if (-not $initialProcess.WaitForExit($TimeoutSeconds * 1000)) {
        throw 'Initial reconnect client timed out.'
    }
    if ($initialProcess.ExitCode -ne 0) {
        throw (
            'Initial reconnect client exited with code ' +
            "$($initialProcess.ExitCode)."
        )
    }
    if (-not (
        Test-Path -LiteralPath $initialReportPath -PathType Leaf
    )) {
        throw "Initial reconnect report is missing: $initialReportPath"
    }
    $initialReport =
        Get-Content -LiteralPath $initialReportPath -Raw |
            ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($initialReport.reconnectTicket)) {
        throw 'Initial reconnect client received no ticket.'
    }
    if ($initialReport.resumedSession) {
        throw 'Initial reconnect client was incorrectly marked resumed.'
    }

    Start-Sleep -Seconds 2
    $resumedProcess = Start-ReconnectClient `
        -ReportPath $resumedReportPath `
        -LogPath $resumedLogPath `
        -MinimumTick 180 `
        -ReconnectTicket $initialReport.reconnectTicket `
        -LastEventMatchSequence $initialReport.eventMatchSequence `
        -LastEventCursor $initialReport.lastEventCursor
    if (-not $resumedProcess.WaitForExit($TimeoutSeconds * 1000)) {
        throw 'Resumed reconnect client timed out.'
    }
    if ($resumedProcess.ExitCode -ne 0) {
        throw (
            'Resumed reconnect client exited with code ' +
            "$($resumedProcess.ExitCode)."
        )
    }
    if (-not (
        Test-Path -LiteralPath $resumedReportPath -PathType Leaf
    )) {
        throw "Resumed reconnect report is missing: $resumedReportPath"
    }
    $resumedReport =
        Get-Content -LiteralPath $resumedReportPath -Raw |
            ConvertFrom-Json

    if (-not $serverProcess.WaitForExit($TimeoutSeconds * 1000)) {
        throw 'Reconnect server timed out.'
    }
    if ($serverProcess.ExitCode -ne 0) {
        throw (
            'Reconnect server exited with code ' +
            "$($serverProcess.ExitCode)."
        )
    }
} finally {
    foreach ($process in @(
        $initialProcess,
        $resumedProcess,
        $serverProcess
    )) {
        if ($process -ne $null -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force
        }
    }
}

if ($resumedReport.schema -ne 'jwgb.unity.netcode-client-smoke.v9') {
    throw "Unexpected resumed schema: $($resumedReport.schema)"
}
if (-not $resumedReport.resumedSession) {
    throw 'Second client was not marked as a resumed session.'
}
if (
    $initialReport.requestedHeroId -ne 'H038' -or
    $initialReport.assignedHeroId -ne 'H038' -or
    $resumedReport.assignedHeroId -ne 'H038'
) {
    throw 'Reconnect did not preserve the requested hero assignment.'
}
if (
    $resumedReport.localEntityId -ne
        $initialReport.localEntityId
) {
    throw (
        'Reconnect changed the controlled entity: ' +
        "$($initialReport.localEntityId) to " +
        "$($resumedReport.localEntityId)."
    )
}
if (
    $resumedReport.reconnectTicket -ne
        $initialReport.reconnectTicket
) {
    throw 'Reconnect ticket changed during session resume.'
}
if ($resumedReport.ghostSnapshotTick -lt 180) {
    throw (
        'Resumed client stopped too early at Ghost tick ' +
        "$($resumedReport.ghostSnapshotTick)."
    )
}
if ($resumedReport.playerGhostCount -ne 30) {
    throw 'Resumed client did not reconstruct the 30-player world.'
}
if ($resumedReport.receivedReplayEventRpcCount -lt 1) {
    throw 'Resumed client received no replayed disconnect-window events.'
}
if (
    $resumedReport.lastEventCursor -le
        $initialReport.lastEventCursor
) {
    throw (
        'Resumed client event cursor did not advance: ' +
        "$($initialReport.lastEventCursor) to " +
        "$($resumedReport.lastEventCursor)."
    )
}

if (-not (Test-Path -LiteralPath $serverReportPath -PathType Leaf)) {
    throw "Reconnect server report is missing: $serverReportPath"
}
$serverReport =
    Get-Content -LiteralPath $serverReportPath -Raw |
        ConvertFrom-Json
if ($serverReport.receivedJoinRpcCount -lt 2) {
    throw 'Reconnect server did not receive both join RPCs.'
}
if ($serverReport.issuedReconnectTicketCount -ne 1) {
    throw (
        'Reconnect server should issue one ticket, got ' +
        "$($serverReport.issuedReconnectTicketCount)."
    )
}
if ($serverReport.resumedJoinRpcCount -ne 1) {
    throw (
        'Reconnect server should resume one join, got ' +
        "$($serverReport.resumedJoinRpcCount)."
    )
}
if ($serverReport.acceptedInputRpcCount -lt 20) {
    throw 'Reconnect server accepted too few client inputs.'
}
if ($serverReport.appliedExternalInputCount -le 0) {
    throw 'Reconnect server applied no external inputs to the Sim.'
}
if (
    $serverReport.lastAppliedExternalInputSequence -le
        $initialReport.latestSentInputSequence
) {
    throw (
        'Reconnect server did not apply inputs after resume: ' +
        "$($serverReport.lastAppliedExternalInputSequence) <= " +
        "$($initialReport.latestSentInputSequence)."
    )
}

Assert-NoFatalUnityLog `
    -Path $initialLogPath `
    -Label 'Initial reconnect client'
Assert-NoFatalUnityLog `
    -Path $resumedLogPath `
    -Label 'Resumed reconnect client'
Assert-NoFatalUnityLog `
    -Path $serverLogPath `
    -Label 'Reconnect server'

$summary = [pscustomobject] @{
    schema = 'jwgb.unity.netcode-reconnect-smoke.v1'
    initialNetworkId = $initialReport.networkId
    resumedNetworkId = $resumedReport.networkId
    controlledEntityId = $resumedReport.localEntityId
    reconnectTicket = $resumedReport.reconnectTicket
    initialGhostTick = $initialReport.ghostSnapshotTick
    resumedGhostTick = $resumedReport.ghostSnapshotTick
    serverTick = $serverReport.tick
    receivedJoinRpcCount = $serverReport.receivedJoinRpcCount
    issuedReconnectTicketCount =
        $serverReport.issuedReconnectTicketCount
    resumedJoinRpcCount = $serverReport.resumedJoinRpcCount
    acceptedInputRpcCount = $serverReport.acceptedInputRpcCount
    appliedExternalInputCount =
        $serverReport.appliedExternalInputCount
    lastAppliedExternalInputSequence =
        $serverReport.lastAppliedExternalInputSequence
    initialEventCursor = $initialReport.lastEventCursor
    resumedEventCursor = $resumedReport.lastEventCursor
    replayedEventRpcCount =
        $resumedReport.receivedReplayEventRpcCount
}
$formattedSummary = Format-JwgbJson (
    $summary | ConvertTo-Json -Depth 4 -Compress
)
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText(
    $summaryReportPath,
    $formattedSummary + "`n",
    $utf8WithoutBom
)

Write-Output (
    'Netcode reconnect smoke passed: network connection ' +
    "$($initialReport.networkId) disconnected, connection " +
    "$($resumedReport.networkId) resumed entity " +
    "$($resumedReport.localEntityId) with the issued session ticket."
)
