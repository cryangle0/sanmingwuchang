Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Assert-JwgbUnityPackageLock {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ProjectPath
    )

    $manifestPath = Join-Path $ProjectPath 'Packages\manifest.json'
    $lockPath = Join-Path $ProjectPath 'Packages\packages-lock.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "Unity package manifest is missing: $manifestPath"
    }
    if (-not (Test-Path -LiteralPath $lockPath -PathType Leaf)) {
        throw "Unity package lock is missing: $lockPath"
    }

    $manifest = Get-Content -LiteralPath $manifestPath -Raw |
        ConvertFrom-Json
    $lock = Get-Content -LiteralPath $lockPath -Raw |
        ConvertFrom-Json
    $violations = New-Object System.Collections.Generic.List[string]

    foreach ($dependency in $manifest.dependencies.PSObject.Properties) {
        $name = $dependency.Name
        $expectedVersion = [string]$dependency.Value
        $lockedProperty = $lock.dependencies.PSObject.Properties[$name]
        if ($null -eq $lockedProperty) {
            $violations.Add("$name is missing from packages-lock.json")
            continue
        }

        $lockedDependency = $lockedProperty.Value
        if ([int]$lockedDependency.depth -ne 0) {
            $violations.Add("$name is not locked at depth 0")
        }
        if ([string]$lockedDependency.version -ne $expectedVersion) {
            $violations.Add(
                "$name expects $expectedVersion but locks " +
                "$($lockedDependency.version)"
            )
        }
    }

    foreach ($dependency in $lock.dependencies.PSObject.Properties) {
        $lockedDependency = $dependency.Value
        $isDirectUnityPackage =
            [int]$lockedDependency.depth -eq 0 -and
            $dependency.Name.StartsWith(
                'com.unity.',
                [StringComparison]::Ordinal
            )
        if (-not $isDirectUnityPackage) {
            continue
        }

        $manifestProperty =
            $manifest.dependencies.PSObject.Properties[$dependency.Name]
        if ($null -eq $manifestProperty) {
            $violations.Add(
                "$($dependency.Name) is depth 0 in packages-lock.json " +
                "but absent from manifest.json"
            )
        }
    }

    if ($violations.Count -gt 0) {
        $violations | ForEach-Object { Write-Error $_ }
        throw (
            "Unity package lock verification failed with " +
            "$($violations.Count) violation(s)."
        )
    }

    Write-Output 'Unity package lock verification passed.'
}
