param(
    [ValidateRange(20, 120)]
    [int] $TimeoutSeconds = 45,

    [ValidateRange(180, 540)]
    [int] $ServerCaptureTick = 360,

    [ValidateRange(2, 30)]
    [int] $CompetitorCount = 30,

    [ValidateRange(1, 65535)]
    [int] $Port = 7979,

    [string] $WslDistribution = 'Ubuntu-22.04',

    [switch] $Visual,

    [switch] $Interactive,

    [switch] $Adverse,

    [switch] $Rematch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (@($Visual, $Interactive, $Adverse, $Rematch).Where({ $_ }).Count -gt 1) {
    throw (
        'Visual, Interactive, Adverse and Rematch are separate ' +
        'Netcode gates.'
    )
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'BuildArtifactVerification.ps1')

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)
$projectPath = Join-Path $repositoryRoot 'unity'
$windowsTarget = if ($Adverse -or $Rematch) {
    'windows-network-debug'
} else {
    'windows'
}
$windowsArtifact = Get-JwgbBuildArtifact `
    -Target $windowsTarget `
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
        throw "WSL smoke requires a drive-letter path: $fullPath"
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
        throw (
            "Unable to query networking mode for WSL distribution " +
            "$Distribution."
        )
    }
    if (([string] $networkingMode).Trim() -eq 'mirrored') {
        return '127.0.0.1'
    }

    $routeOutput = & wsl.exe `
        -d $Distribution `
        -- `
        sh -lc "ip -4 route get 1.1.1.1 | sed -n 's/.* src \([^ ]*\).*/\1/p' | head -n 1"
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to query IPv4 address for WSL distribution $Distribution."
    }

    $address = ([string] $routeOutput).Trim()
    $parsedAddress = $null
    if (-not (
        [System.Net.IPAddress]::TryParse(
            $address,
            [ref] $parsedAddress
        )
    ) -or
        $parsedAddress.AddressFamily -ne
            [System.Net.Sockets.AddressFamily]::InterNetwork
    ) {
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
    $fatalLogPatterns = @(
        '(?im)^\s*(?:NullReferenceException|MissingReferenceException|' +
            'ArgumentException|InvalidOperationException|' +
            'TypeInitializationException|DllNotFoundException|' +
            'EntryPointNotFoundException|IndexOutOfRangeException|' +
            'UnityException):',
        '(?im)^\s*(?:Shader error|Assertion failed|Crash!!!)\b'
    )
    $logText = Get-Content -LiteralPath $Path -Raw
    $fatalLogMatches = @(foreach ($pattern in $fatalLogPatterns) {
        [regex]::Matches($logText, $pattern) |
            ForEach-Object { $_.Value.Trim() }
    })
    if ($fatalLogMatches.Count -gt 0) {
        throw (
            "$Label log contains fatal entries:`n" +
            ($fatalLogMatches -join "`n")
        )
    }
}

function Write-FormattedJsonReport {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Path,

        [Parameter(Mandatory = $true)]
        [psobject] $Report
    )

    $formattedReport = Format-JwgbJson (
        $Report |
            ConvertTo-Json -Depth 4 -Compress
    )
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $Path,
        $formattedReport + "`n",
        $utf8WithoutBom
    )
}

$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
$reportPrefix = if ($Visual) {
    'netcode-visual'
} elseif ($Interactive) {
    'netcode-interactive'
} elseif ($Adverse) {
    'netcode-adverse'
} elseif ($Rematch) {
    'netcode-rematch'
} else {
    'netcode'
}
$serverReportPath = Join-Path $reportDirectory (
    "$reportPrefix-server-smoke.json"
)
$clientReportPath = Join-Path $reportDirectory (
    "$reportPrefix-client-smoke.json"
)
$serverLogPath = Join-Path $projectPath (
    "Logs\$reportPrefix-server-smoke.log"
)
$clientLogPath = Join-Path $projectPath (
    "Logs\$reportPrefix-client-smoke.log"
)
$visualReportPath = Join-Path $reportDirectory (
    "$reportPrefix-live-smoke.json"
)
$visualScreenshotPath = Join-Path $reportDirectory (
    "$reportPrefix-live-smoke.png"
)
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $serverLogPath) -Force |
    Out-Null
