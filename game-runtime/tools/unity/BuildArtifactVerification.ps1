Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'JsonOutput.ps1')

function Get-JwgbBuildArtifact {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet(
            'windows',
            'windows-stress',
            'windows-network-debug',
            'android',
            'linux-server'
        )]
        [string] $Target,

        [Parameter(Mandatory = $true)]
        [string] $ProjectPath
    )

    $buildRoot = if ([string]::IsNullOrWhiteSpace($env:JWGB_BUILD_ROOT)) {
        Join-Path $ProjectPath 'Builds'
    } else {
        $env:JWGB_BUILD_ROOT
    }
    $buildRoot = [System.IO.Path]::GetFullPath($buildRoot)

    $definitions = @{
        'windows' = @{
            Directory = 'windows-client'
            Executable = 'JourneyWestGreatBrawl.exe'
            RequiredDirectories = @(
                'JourneyWestGreatBrawl_Data'
            )
            RequiredFiles = @(
                'UnityPlayer.dll'
                'GameAssembly.dll'
                'JourneyWestGreatBrawl_Data\Plugins\x86_64\lib_burst_generated.dll'
            )
        }
        'windows-stress' = @{
            Directory = 'windows-stress'
            Executable = 'JourneyWestGreatBrawlStress.exe'
            RequiredDirectories = @(
                'JourneyWestGreatBrawlStress_Data'
            )
            RequiredFiles = @(
                'UnityPlayer.dll'
                'GameAssembly.dll'
                'JourneyWestGreatBrawlStress_Data\Plugins\x86_64\lib_burst_generated.dll'
            )
        }
        'windows-network-debug' = @{
            Directory = 'windows-network-debug'
            Executable = 'JourneyWestGreatBrawlNetworkDebug.exe'
            RequiredDirectories = @(
                'JourneyWestGreatBrawlNetworkDebug_Data'
            )
            RequiredFiles = @(
                'UnityPlayer.dll'
                'GameAssembly.dll'
                'JourneyWestGreatBrawlNetworkDebug_Data\Plugins\x86_64\lib_burst_generated.dll'
            )
        }
        'android' = @{
            Directory = 'android-client'
            Executable = 'JourneyWestGreatBrawl.apk'
            RequiredDirectories = @()
            RequiredFiles = @()
        }
        'linux-server' = @{
            Directory = 'linux-server'
            Executable = 'JourneyWestGreatBrawl.x86_64'
            RequiredDirectories = @(
                'JourneyWestGreatBrawl_Data'
            )
            RequiredFiles = @(
                'UnityPlayer.so'
                'GameAssembly.so'
                'JourneyWestGreatBrawl_Data\Plugins\lib_burst_generated.so'
            )
        }
    }

    $definition = $definitions[$Target]
    $outputDirectory = [System.IO.Path]::GetFullPath(
        (Join-Path $buildRoot $definition.Directory)
    )

    [pscustomobject]@{
        Target = $Target
        BuildRoot = $buildRoot
        OutputDirectory = $outputDirectory
        ExecutablePath = Join-Path $outputDirectory $definition.Executable
        RequiredDirectoryPaths = @(
            $definition.RequiredDirectories |
                ForEach-Object { Join-Path $outputDirectory $_ }
        )
        RequiredFilePaths = @(
            $definition.RequiredFiles |
                ForEach-Object { Join-Path $outputDirectory $_ }
        )
        ReportName = "build-$Target.json"
    }
}

