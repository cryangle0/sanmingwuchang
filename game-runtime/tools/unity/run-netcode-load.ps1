param(
    [ValidateRange(2, 30)]
    [int] $ClientCount = 30,

    [ValidateRange(120, 1200)]
    [int] $ClientTargetTick = 360,

    [ValidateRange(180, 1400)]
    [int] $ServerCaptureTick = 600,

    [ValidateRange(60, 240)]
    [int] $TimeoutSeconds = 120,

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
if ($ServerCaptureTick -le $ClientTargetTick) {
    throw 'ServerCaptureTick must be greater than ClientTargetTick.'
}

function ConvertTo-WslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $WindowsPath
    )

    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($fullPath -notmatch '^(?<drive>[A-Za-z]):\\(?<path>.*)$') {
        throw "WSL load smoke requires a drive-letter path: $fullPath"
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
    $address = ([string] $routeOutput).Trim()
    $parsedAddress = $null
    if (-not (
        [System.Net.IPAddress]::TryParse(
            $address,
            [ref] $parsedAddress
        )
    )) {
        throw "WSL returned an invalid IPv4 address: $address"
    }
    return $address
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

function Write-FormattedJson {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [object] $Value
    )

    $json = Format-JwgbJson (
        $Value | ConvertTo-Json -Depth 5 -Compress
    )
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $Path,
        $json + "`n",
        $utf8WithoutBom
    )
}

$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
$logDirectory = Join-Path $projectPath 'Logs\netcode-load'
$clientReportDirectory = Join-Path $reportDirectory 'netcode-load-clients'
$releaseSignalPath = Join-Path $reportDirectory 'netcode-load-release.signal'
$serverReportPath = Join-Path $reportDirectory (
    'netcode-load-server-smoke.json'
)
$summaryReportPath = Join-Path $reportDirectory (
    'netcode-load-smoke.json'
)
$serverLogPath = Join-Path $logDirectory 'server.log'
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
New-Item -ItemType Directory `
    -Path $clientReportDirectory `
    -Force |
    Out-Null
foreach ($path in @(
    $serverReportPath,
    $summaryReportPath,
    $releaseSignalPath,
    $serverLogPath
)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}
Get-ChildItem -LiteralPath $clientReportDirectory -File |
    Remove-Item -Force
Get-ChildItem -LiteralPath $logDirectory -File |
    Where-Object Name -like 'client-*.log' |
    Remove-Item -Force

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
    '-jwgbServerSmokeTick', $ServerCaptureTick,
    '-jwgbSeed', 20260724,
    '-jwgbCompetitors', $ClientCount
)

