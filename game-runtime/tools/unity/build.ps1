param(
    [Parameter(Mandatory = $true)]
    [ValidateSet(
        'windows',
        'windows-stress',
        'windows-network-debug',
        'android',
        'linux-server'
    )]
    [string] $Target
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'UnityTooling.ps1')
. (Join-Path $scriptRoot 'BuildArtifactVerification.ps1')
. (Join-Path $scriptRoot 'BuildHostEnvironment.ps1')
. (Join-Path $scriptRoot 'PackageLockVerification.ps1')

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)
$projectPath = Join-Path $repositoryRoot 'unity'
$logDirectory = Join-Path $projectPath 'Logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
Assert-JwgbUnityPackageLock -ProjectPath $projectPath

$methods = @{
    'windows' = 'Jwgb.Editor.BuildCommand.WindowsClient'
    'windows-stress' = 'Jwgb.Editor.BuildCommand.WindowsStressClient'
    'windows-network-debug' =
        'Jwgb.Editor.BuildCommand.WindowsNetworkDebugClient'
    'android' = 'Jwgb.Editor.BuildCommand.AndroidClient'
    'linux-server' = 'Jwgb.Editor.BuildCommand.LinuxServer'
}
$unityBuildTargets = @{
    'windows' = 'Win64'
    'windows-stress' = 'Win64'
    'windows-network-debug' = 'Win64'
    'android' = 'Android'
    'linux-server' = 'Linux64'
}

$artifact = Get-JwgbBuildArtifact `
    -Target $Target `
    -ProjectPath $projectPath
Remove-JwgbBuildOutput -Artifact $artifact
$startedAtUtc = [DateTime]::UtcNow
if ($Target -eq 'windows-network-debug') {
    $env:JWGB_DEVELOPMENT_BUILD = '1'
}

Invoke-JwgbUnityBuildBatch -Arguments @(
    '-batchmode',
    '-nographics',
    '-quit',
    '-buildTarget',
    $unityBuildTargets[$Target],
    '-projectPath',
    $projectPath,
    '-executeMethod',
    $methods[$Target],
    '-logFile',
    (Join-Path $logDirectory "build-$Target.log")
)

Assert-JwgbBuildArtifact `
    -Artifact $artifact `
    -StartedAtUtc $startedAtUtc
Write-JwgbBuildReport `
    -Artifact $artifact `
    -RepositoryRoot $repositoryRoot `
    -StartedAtUtc $startedAtUtc