function Remove-JwgbBuildOutput {
    param(
        [Parameter(Mandatory = $true)]
        [psobject] $Artifact
    )

    Assert-JwgbChildPath `
        -ParentPath $Artifact.BuildRoot `
        -ChildPath $Artifact.OutputDirectory

    if (Test-Path -LiteralPath $Artifact.OutputDirectory) {
        Remove-Item `
            -LiteralPath $Artifact.OutputDirectory `
            -Recurse `
            -Force
    }
}

function Assert-JwgbBuildArtifact {
    param(
        [Parameter(Mandatory = $true)]
        [psobject] $Artifact,

        [Parameter(Mandatory = $true)]
        [DateTime] $StartedAtUtc
    )

    if (-not (Test-Path -LiteralPath $Artifact.ExecutablePath -PathType Leaf)) {
        throw "Expected build artifact is missing: $($Artifact.ExecutablePath)"
    }

    $executable = Get-Item -LiteralPath $Artifact.ExecutablePath
    if ($executable.Length -le 0) {
        throw "Build artifact is empty: $($Artifact.ExecutablePath)"
    }

    if ($executable.LastWriteTimeUtc -lt $StartedAtUtc.AddSeconds(-2)) {
        throw "Build artifact is stale: $($Artifact.ExecutablePath)"
    }

    foreach ($requiredDirectory in $Artifact.RequiredDirectoryPaths) {
        if (-not (
            Test-Path -LiteralPath $requiredDirectory -PathType Container
        )) {
            throw "Required build directory is missing: $requiredDirectory"
        }
    }

    foreach ($requiredFile in $Artifact.RequiredFilePaths) {
        if (-not (Test-Path -LiteralPath $requiredFile -PathType Leaf)) {
            throw "Required build file is missing: $requiredFile"
        }

        $file = Get-Item -LiteralPath $requiredFile
        if ($file.Length -le 0) {
            throw "Required build file is empty: $requiredFile"
        }

        if ($file.LastWriteTimeUtc -lt $StartedAtUtc.AddSeconds(-2)) {
            throw "Required build file is stale: $requiredFile"
        }
    }
}

function Write-JwgbBuildReport {
    param(
        [Parameter(Mandatory = $true)]
        [psobject] $Artifact,

        [Parameter(Mandatory = $true)]
        [string] $RepositoryRoot,

        [Parameter(Mandatory = $true)]
        [DateTime] $StartedAtUtc
    )

    $reportDirectory = Join-Path $RepositoryRoot 'migration\reports\unity'
    New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null

    $artifactFiles = @(
        @($Artifact.ExecutablePath) + @($Artifact.RequiredFilePaths) |
            ForEach-Object {
                $file = Get-Item -LiteralPath $_
                $hash = Get-FileHash -LiteralPath $_ -Algorithm SHA256
                [ordered]@{
                    path = Get-JwgbRelativeBuildPath `
                        -RootPath $Artifact.OutputDirectory `
                        -FilePath $file.FullName
                    bytes = $file.Length
                    sha256 = $hash.Hash.ToLowerInvariant()
                }
            }
    )
    $executable = $artifactFiles[0]
    $projectVersion = Get-Content `
        -LiteralPath (Join-Path $RepositoryRoot 'unity\ProjectSettings\ProjectVersion.txt') |
        Where-Object { $_ -like 'm_EditorVersion:*' } |
        ForEach-Object { ($_ -split ':', 2)[1].Trim() }
    $commit = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
    $sourceDirty = @(& git -C $RepositoryRoot status --porcelain).Count -gt 0

    $report = [ordered]@{
        schema = 'jwgb.unity.build-report.v2'
        target = $Artifact.Target
        unityVersion = $projectVersion
        sourceCommit = $commit
        sourceDirty = $sourceDirty
        developmentBuild = $env:JWGB_DEVELOPMENT_BUILD -eq '1'
        startedAtUtc = $StartedAtUtc.ToString('o')
        completedAtUtc = [DateTime]::UtcNow.ToString('o')
        artifactPath = $Artifact.ExecutablePath
        artifactBytes = $executable.bytes
        artifactSha256 = $executable.sha256
        artifactFiles = $artifactFiles
    }
    $json = Format-JwgbJson (
        $report |
            ConvertTo-Json -Depth 4 -Compress
    )
    $reportPath = Join-Path $reportDirectory $Artifact.ReportName
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText(
        $reportPath,
        $json + "`n",
        $utf8WithoutBom
    )
}

function Get-JwgbRelativeBuildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $RootPath,

        [Parameter(Mandatory = $true)]
        [string] $FilePath
    )

    $root = [System.IO.Path]::GetFullPath($RootPath).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $file = [System.IO.Path]::GetFullPath($FilePath)
    $prefix = $root + [System.IO.Path]::DirectorySeparatorChar
    if (-not $file.StartsWith(
        $prefix,
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build report file escapes its output directory: $file"
    }

    return $file.Substring($prefix.Length).Replace('\', '/')
}

function Assert-JwgbChildPath {
    param(
        [Parameter(Mandatory = $true)]
        [string] $ParentPath,

        [Parameter(Mandatory = $true)]
        [string] $ChildPath
    )

    $parent = [System.IO.Path]::GetFullPath($ParentPath).TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
    $child = [System.IO.Path]::GetFullPath($ChildPath)
    $requiredPrefix = $parent + [System.IO.Path]::DirectorySeparatorChar

    if (-not $child.StartsWith(
        $requiredPrefix,
        [StringComparison]::OrdinalIgnoreCase)) {
        throw "Build output escapes its configured root: $child"
    }
}