$serverProcess = $null
$clientProcesses = @()
$forcedClientCleanupCount = 0
$forcedServerCleanup = $false
$startedAt = [DateTime]::UtcNow
try {
    $serverProcess = Start-Process `
        -FilePath 'wsl.exe' `
        -ArgumentList $serverArguments `
        -WindowStyle Hidden `
        -PassThru
    Start-Sleep -Seconds 2
    if ($serverProcess.HasExited) {
        throw (
            'Linux load server exited before clients started, code ' +
            "$($serverProcess.ExitCode)."
        )
    }

    for ($index = 1; $index -le $ClientCount; $index++) {
        $suffix = $index.ToString('00')
        $heroId = switch ($index % 3) {
            1 { 'H009' }
            2 { 'H001' }
            default { 'H018' }
        }
        $clientReportPath = Join-Path $clientReportDirectory (
            "client-$suffix.json"
        )
        $clientReadyPath = Join-Path $clientReportDirectory (
            "client-$suffix.ready"
        )
        $clientLogPath = Join-Path $logDirectory (
            "client-$suffix.log"
        )
        $arguments = @(
            '-batchmode',
            '-nographics',
            '-logFile', $clientLogPath,
            '-jwgbNetworkClient',
            '-jwgbHeroId', $heroId,
            '-jwgbServerAddress', $serverAddress,
            '-jwgbServerPort', $Port,
            '-jwgbNetworkSmokeReport', $clientReportPath,
            '-jwgbNetworkSmokeMinTick', $ClientTargetTick,
            '-jwgbNetworkSmokeMinPlayers', $ClientCount,
            '-jwgbNetworkSmokeMinInputs', 20,
            '-jwgbNetworkSmokeReady', $clientReadyPath,
            '-jwgbNetworkSmokeRelease', $releaseSignalPath,
            '-jwgbNetworkSmokeTimeoutSeconds',
                ([Math]::Max(30, $TimeoutSeconds - 10))
        )
        $process = Start-Process `
            -FilePath $windowsArtifact.ExecutablePath `
            -ArgumentList $arguments `
            -WindowStyle Hidden `
            -PassThru
        $clientProcesses += [pscustomobject] @{
            Index = $index
            Process = $process
            ReportPath = $clientReportPath
            ReadyPath = $clientReadyPath
            LogPath = $clientLogPath
            HeroId = $heroId
        }
        Start-Sleep -Milliseconds 75
    }

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $allClientsReady = $false
    while ([DateTime]::UtcNow -lt $deadline) {
        $readyClients = @(
            $clientProcesses |
                Where-Object {
                    Test-Path -LiteralPath $_.ReadyPath -PathType Leaf
                }
        )
        if ($readyClients.Count -eq $ClientCount) {
            $allClientsReady = $true
            break
        }
        if ($serverProcess.HasExited) {
            throw (
                'Linux load server exited before all clients reached the ' +
                "ready barrier ($($readyClients.Count)/$ClientCount), code " +
                "$($serverProcess.ExitCode)."
            )
        }
        Start-Sleep -Milliseconds 250
    }

    if (-not $allClientsReady) {
        $readyCount = @(
            $clientProcesses |
                Where-Object {
                    Test-Path -LiteralPath $_.ReadyPath -PathType Leaf
                }
        ).Count
        throw (
            "$readyCount/$ClientCount Netcode load clients reached the " +
            "ready barrier within $TimeoutSeconds seconds."
        )
    }

    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $releaseSignalPath,
        "release`n",
        $utf8WithoutBom
    )

    $reportDeadline = [DateTime]::UtcNow.AddSeconds(60)
    while ([DateTime]::UtcNow -lt $reportDeadline) {
        $writtenReports = @(
            $clientProcesses |
                Where-Object {
                    Test-Path -LiteralPath $_.ReportPath -PathType Leaf
                }
        )
        if ($writtenReports.Count -eq $ClientCount -and
            (Test-Path -LiteralPath $serverReportPath -PathType Leaf)) {
            break
        }
        Start-Sleep -Milliseconds 250
    }

    $writtenReports = @(
        $clientProcesses |
            Where-Object {
                Test-Path -LiteralPath $_.ReportPath -PathType Leaf
            }
    )
    if ($writtenReports.Count -ne $ClientCount) {
        throw (
            "$($writtenReports.Count)/$ClientCount Netcode load clients " +
            'wrote final reports after the release barrier.'
        )
    }
    if (-not (
        Test-Path -LiteralPath $serverReportPath -PathType Leaf
    )) {
        throw 'Linux Netcode load server did not write its final report.'
    }

    foreach ($client in $clientProcesses) {
        if ($client.Process.HasExited -and
            $client.Process.ExitCode -ne 0) {
            throw (
                "Netcode load client $($client.Index) exited with code " +
                "$($client.Process.ExitCode)."
            )
        }
        if (-not $client.Process.HasExited) {
            Stop-Process `
                -Id $client.Process.Id `
                -Force `
                -ErrorAction SilentlyContinue
            $forcedClientCleanupCount += 1
        }
    }
    if ($serverProcess.HasExited -and $serverProcess.ExitCode -ne 0) {
        throw (
            'Linux Netcode load server exited with code ' +
            "$($serverProcess.ExitCode)."
        )
    }
    if (-not $serverProcess.HasExited) {
        Stop-Process `
            -Id $serverProcess.Id `
            -Force `
            -ErrorAction SilentlyContinue
        $forcedServerCleanup = $true
    }
} finally {
    foreach ($client in $clientProcesses) {
        if (-not $client.Process.HasExited) {
            Stop-Process -Id $client.Process.Id -Force
        }
    }
    if ($serverProcess -ne $null -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
}

if (-not (Test-Path -LiteralPath $serverReportPath -PathType Leaf)) {
    throw "Netcode load server report is missing: $serverReportPath"
}
$serverReport =
    Get-Content -LiteralPath $serverReportPath -Raw |
        ConvertFrom-Json
if ($serverReport.schema -ne 'jwgb.unity.server-live-smoke.v3') {
    throw "Unexpected load server schema: $($serverReport.schema)"
}
if ($serverReport.peakConnectedClients -lt $ClientCount) {
    throw (
        "Expected $ClientCount concurrent clients, server observed " +
        "$($serverReport.peakConnectedClients)."
    )
}
if ($serverReport.receivedJoinRpcCount -lt $ClientCount) {
    throw (
        "Expected at least $ClientCount join RPCs, got " +
        "$($serverReport.receivedJoinRpcCount)."
    )
}
if ($serverReport.issuedReconnectTicketCount -lt $ClientCount) {
    throw (
        "Expected at least $ClientCount reconnect tickets, got " +
        "$($serverReport.issuedReconnectTicketCount)."
    )
}
if ($serverReport.acceptedInputRpcCount -lt ($ClientCount * 20)) {
    throw (
        'Load server accepted too few input RPCs: ' +
        "$($serverReport.acceptedInputRpcCount)."
    )
}
if ($serverReport.replicatedWorldGhostCount -ne 1 -or
    $serverReport.replicatedPlayerGhostCount -ne $ClientCount) {
    throw 'Load server did not maintain the complete Ghost world.'
}

$clientReports = @()
foreach ($client in $clientProcesses) {
    if (-not (
        Test-Path -LiteralPath $client.ReportPath -PathType Leaf
    )) {
        throw "Load client report is missing: $($client.ReportPath)"
    }
    $report =
        Get-Content -LiteralPath $client.ReportPath -Raw |
            ConvertFrom-Json
    if ($report.schema -ne 'jwgb.unity.netcode-client-smoke.v9') {
        throw (
            "Unexpected load client schema for $($client.Index): " +
            "$($report.schema)"
        )
    }
    if ($report.ghostSnapshotTick -lt $ClientTargetTick) {
        throw (
            "Load client $($client.Index) stopped at Ghost tick " +
            "$($report.ghostSnapshotTick)."
        )
    }
    if ($report.worldGhostCount -ne 1 -or
        $report.playerGhostCount -ne $ClientCount) {
        throw (
            "Load client $($client.Index) did not reconstruct the " +
            'complete Ghost world.'
        )
    }
    if ($report.sentInputRpcCount -lt 20) {
        throw (
            "Load client $($client.Index) sent too few inputs: " +
            "$($report.sentInputRpcCount)."
        )
    }
    if ([string]::IsNullOrWhiteSpace($report.reconnectTicket)) {
        throw "Load client $($client.Index) has no reconnect ticket."
    }
    if ($report.resumedSession) {
        throw (
            "Load client $($client.Index) unexpectedly resumed a " +
            'session.'
        )
    }
    if (
        $report.requestedHeroId -ne $client.HeroId -or
        $report.assignedHeroId -ne $client.HeroId
    ) {
        throw (
            "Load client $($client.Index) hero assignment mismatch: " +
            "$($report.requestedHeroId) -> " +
            "$($report.assignedHeroId), expected $($client.HeroId)."
        )
    }
    Assert-NoFatalUnityLog `
        -Path $client.LogPath `
        -Label "Netcode load client $($client.Index)"
    $clientReports += $report
}

$networkIds = @(
    $clientReports |
        ForEach-Object networkId |
        Sort-Object -Unique
)
$entityIds = @(
    $clientReports |
        ForEach-Object localEntityId |
        Sort-Object -Unique
)
$reconnectTickets = @(
    $clientReports |
        ForEach-Object reconnectTicket |
        Sort-Object -Unique
)
if ($networkIds.Count -ne $ClientCount) {
    throw (
        "Expected $ClientCount unique NetworkIds, got " +
        "$($networkIds.Count)."
    )
}
if ($entityIds.Count -ne $ClientCount) {
    throw (
        "Expected $ClientCount unique controlled entities, got " +
        "$($entityIds.Count)."
    )
}
if ($reconnectTickets.Count -ne $ClientCount) {
    throw (
        "Expected $ClientCount unique reconnect tickets, got " +
        "$($reconnectTickets.Count)."
    )
}
Assert-NoFatalUnityLog -Path $serverLogPath -Label 'Netcode load server'

$completedAt = [DateTime]::UtcNow
$summary = [pscustomobject] @{
    schema = 'jwgb.unity.netcode-load-smoke.v1'
    clientCount = $ClientCount
    clientTargetTick = $ClientTargetTick
    serverCaptureTick = $serverReport.tick
    elapsedSeconds = [Math]::Round(
        ($completedAt - $startedAt).TotalSeconds,
        3
    )
    peakConnectedClients = $serverReport.peakConnectedClients
    receivedJoinRpcCount = $serverReport.receivedJoinRpcCount
    acceptedInputRpcCount = $serverReport.acceptedInputRpcCount
    sentStateRpcCount = $serverReport.sentStateRpcCount
    peakReplicatedGhostCount =
        $serverReport.peakReplicatedGhostCount
    uniqueNetworkIdCount = $networkIds.Count
    uniqueControlledEntityCount = $entityIds.Count
    uniqueReconnectTicketCount = $reconnectTickets.Count
    minimumClientGhostTick = (
        $clientReports |
            Measure-Object ghostSnapshotTick -Minimum
    ).Minimum
    minimumClientCompleteSnapshotCount = (
        $clientReports |
            Measure-Object completeGhostSnapshotCount -Minimum
    ).Minimum
    minimumClientInputRpcCount = (
        $clientReports |
            Measure-Object sentInputRpcCount -Minimum
    ).Minimum
    forcedClientCleanupCount = $forcedClientCleanupCount
    forcedServerCleanup = $forcedServerCleanup
}
Write-FormattedJson -Path $summaryReportPath -Value $summary
Write-FormattedJson -Path $serverReportPath -Value $serverReport

Write-Output (
    "Netcode load smoke passed: $ClientCount concurrent Windows " +
    "clients, $($summary.uniqueNetworkIdCount) unique NetworkIds, " +
        "$($summary.uniqueControlledEntityCount) unique controlled " +
        "entities, server accepted $($summary.acceptedInputRpcCount) " +
        "inputs and replicated a peak of " +
        "$($summary.peakReplicatedGhostCount) Ghosts; " +
        "$($summary.forcedClientCleanupCount) client process handles " +
        'cleaned after complete reports were written.'
)
