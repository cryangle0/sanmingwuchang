$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $scriptRoot 'UnityTooling.ps1')

$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)
$projectPath = Join-Path $repositoryRoot 'unity'
$logDirectory = Join-Path $projectPath 'Logs'
$reportDirectory = Join-Path $repositoryRoot 'migration\reports\unity'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null

Invoke-JwgbUnityBatch -Arguments @(
    '-batchmode',
    '-nographics',
    '-projectPath',
    $projectPath,
    '-runTests',
    '-testPlatform',
    'EditMode',
    '-testResults',
    (Join-Path $reportDirectory 'editmode-results.xml'),
    '-logFile',
    (Join-Path $logDirectory 'editmode-tests.log')
)
