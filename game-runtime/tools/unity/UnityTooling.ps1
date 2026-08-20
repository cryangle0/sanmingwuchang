Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-JwgbUnityEditor {
    $candidates = @(
        $env:UNITY_EDITOR,
        'E:\Unity\Editors\6000.3.20f1\Editor\Unity.exe'
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($candidate in $candidates) {
        $resolved = [System.IO.Path]::GetFullPath($candidate)
        if (Test-Path -LiteralPath $resolved -PathType Leaf) {
            return $resolved
        }
    }

    throw 'Unity 6000.3.20f1 was not found. Set UNITY_EDITOR or install it under E:\Unity\Editors.'
}

function Invoke-JwgbUnityBatch {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    $editor = Get-JwgbUnityEditor
    $process = Start-Process `
        -FilePath $editor `
        -ArgumentList $Arguments `
        -WindowStyle Hidden `
        -PassThru
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) {
        throw "Unity exited with code $($process.ExitCode)."
    }
}
