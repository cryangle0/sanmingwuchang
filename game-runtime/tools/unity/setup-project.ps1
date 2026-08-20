$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'UnityTooling.ps1')

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)
$projectPath = Join-Path $repositoryRoot 'unity'
$logDirectory = Join-Path $projectPath 'Logs'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null

Invoke-JwgbUnityBatch -Arguments @(
    '-batchmode',
    '-nographics',
    '-quit',
    '-projectPath',
    $projectPath,
    '-executeMethod',
    'Jwgb.Editor.ProjectSetup.Apply',
    '-logFile',
    (Join-Path $logDirectory 'setup-project.log')
)