foreach ($path in @(
    $serverReportPath,
    $clientReportPath,
    $serverLogPath,
    $clientLogPath,
    $visualReportPath,
    $visualScreenshotPath
)) {
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        Remove-Item -LiteralPath $path -Force
    }
}

$serverAddress = Get-WslClientAddress -Distribution $WslDistribution
$linuxBuildDirectory = ConvertTo-WslPath $linuxArtifact.OutputDirectory
$linuxServerReportPath = ConvertTo-WslPath $serverReportPath
$linuxServerLogPath = ConvertTo-WslPath $serverLogPath
$serverTargetTick = if ($Rematch) { 80 } else { $ServerCaptureTick }
$effectiveCompetitorCount = if ($Rematch) { 2 } else { $CompetitorCount }
$processTimeoutSeconds = if ($Rematch) { 90 } else { $TimeoutSeconds }
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
    '-jwgbServerSmokeTick', $serverTargetTick,
    '-jwgbSeed', 20260724,
    '-jwgbCompetitors', $effectiveCompetitorCount
)
if ($Rematch) {
    $serverArguments += @(
        '-jwgbClassicArena',
        '-jwgbServerRematchFinishTick', 40
    )
}
$serverProcess = $null
$clientProcess = $null
try {
    $serverProcess = Start-Process `
        -FilePath 'wsl.exe' `
        -ArgumentList $serverArguments `
        -WindowStyle Hidden `
        -PassThru

    Start-Sleep -Seconds 2
    if ($serverProcess.HasExited) {
        throw (
            'Linux server exited before the Windows client started, code ' +
            "$($serverProcess.ExitCode)."
        )
    }

    $clientModeArguments = if ($Interactive) {
        @('-jwgbInteractiveNetworkAutoJoin')
    } else {
        @('-jwgbNetworkClient')
    }
    $clientArguments = @(
        '-logFile', $clientLogPath,
        '-jwgbHeroId', 'H038',
        '-jwgbServerAddress', $serverAddress,
        '-jwgbServerPort', $Port,
        '-jwgbNetworkSmokeReport', $clientReportPath,
        '-jwgbNetworkSmokeMinTick', $(if ($Rematch) { 20 } else { 120 }),
        '-jwgbNetworkSmokeTimeoutSeconds', $(if ($Rematch) { 60 } else { 30 }),
        '-jwgbNetworkSmokeMoveZ', 1000
    ) + $clientModeArguments
    if ($Rematch) {
        $clientArguments += '-jwgbNetworkSmokeRematch'
    }
    if ($Adverse) {
        $simulatorProfile = Join-Path `
            $scriptRoot `
            'network-simulator-poor.json'
        $clientArguments += @(
            '--loadNetworkSimulatorJsonFile',
            $simulatorProfile
        )
    }
    if ($Visual) {
        $clientArguments = @(
            '-screen-fullscreen', '0',
            '-screen-width', '1280',
            '-screen-height', '720'
        ) + $clientArguments + @(
            '-jwgbLiveSmokeReport', $visualReportPath,
            '-jwgbLiveSmokeScreenshot', $visualScreenshotPath
        )
    } else {
        $clientArguments = @(
            '-batchmode',
            '-nographics'
        ) + $clientArguments
    }
    $clientProcess = Start-Process `
        -FilePath $windowsArtifact.ExecutablePath `
        -ArgumentList $clientArguments `
        -WindowStyle Hidden `
        -PassThru

    if (-not $clientProcess.WaitForExit($processTimeoutSeconds * 1000)) {
        throw (
            "Windows Netcode client exceeded " +
            "$processTimeoutSeconds seconds."
        )
    }
    if ($clientProcess.ExitCode -ne 0) {
        throw (
            'Windows Netcode client exited with code ' +
            "$($clientProcess.ExitCode)."
        )
    }

    if (-not $serverProcess.WaitForExit($processTimeoutSeconds * 1000)) {
        throw (
            "Linux Netcode server exceeded " +
            "$processTimeoutSeconds seconds."
        )
    }
    if ($serverProcess.ExitCode -ne 0) {
        throw (
            'Linux Netcode server exited with code ' +
            "$($serverProcess.ExitCode)."
        )
    }
} finally {
    if ($clientProcess -ne $null -and -not $clientProcess.HasExited) {
        Stop-Process -Id $clientProcess.Id -Force
    }
    if ($serverProcess -ne $null -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
}

if (-not (Test-Path -LiteralPath $clientReportPath -PathType Leaf)) {
    throw "Netcode client smoke report is missing: $clientReportPath"
}
if (-not (Test-Path -LiteralPath $serverReportPath -PathType Leaf)) {
    throw "Netcode server smoke report is missing: $serverReportPath"
}

$clientReport =
    Get-Content -LiteralPath $clientReportPath -Raw |
        ConvertFrom-Json
$serverReport =
    Get-Content -LiteralPath $serverReportPath -Raw |
        ConvertFrom-Json

if ($Rematch) {
    if (
        $clientReport.schema -ne
            'jwgb.unity.netcode-rematch-client-smoke.v1' -or
        $clientReport.mode -ne 'netcode-authoritative-rematch'
    ) {
        throw (
            'Unexpected Netcode rematch client report: ' +
            "$($clientReport.schema) / $($clientReport.mode)"
        )
    }
    if (
        -not $clientReport.rematchRequested -or
        -not $clientReport.rematchObserved
    ) {
        throw 'Client did not request and observe an authoritative rematch.'
    }
    if (
        $clientReport.requestedHeroId -ne 'H038' -or
        $clientReport.initialAssignedHeroId -ne 'H038' -or
        $clientReport.assignedHeroId -ne 'H038'
    ) {
        throw (
            'Rematch did not preserve H038: ' +
            "$($clientReport.requestedHeroId) / " +
            "$($clientReport.initialAssignedHeroId) / " +
            "$($clientReport.assignedHeroId)."
        )
    }
    if (
        $clientReport.initialEntityId -le 0 -or
        $clientReport.localEntityId -ne
            $clientReport.initialEntityId
    ) {
        throw (
            'Rematch did not preserve the assigned entity: ' +
            "$($clientReport.initialEntityId) -> " +
            "$($clientReport.localEntityId)."
        )
    }
    if (
        $clientReport.firstMatchFinishedTick -le
            $clientReport.rematchTick -or
        $clientReport.rematchTick -lt 20 -or
        $clientReport.matchStatus -ne 'running'
    ) {
        throw (
            'Client did not observe a running second match after tick ' +
            "rollback: $($clientReport.firstMatchFinishedTick) -> " +
            "$($clientReport.rematchTick), " +
            "$($clientReport.matchStatus)."
        )
    }
    if (
        $serverReport.schema -ne
            'jwgb.unity.server-rematch-smoke.v1' -or
        $serverReport.matchSequence -ne 1 -or
        $serverReport.matchStatus -ne 'running' -or
        $serverReport.tick -lt 20
    ) {
        throw (
            'Server did not publish a running second match: ' +
            "$($serverReport.schema), sequence " +
            "$($serverReport.matchSequence), tick " +
            "$($serverReport.tick), status " +
            "$($serverReport.matchStatus)."
        )
    }
    if (
        -not $serverReport.networkListening -or
        $serverReport.peakConnectedClients -lt 1 -or
        $serverReport.receivedJoinRpcCount -lt 1 -or
        $serverReport.playerCount -ne 2
    ) {
        throw 'Server rematch report is missing its live connection or roster.'
    }
    Assert-NoFatalUnityLog `
        -Path $clientLogPath `
        -Label 'Windows Netcode rematch client'
    Assert-NoFatalUnityLog `
        -Path $serverLogPath `
        -Label 'Linux Netcode rematch server'
    Write-FormattedJsonReport `
        -Path $clientReportPath `
        -Report $clientReport
    Write-FormattedJsonReport `
        -Path $serverReportPath `
        -Report $serverReport
    Write-Output (
        'Cross-process Netcode rematch smoke passed: entity ' +
        "$($clientReport.localEntityId) kept H038 and observed tick " +
        "$($clientReport.firstMatchFinishedTick) -> " +
        "$($clientReport.rematchTick); Linux server started match " +
        "sequence $($serverReport.matchSequence)."
    )
    return
}

if ($clientReport.schema -ne 'jwgb.unity.netcode-client-smoke.v9') {
    throw "Unexpected Netcode client schema: $($clientReport.schema)"
}
if ($clientReport.mode -ne 'netcode-rpc-and-runtime-ghost-snapshot') {
    throw "Unexpected Netcode client mode: $($clientReport.mode)"
}
if ($clientReport.networkId -le 0) {
    throw "Invalid client network ID: $($clientReport.networkId)"
}
if ($clientReport.localEntityId -le 0) {
    throw "Invalid assigned entity ID: $($clientReport.localEntityId)"
}
if ([string]::IsNullOrWhiteSpace($clientReport.reconnectTicket)) {
    throw 'Client did not receive a reconnect ticket.'
}
if (
    $clientReport.requestedHeroId -ne 'H038' -or
    $clientReport.assignedHeroId -ne
        $clientReport.requestedHeroId
) {
    throw (
        'Client hero assignment does not match its request: ' +
        "$($clientReport.requestedHeroId) -> " +
        "$($clientReport.assignedHeroId)."
    )
}
if ($clientReport.resumedSession) {
    throw 'Initial Netcode smoke client unexpectedly resumed a session.'
}
if ($clientReport.authoritativeTick -le 0) {
    throw (
        'Client did not receive an authoritative tick: ' +
        "$($clientReport.authoritativeTick)"
    )
}
if ($clientReport.sentInputRpcCount -le 0) {
    throw 'Client did not send any input RPCs.'
}
if ($clientReport.receivedStateRpcCount -le 0) {
    throw 'Client did not receive any state RPCs.'
}
if (
    $clientReport.receivedEventRpcCount -le 0 -or
    $clientReport.lastEventCursor -le 0
) {
    throw 'Client did not receive the live match event stream.'
}
if ([string]::IsNullOrWhiteSpace($clientReport.stateHash)) {
    throw 'Client authoritative state hash is empty.'
}
if ($clientReport.completeGhostSnapshotCount -lt 1) {
    throw 'Client did not reconstruct a complete Ghost snapshot.'
}
if (
    $clientReport.remoteInterpolationFrameCount -lt 1 -or
    $clientReport.peakRemoteInterpolatedViewCount -lt 1
) {
    throw 'Client did not interpolate remote player views.'
}
if ($clientReport.maxRemoteInterpolationStepMm -gt 2000) {
    throw (
        'Client remote interpolation produced an excessive frame step: ' +
        "$($clientReport.maxRemoteInterpolationStepMm) mm."
    )
}
if ($clientReport.predictedInputCount -lt 1) {
    throw 'Client did not predict any unique local inputs.'
}
if (
    $clientReport.predictedInputCount -gt
        $clientReport.sentInputRpcCount
) {
    throw (
        'Client predicted more unique inputs than it sent: ' +
        "$($clientReport.predictedInputCount) vs " +
        "$($clientReport.sentInputRpcCount)."
    )
}
if (
    $clientReport.predictionReplayCount -lt
        $clientReport.predictedInputCount
) {
    throw (
        'Client prediction replay workload is smaller than its unique ' +
        "input count: $($clientReport.predictionReplayCount) vs " +
        "$($clientReport.predictedInputCount)."
    )
}
if ($clientReport.predictionFrameCount -lt 1) {
    throw 'Client local prediction did not advance any render frames.'
}
if (
    $clientReport.latestAcknowledgedInputSequence -gt
        $clientReport.latestSentInputSequence
) {
    throw (
        'Client acknowledged an input sequence it never sent: ' +
        "$($clientReport.latestAcknowledgedInputSequence) vs " +
        "$($clientReport.latestSentInputSequence)."
    )
}
if ($clientReport.unacknowledgedInputCount -lt 0) {
    throw 'Client reported a negative unacknowledged input count.'
}
if ($clientReport.predictionHardSnapCount -ne 0) {
    throw (
        'Client local presentation produced hard frame snaps: ' +
        "$($clientReport.predictionHardSnapCount), max error " +
        "$($clientReport.maxPredictionVisualStepMm) mm."
    )
}
if ($clientReport.maxPredictionVisualStepMm -gt 2000) {
    throw (
        'Client local presentation produced an excessive frame step: ' +
        "$($clientReport.maxPredictionVisualStepMm) mm."
    )
}
if (
    $clientReport.predictionReconciliationHardCorrectionCount -gt 0 -and
    [string]::IsNullOrWhiteSpace(
        $clientReport.maxPredictionErrorClassification
    )
) {
    throw (
        'Client had a large authoritative correction without ' +
        'diagnostic classification.'
    )
}
if ($clientReport.maxPredictionErrorMm -ge 4000) {
    Write-Warning (
        'Client reconciled a large authoritative state change: ' +
        "$($clientReport.maxPredictionErrorMm) mm at tick " +
        "$($clientReport.maxPredictionErrorAtAuthoritativeTick), " +
        "classified as " +
        "$($clientReport.maxPredictionErrorClassification), " +
        "authority step " +
        "$($clientReport.maxPredictionErrorAuthoritativeStepMm) mm " +
        "over " +
        "$($clientReport.maxPredictionErrorAuthoritativeTickDelta) ticks."
    )
}
if (
    $clientReport.ghostSnapshotTick -ne
        $clientReport.authoritativeTick
) {
    throw (
        'Client Ghost snapshot tick does not match its authoritative ' +
        "summary: $($clientReport.ghostSnapshotTick) vs " +
        "$($clientReport.authoritativeTick)."
    )
}
if ($clientReport.worldGhostCount -ne 1) {
    throw (
        'Client did not reconstruct exactly one MatchWorld Ghost: ' +
        "$($clientReport.worldGhostCount)."
    )
}
if ($clientReport.playerGhostCount -ne $clientReport.playerCount) {
    throw (
        'Client Player Ghost count does not match the authoritative ' +
        "summary: $($clientReport.playerGhostCount) vs " +
        "$($clientReport.playerCount)."
    )
}
if (
    $clientReport.projectileGhostCount -ne
        $clientReport.projectileCount
) {
    throw (
        'Client Projectile Ghost count does not match the authoritative ' +
        "summary: $($clientReport.projectileGhostCount) vs " +
        "$($clientReport.projectileCount)."
    )
}
if (
    $clientReport.windWallGhostCount -ne
        $clientReport.windWallCount
) {
    throw (
        'Client WindWall Ghost count does not match the authoritative ' +
        "summary: $($clientReport.windWallGhostCount) vs " +
        "$($clientReport.windWallCount)."
    )
}
if (-not $clientReport.mapEnabled) {
    throw 'Client did not observe map mode on the authoritative match.'
}
if ([string]::IsNullOrWhiteSpace($clientReport.mapGeometryHash)) {
    throw 'Client map geometry hash is empty.'
}
if (-not $clientReport.pveEnabled) {
    throw 'Client did not observe PVE enabled on the authoritative match.'
}
if ($clientReport.monsterGhostCount -lt 1) {
    throw (
        'Client did not reconstruct any Monster Ghosts: ' +
        "$($clientReport.monsterGhostCount)."
    )
}
if (
    $clientReport.monsterGhostCount -ne
        $clientReport.monsterCount
) {
    throw (
        'Client Monster Ghost count does not match the authoritative ' +
        "summary: $($clientReport.monsterGhostCount) vs " +
        "$($clientReport.monsterCount)."
    )
}
if ($clientReport.stormRadiusMm -le 0) {
    throw (
        'Client did not observe a storm zone radius: ' +
        "$($clientReport.stormRadiusMm)."
    )
}

if ($serverReport.schema -ne 'jwgb.unity.server-live-smoke.v3') {
    throw "Unexpected Netcode server schema: $($serverReport.schema)"
}
if (
    $serverReport.mode -ne
        'authoritative-simulation-netcode-runtime-ghosts'
) {
    throw "Unexpected Netcode server mode: $($serverReport.mode)"
}
if (-not $serverReport.networkListening) {
    throw 'Netcode server did not report an active listening interface.'
}
if ($serverReport.networkPort -ne $Port) {
    throw (
        "Expected Netcode server port $Port, got " +
        "$($serverReport.networkPort)."
    )
}
if ($serverReport.peakConnectedClients -lt 1) {
    throw 'Netcode server never observed a connected client.'
}
if ($serverReport.receivedJoinRpcCount -lt 1) {
    throw 'Netcode server did not receive a join RPC.'
}
if ($serverReport.issuedReconnectTicketCount -lt 1) {
    throw 'Netcode server did not issue a reconnect ticket.'
}
if ($serverReport.acceptedInputRpcCount -lt 1) {
    throw 'Netcode server did not accept an input RPC.'
}
if ($serverReport.sentStateRpcCount -lt 1) {
    throw 'Netcode server did not send a state RPC.'
}
if ($serverReport.sentEventRpcCount -lt 1) {
    throw 'Netcode server did not send a match event RPC.'
}
if (-not $serverReport.ghostRegistrationComplete) {
    throw 'Netcode server did not register runtime Ghost prefabs.'
}
if (
    $serverReport.replicatedGhostSnapshotTick -ne
        $serverReport.tick
) {
    throw (
        'Server replicated Ghost tick does not match the captured ' +
        "snapshot: $($serverReport.replicatedGhostSnapshotTick) vs " +
        "$($serverReport.tick)."
    )
}
if ($serverReport.replicatedWorldGhostCount -ne 1) {
    throw (
        'Server did not project exactly one MatchWorld Ghost: ' +
        "$($serverReport.replicatedWorldGhostCount)."
    )
}
if (
    $serverReport.replicatedPlayerGhostCount -ne
        $serverReport.playerCount
) {
    throw (
        'Server Player Ghost count does not match the snapshot: ' +
        "$($serverReport.replicatedPlayerGhostCount) vs " +
        "$($serverReport.playerCount)."
    )
}
if (
    $serverReport.replicatedProjectileGhostCount -ne
        $serverReport.projectileCount
) {
    throw (
        'Server Projectile Ghost count does not match the snapshot: ' +
        "$($serverReport.replicatedProjectileGhostCount) vs " +
        "$($serverReport.projectileCount)."
    )
}
if (
    $serverReport.replicatedWindWallGhostCount -ne
        $serverReport.windWallCount
) {
    throw (
        'Server WindWall Ghost count does not match the snapshot: ' +
        "$($serverReport.replicatedWindWallGhostCount) vs " +
        "$($serverReport.windWallCount)."
    )
}
if (-not $serverReport.mapEnabled) {
    throw 'Server did not run the authoritative match in map mode.'
}
if (-not $serverReport.pveEnabled) {
    throw 'Server did not run the authoritative match with PVE enabled.'
}
if ($serverReport.monsterCount -lt 1) {
    throw (
        'Server map-mode match has no monsters: ' +
        "$($serverReport.monsterCount)."
    )
}
if (
    $serverReport.replicatedMonsterGhostCount -ne
        $serverReport.monsterCount
) {
    throw (
        'Server Monster Ghost count does not match the snapshot: ' +
        "$($serverReport.replicatedMonsterGhostCount) vs " +
        "$($serverReport.monsterCount)."
    )
}
if (
    $serverReport.replicatedLootGhostCount -ne
        $serverReport.lootDropCount
) {
    throw (
        'Server Loot Ghost count does not match the snapshot: ' +
        "$($serverReport.replicatedLootGhostCount) vs " +
        "$($serverReport.lootDropCount)."
    )
}
if (
    $serverReport.replicatedShopGhostCount -ne
        $serverReport.shopCount
) {
    throw (
        'Server Shop Ghost count does not match the snapshot: ' +
        "$($serverReport.replicatedShopGhostCount) vs " +
        "$($serverReport.shopCount)."
    )
}
if ($serverReport.stormRadiusMm -le 0) {
    throw (
        'Server map-mode match has no storm zone radius: ' +
        "$($serverReport.stormRadiusMm)."
    )
}
if (
    $clientReport.mapGeometryHash -ne
        $serverReport.mapGeometryHash
) {
    throw (
        'Client and server map geometry hashes differ: ' +
        "$($clientReport.mapGeometryHash) vs " +
        "$($serverReport.mapGeometryHash)."
    )
}
if ($serverReport.peakReplicatedGhostCount -lt $CompetitorCount) {
    throw (
        'Server peak replicated Ghost count never covered the full ' +
        "roster: $($serverReport.peakReplicatedGhostCount)."
    )
}

if ($Visual) {
    if (-not (
        Test-Path -LiteralPath $visualReportPath -PathType Leaf
    )) {
        throw "Netcode visual report is missing: $visualReportPath"
    }
    if (-not (
        Test-Path -LiteralPath $visualScreenshotPath -PathType Leaf
    )) {
        throw (
            "Netcode visual screenshot is missing: " +
            $visualScreenshotPath
        )
    }
    $visualReport =
        Get-Content -LiteralPath $visualReportPath -Raw |
            ConvertFrom-Json
    if ($visualReport.schema -ne 'jwgb.unity.live-smoke.v2') {
        throw (
            "Unexpected Netcode visual schema: " +
            "$($visualReport.schema)"
        )
    }
    if (
        $visualReport.mode -ne
            'network-authoritative-runtime-ghosts'
    ) {
        throw (
            "Unexpected Netcode visual mode: " +
            "$($visualReport.mode)"
        )
    }
    if ($visualReport.tick -lt 120) {
        throw (
            "Netcode visual smoke ended too early at tick " +
            "$($visualReport.tick)."
        )
    }
    if ($visualReport.playerCount -ne $CompetitorCount) {
        throw (
            "Expected $CompetitorCount rendered network players, got " +
            "$($visualReport.playerCount)."
        )
    }
    if (
        $visualReport.localEntityId -ne
            $clientReport.localEntityId
    ) {
        throw (
            'Rendered local entity does not match the assigned network ' +
            "entity: $($visualReport.localEntityId) vs " +
            "$($clientReport.localEntityId)."
        )
    }
    if ($visualReport.completeGhostSnapshotCount -lt 1) {
        throw 'Visual client never completed a Ghost snapshot.'
    }
    if ([string]::IsNullOrWhiteSpace($visualReport.stateHash)) {
        throw 'Netcode visual state hash is empty.'
    }

    $screenshot = Get-Item -LiteralPath $visualScreenshotPath
    if ($screenshot.Length -le 10KB) {
        throw (
            'Netcode visual screenshot is unexpectedly small: ' +
            "$($screenshot.Length)"
        )
    }
    Add-Type -AssemblyName System.Drawing
    $bitmap = [System.Drawing.Bitmap]::FromFile(
        $visualScreenshotPath
    )
    try {
        if (
            $bitmap.Width -ne $visualReport.screenWidth -or
            $bitmap.Height -ne $visualReport.screenHeight
        ) {
            throw (
                'Netcode visual screenshot dimensions do not match the ' +
                "report: $($bitmap.Width)x$($bitmap.Height) versus " +
                "$($visualReport.screenWidth)x" +
                "$($visualReport.screenHeight)."
            )
        }

        $uniqueColors =
            [System.Collections.Generic.HashSet[int]]::new()
        $darkPixels = 0
        $brightPixels = 0
        $greenPixels = 0
        $warmPixels = 0
        $samples = 0
        $luminanceSum = 0.0
        $luminanceSquaredSum = 0.0
        for ($y = 0; $y -lt $bitmap.Height; $y += 4) {
            for ($x = 0; $x -lt $bitmap.Width; $x += 4) {
                $color = $bitmap.GetPixel($x, $y)
                [void] $uniqueColors.Add($color.ToArgb())
                $luminance = (
                    (0.2126 * $color.R) +
                    (0.7152 * $color.G) +
                    (0.0722 * $color.B)
                )
                $luminanceSum += $luminance
                $luminanceSquaredSum += $luminance * $luminance
                $samples++
                if ($luminance -lt 30) {
                    $darkPixels++
                }
                if ($luminance -gt 180) {
                    $brightPixels++
                }
                if (
                    $color.G -gt ($color.R + 35) -and
                    $color.G -gt ($color.B + 20) -and
                    $color.G -gt 100
                ) {
                    $greenPixels++
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
                    $warmPixels++
                }
            }
        }
        $meanLuminance = $luminanceSum / $samples
        $variance = [Math]::Max(
            0,
            ($luminanceSquaredSum / $samples) -
                ($meanLuminance * $meanLuminance)
        )
        if ($uniqueColors.Count -lt 64) {
            throw (
                'Netcode visual screenshot has too little color ' +
                "diversity: $($uniqueColors.Count)."
            )
        }
        if ([Math]::Sqrt($variance) -lt 8) {
            throw 'Netcode visual screenshot is blank or nearly uniform.'
        }
        if (
            ($darkPixels / $samples) -lt 0.02 -or
            ($brightPixels / $samples) -lt 0.0004
        ) {
            throw 'Netcode visual screenshot is missing HUD contrast.'
        }
        if ($greenPixels -lt 4 -or $warmPixels -lt 10) {
            throw (
                'Netcode visual screenshot is missing expected rendered ' +
                'battlefield actors.'
            )
        }
    } finally {
        $bitmap.Dispose()
    }
    Write-FormattedJsonReport `
        -Path $visualReportPath `
        -Report $visualReport
}
if ($serverReport.tick -lt $ServerCaptureTick) {
    throw "Netcode server ended too early at tick $($serverReport.tick)."
}
if ($serverReport.playerCount -ne $CompetitorCount) {
    throw (
        "Expected $CompetitorCount server players, got " +
        "$($serverReport.playerCount)."
    )
}

Assert-NoFatalUnityLog -Path $clientLogPath -Label 'Windows Netcode client'
Assert-NoFatalUnityLog -Path $serverLogPath -Label 'Linux Netcode server'
if ($Adverse) {
    $clientLogText = Get-Content -LiteralPath $clientLogPath -Raw
    if ($clientLogText -notmatch 'Enabled network simulator') {
        throw 'Adverse Netcode client did not enable the network simulator.'
    }
}
Write-FormattedJsonReport `
    -Path $clientReportPath `
    -Report $clientReport
Write-FormattedJsonReport `
    -Path $serverReportPath `
    -Report $serverReport

Write-Output (
    $(if ($Visual) {
        'Cross-process Netcode visual smoke passed: Windows client '
    } elseif ($Interactive) {
        'Interactive menu-to-Netcode smoke passed: Windows client '
    } elseif ($Adverse) {
        'Adverse-network Netcode smoke passed: Windows client '
    } else {
        'Cross-process Netcode smoke passed: Windows client '
    }) +
    "$($clientReport.networkId) controlled entity " +
    "$($clientReport.localEntityId), sent " +
    "$($clientReport.sentInputRpcCount) input RPCs and received " +
    "$($clientReport.receivedStateRpcCount) state RPCs, reconstructed " +
    "$($clientReport.worldGhostCount) MatchWorld Ghost, " +
    "$($clientReport.playerGhostCount) Player Ghosts, " +
    "$($clientReport.projectileGhostCount) Projectile Ghosts, " +
    "$($clientReport.monsterGhostCount) Monster Ghosts and " +
    "$($clientReport.windWallGhostCount) WindWall Ghosts; Linux server " +
    "accepted $($serverReport.acceptedInputRpcCount) inputs and sent " +
    "$($serverReport.sentStateRpcCount) state RPCs with a peak of " +
    "$($serverReport.peakReplicatedGhostCount) replicated Ghosts" +
    $(if ($Visual) {
        ", with a verified $($visualReport.screenWidth)x" +
        "$($visualReport.screenHeight) rendered frame."
    } else {
        '.'
    })
)
