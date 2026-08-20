param(
    [string] $ProjectCharactersRoot = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)

if ([string]::IsNullOrWhiteSpace($ProjectCharactersRoot)) {
    $ProjectCharactersRoot = Join-Path $repositoryRoot `
        'unity\Assets\ProceduralHeroes\Characters'
}

function Get-AssetPath {
    param([string] $FullPath)

    $assetsRoot = [System.IO.Path]::GetFullPath(
        (Join-Path $repositoryRoot 'unity\Assets')
    )
    $resolved = [System.IO.Path]::GetFullPath($FullPath)
    if (-not $resolved.StartsWith(
        $assetsRoot + '\',
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Path is outside Unity Assets: $resolved"
    }
    return 'Assets/' + $resolved.Substring($assetsRoot.Length + 1).Replace('\', '/')
}

function Write-Utf8Json {
    param(
        [string] $Path,
        [object] $Value
    )

    $json = $Value | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        $Path,
        $json + [Environment]::NewLine,
        [System.Text.UTF8Encoding]::new($false)
    )
}

$normalized = 0
foreach ($directory in Get-ChildItem -LiteralPath $ProjectCharactersRoot -Directory) {
    $fbx = @(
        Get-ChildItem -LiteralPath $directory.FullName -File -Filter '*.fbx'
    )
    $clips = @(
        Get-ChildItem -LiteralPath $directory.FullName -File -Filter '*.clips.json'
    )
    $validation = @(
        Get-ChildItem -LiteralPath $directory.FullName -File `
            -Filter '*.validation.json'
    )
    $textures = @(
        Get-ChildItem -LiteralPath $directory.FullName -Recurse -File |
            Where-Object {
                $_.Extension -iin @(
                    '.png',
                    '.jpg',
                    '.jpeg',
                    '.tga',
                    '.psd',
                    '.exr'
                )
            }
    )

    if ($fbx.Count -ne 1 -or
        $clips.Count -ne 1 -or
        $validation.Count -ne 1 -or
        $textures.Count -lt 1) {
        throw "Incomplete character delivery: $($directory.FullName)"
    }

    $validationRaw = Get-Content -LiteralPath $validation[0].FullName `
        -Raw -Encoding UTF8
    if ($validationRaw -notmatch '"status"\s*:\s*"passed"') {
        throw "Source validation did not pass: $($directory.Name)"
    }

    $textureRows = @(
        foreach ($texture in $textures) {
            [ordered]@{
                assetPath = Get-AssetPath $texture.FullName
                bytes = [long]$texture.Length
            }
        }
    )

    $clipDocument = [ordered]@{
        schema = 'jwgb.model-clips.v1'
        modelName = $directory.Name
        assetPath = Get-AssetPath $fbx[0].FullName
        bytes = [long]$fbx[0].Length
        fps = 24
        timeline = @(1, 144)
        clips = [ordered]@{
            Idle = [ordered]@{
                firstFrame = 1
                lastFrame = 48
                loop = $true
            }
            Move = [ordered]@{
                firstFrame = 49
                lastFrame = 96
                loop = $true
            }
            Attack = [ordered]@{
                firstFrame = 97
                lastFrame = 120
                loop = $false
            }
            Spell = [ordered]@{
                firstFrame = 121
                lastFrame = 144
                loop = $false
            }
        }
        root = "$($directory.Name)_Root"
        textures = $textureRows
        status = 'exported'
    }

    $validationDocument = [ordered]@{
        schema = 'jwgb.model-validation.v1'
        modelName = $directory.Name
        assetPath = Get-AssetPath $fbx[0].FullName
        bytes = [long]$fbx[0].Length
        expectedClips = @('Idle', 'Move', 'Attack', 'Spell')
        errors = @()
        status = 'passed'
    }

    Write-Utf8Json $clips[0].FullName $clipDocument
    Write-Utf8Json $validation[0].FullName $validationDocument
    $normalized += 1
}

Write-Output "Normalized $normalized model sidecar pairs."
