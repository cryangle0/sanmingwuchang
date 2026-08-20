Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Invoke-JwgbUnityBuildBatch {
    param(
        [Parameter(Mandatory = $true)]
        [string[]] $Arguments
    )

    $registryPath = 'Software\Microsoft\Command Processor'
    $valueName = 'AutoRun'
    $originalValue = $null
    $originalKind = $null

    $registryKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(
        $registryPath,
        $true
    )
    if ($registryKey -ne $null) {
        try {
            $originalValue = $registryKey.GetValue(
                $valueName,
                $null,
                [Microsoft.Win32.RegistryValueOptions]::
                    DoNotExpandEnvironmentNames
            )
            if ($originalValue -ne $null) {
                $originalKind = $registryKey.GetValueKind($valueName)
                $registryKey.DeleteValue($valueName, $false)
            }
        } finally {
            $registryKey.Dispose()
        }
    }

    try {
        Invoke-JwgbUnityBatch -Arguments $Arguments
    } finally {
        if ($originalValue -ne $null) {
            Restore-JwgbCommandProcessorAutoRun `
                -RegistryPath $registryPath `
                -ValueName $valueName `
                -Value $originalValue `
                -ValueKind $originalKind
        }
    }
}

function Restore-JwgbCommandProcessorAutoRun {
    param(
        [Parameter(Mandatory = $true)]
        [string] $RegistryPath,

        [Parameter(Mandatory = $true)]
        [string] $ValueName,

        [Parameter(Mandatory = $true)]
        [object] $Value,

        [Parameter(Mandatory = $true)]
        [Microsoft.Win32.RegistryValueKind] $ValueKind
    )

    $registryKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(
        $RegistryPath,
        $true
    )
    try {
        $currentValue = $registryKey.GetValue(
            $ValueName,
            $null,
            [Microsoft.Win32.RegistryValueOptions]::
                DoNotExpandEnvironmentNames
        )
        if ($currentValue -eq $null) {
            $registryKey.SetValue($ValueName, $Value, $ValueKind)
        } elseif ($currentValue -ne $Value) {
            Write-Warning (
                "Command Processor AutoRun changed during the Unity build; " +
                "the newer value was preserved."
            )
        }
    } finally {
        $registryKey.Dispose()
    }
}
