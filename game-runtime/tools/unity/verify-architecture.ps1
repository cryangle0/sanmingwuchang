Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)
. (Join-Path $scriptRoot 'PackageLockVerification.ps1')

Assert-JwgbUnityPackageLock `
    -ProjectPath (Join-Path $repositoryRoot 'unity')

$netcodeClientSettings = Join-Path `
    $repositoryRoot `
    'unity\ProjectSettings\NetCodeClientSettings.asset'
if (-not (
    Test-Path -LiteralPath $netcodeClientSettings -PathType Leaf
)) {
    throw "Netcode client-only settings are missing: $netcodeClientSettings"
}
$netcodeClientSettingsText = Get-Content `
    -LiteralPath $netcodeClientSettings `
    -Raw
if ($netcodeClientSettingsText -notmatch '(?m)^\s*ClientTarget:\s*0\s*$') {
    throw (
        'Netcode clients must use the Client-only target so player builds ' +
        'define UNITY_CLIENT and never auto-connect as ClientAndServer.'
    )
}
$buildCommandPath = Join-Path `
    $repositoryRoot `
    'unity\Assets\Jwgb\Editor\Build\BuildCommand.cs'
$buildCommandText = Get-Content -LiteralPath $buildCommandPath -Raw
if (
    $buildCommandText -notmatch
        'extraScriptingDefines\s*=\s*configuration\.ClientOnly' -or
    $buildCommandText -notmatch '"UNITY_CLIENT"'
) {
    throw (
        'Client build commands must pass UNITY_CLIENT explicitly so custom ' +
        'BuildPipeline players cannot fall back to ClientAndServer.'
    )
}

$protectedRoots = @(
    (Join-Path $repositoryRoot 'unity\Packages\com.jwgb.core\Runtime'),
    (Join-Path $repositoryRoot 'unity\Packages\com.jwgb.sim\Runtime')
)
$forbiddenPatterns = @(
    'using\s+UnityEngine',
    'UnityEngine\.',
    '\bMonoBehaviour\b',
    '\bGameObject\b',
    '\bRigidbody\b',
    '\bPhysics\.',
    '\bTime\.',
    '\bDateTime\.(Now|UtcNow)\b',
    '\bSystem\.Random\b',
    '\bUnity\.Mathematics\.Random\b'
)

$legacyLineLimits = @{
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Snapshot\StateHashPveValues.cs' = 402
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\CoreBossSystem.cs' = 1575
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\EquipmentLootPickupSystem.cs' = 478
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\EquipmentRuntimeSystem.cs' = 317
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\GamblingSystem.cs' = 586
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\LifeSystem.cs' = 666
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\MonsterDamageSystem.cs' = 359
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\MonsterDamageSystem.Loot.cs' = 447
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\PassiveKillSystem.cs' = 302
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\PveCatalog.cs' = 329
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\ShopInventoryFactory.cs' = 359
    'unity\Packages\com.jwgb.sim\Runtime\Deterministic\Systems\ShopSystem.cs' = 752
}

$violations = New-Object System.Collections.Generic.List[string]
foreach ($root in $protectedRoots) {
    Get-ChildItem -LiteralPath $root -Recurse -Filter '*.cs' | ForEach-Object {
        $file = $_
        $lineCount = (Get-Content -LiteralPath $file.FullName).Count
        $relativePath = $file.FullName.Substring(
            $repositoryRoot.Length + 1
        )
        $lineLimit = 300
        if ($legacyLineLimits.ContainsKey($relativePath)) {
            $lineLimit = $legacyLineLimits[$relativePath]
        }

        if ($lineCount -gt $lineLimit) {
            $violations.Add(
                "$($file.FullName): file has $lineCount lines; " +
                "limit is $lineLimit"
            )
        }

        foreach ($pattern in $forbiddenPatterns) {
            Select-String -LiteralPath $file.FullName -Pattern $pattern | ForEach-Object {
                $violations.Add(
                    "$($file.FullName):$($_.LineNumber): forbidden pattern '$pattern'"
                )
            }
        }
    }
}

if ($violations.Count -gt 0) {
    $violations | ForEach-Object { Write-Error $_ }
    throw "Unity architecture verification failed with $($violations.Count) violation(s)."
}

Write-Output 'Unity architecture verification passed.'
