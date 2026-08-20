param(
    [string] $ProjectCharactersRoot = '',
    [string] $HeroSourceRoot = 'E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\Unity技术交付_38英雄_单体优化版',
    [string] $MonsterSourceRoot = 'E:\angsa\angsa_data\Games\JourneyWestGreatBrawl\Unity技术交付_38野怪_单体优化版',
    [string] $ReportPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = [System.IO.Path]::GetFullPath(
    (Join-Path $scriptRoot '..\..')
)

if ([string]::IsNullOrWhiteSpace($ProjectCharactersRoot)) {
    $ProjectCharactersRoot = Join-Path $repositoryRoot 'unity\Assets\ProceduralHeroes\Characters'
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path $repositoryRoot `
        'migration\reports\unity\model-delivery-verification.json'
}

function Get-CharacterRows {
    param([string] $Root)

    if (-not (Test-Path -LiteralPath $Root -PathType Container)) {
        throw "Character root does not exist: $Root"
    }

    foreach ($directory in Get-ChildItem -LiteralPath $Root -Directory) {
        $files = @(Get-ChildItem -LiteralPath $directory.FullName -Recurse -File)
        $fbx = @($files | Where-Object { $_.Extension -ieq '.fbx' })
        $textures = @(
            $files | Where-Object {
                $_.Extension -iin @('.png', '.jpg', '.jpeg', '.tga', '.psd', '.exr')
            }
        )
        $clips = @($files | Where-Object { $_.Name -like '*.clips.json' })
        $validation = @(
            $files | Where-Object { $_.Name -like '*.validation.json' }
        )
        [pscustomobject]@{
            Name = $directory.Name
            Root = $directory.FullName
            FbxCount = $fbx.Count
            TextureCount = $textures.Count
            ClipsCount = $clips.Count
            ValidationCount = $validation.Count
            FbxBytes = [long](($fbx | Measure-Object Length -Sum).Sum)
            TextureBytes = [long](($textures | Measure-Object Length -Sum).Sum)
            FbxPath = if ($fbx.Count -eq 1) { $fbx[0].FullName } else { $null }
            ClipsPath = if ($clips.Count -eq 1) { $clips[0].FullName } else { $null }
            ValidationPath = if ($validation.Count -eq 1) {
                $validation[0].FullName
            } else {
                $null
            }
        }
    }
}

function Read-ReportStatus {
    param([string] $Path)

    if ([string]::IsNullOrWhiteSpace($Path) -or
        -not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{
            Status = 'missing'
            JsonValid = $false
            Fps = $null
            Timeline = $null
            Clips = @()
        }
    }

    $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
    try {
        $json = $raw | ConvertFrom-Json
        $fps = if ($null -ne $json.PSObject.Properties['fps']) {
            [int]$json.fps
        } else {
            $null
        }
        $timeline = if ($null -ne $json.PSObject.Properties['timeline']) {
            @($json.timeline)
        } else {
            $null
        }
        $clips = if ($null -ne $json.PSObject.Properties['clips']) {
            @(
                $json.clips.psobject.Properties | ForEach-Object {
                    [pscustomobject]@{
                        Name = $_.Name
                        FirstFrame = [int]$_.Value.firstFrame
                        LastFrame = [int]$_.Value.lastFrame
                        Loop = [bool]$_.Value.loop
                    }
                }
            )
        } else {
            @()
        }
        return [pscustomobject]@{
            Status = [string]$json.status
            JsonValid = $true
            Fps = $fps
            Timeline = $timeline
            Clips = $clips
        }
    } catch {
        $status = if ($raw -match '"status"\s*:\s*"([^"]+)"') {
            $matches[1]
        } else {
            'missing'
        }
        $fps = if ($raw -match '"fps"\s*:\s*(\d+)') {
            [int]$matches[1]
        } else {
            $null
        }
        $clipNames = @('Idle', 'Move', 'Attack', 'Spell')
        $clips = foreach ($clipName in $clipNames) {
            $pattern = '"' + $clipName +
                '"\s*:\s*\{\s*"firstFrame"\s*:\s*(\d+)\s*,\s*"lastFrame"\s*:\s*(\d+)'
            if ($raw -match $pattern) {
                [pscustomobject]@{
                    Name = $clipName
                    FirstFrame = [int]$matches[1]
                    LastFrame = [int]$matches[2]
                    Loop = $null
                }
            }
        }
        return [pscustomobject]@{
            Status = $status
            JsonValid = $false
            Fps = $fps
            Timeline = $null
            Clips = @($clips)
        }
    }
}

function Read-OptimizationReport {
    param([string] $Root)

    $path = Join-Path $Root 'individual_model_optimization_report.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return $null
    }
    return Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Get-HeroAliases {
    return @{
        '铁山公主' = 'H001'
        '青狮精' = 'H017'
        '独角四大王' = 'H019'
        '如来' = 'H029'
    }
}

function Get-HeroIds {
    return @(
        'H001', 'H002', 'H003', 'H004', 'H005', 'H006', 'H007', 'H008',
        'H009', 'H010', 'H011', 'H012', 'H013', 'H014', 'H015', 'H016',
        'H017', 'H018', 'H019', 'H020', 'H021', 'H022', 'H023', 'H024',
        'H025', 'H026', 'H027', 'H028', 'H029', 'H030', 'H031', 'H032',
        'H033', 'H034', 'H035', 'H036', 'H037', 'H038'
    )
}

function Get-ModelId {
    param(
        [string] $Name,
        [string] $Package
    )
    if ($Package -eq 'hero') {
        $aliases = Get-HeroAliases
        if ($aliases.ContainsKey($Name)) {
            return $aliases[$Name]
        }
        $heroNames = @(
            '铁扇公主', '红孩儿', '蜘蛛精', '蝎子精', '多目怪', '九头虫',
            '黄风怪', '太上老君', '孙悟空', '二郎神', '哪吒', '六耳猕猴',
            '大鹏雕', '白骨精', '猪八戒', '白龙马', '青狮怪', '牛魔王',
            '独角兕大王', '黄眉老祖', '金角大王', '银角大王', '黄袍怪',
            '虎力大仙', '鹿力大仙', '文殊菩萨', '普贤菩萨', '镇元大仙',
            '如来佛祖', '观音菩萨', '托塔李天王', '唐僧', '沙和尚',
            '黑熊精', '白象精', '灵感大王', '羊力大仙', '赛太岁'
        )
        $index = [array]::IndexOf($heroNames, $Name)
        if ($index -ge 0) {
            return 'H{0:D3}' -f ($index + 1)
        }
        return $null
    }
    return 'M{0:D3}' -f (
        [array]::IndexOf(
            @(
                '倚海龙', '刁钻古怪', '南山大王（精英怪）', '古怪刁钻',
                '如意真仙', '孔雀公主（飞行）', '寅将军（精英怪）', '巴山虎',
                '晦月魔君（飞行）', '树鬼', '混天大圣（飞行）', '火鸦精',
                '熊山君（精英怪）', '特处士（精英怪）', '玉面狐狸（肥猪）',
                '碧水金睛兽（飞行）', '红鳞大蟒', '肥猪（土）', '肥猪（木）',
                '肥猪（水）', '肥猪（火）', '肥猪（金）', '苍狼精', '虎精小妖',
                '蛇精小妖', '蜘蛛仔', '超级BOSS九灵元圣', '超级BOSS地涌夫人',
                '超级BOSS白鹿魔王', '超级BOSS辟寒大王', '超级BOSS辟尘大王',
                '超级BOSS辟暑大王', '黄狮精', '龙王（土）', '龙王（木）',
                '龙王（水）', '龙王（火）', '龙王（金）'
            ),
            $Name
        ) + 1
    )
}

$projectRows = @(Get-CharacterRows $ProjectCharactersRoot)

# The merged project folder contains both packages. The source reports are
# used only to distinguish hero and monster rows during validation.
$heroNames = @(
    '九头虫', '二郎神', '六耳猕猴', '哪吒', '唐僧', '多目怪', '大鹏雕',
    '太上老君', '如来', '孙悟空', '托塔李天王', '文殊菩萨', '普贤菩萨',
    '沙和尚', '灵感大王', '牛魔王', '独角四大王', '猪八戒', '白象精',
    '白骨精', '白龙马', '红孩儿', '羊力大仙', '虎力大仙', '蜘蛛精',
    '蝎子精', '观音菩萨', '赛太岁', '金角大王', '铁山公主', '银角大王',
    '镇元大仙', '青狮精', '鹿力大仙', '黄眉老祖', '黄袍怪', '黄风怪',
    '黑熊精'
)
$monsterNames = @(
    '倚海龙', '刁钻古怪', '南山大王（精英怪）', '古怪刁钻', '如意真仙',
    '孔雀公主（飞行）', '寅将军（精英怪）', '巴山虎', '晦月魔君（飞行）',
    '树鬼', '混天大圣（飞行）', '火鸦精', '熊山君（精英怪）',
    '特处士（精英怪）', '玉面狐狸（肥猪）', '碧水金睛兽（飞行）',
    '红鳞大蟒', '肥猪（土）', '肥猪（木）', '肥猪（水）', '肥猪（火）',
    '肥猪（金）', '苍狼精', '虎精小妖', '蛇精小妖', '蜘蛛仔',
    '超级BOSS九灵元圣', '超级BOSS地涌夫人', '超级BOSS白鹿魔王',
    '超级BOSS辟寒大王', '超级BOSS辟尘大王', '超级BOSS辟暑大王',
    '黄狮精', '龙王（土）', '龙王（木）', '龙王（水）', '龙王（火）',
    '龙王（金）'
)

$rows = foreach ($row in $projectRows) {
    $package = if ($heroNames -contains $row.Name) { 'hero' } else { 'monster' }
    $report = Read-ReportStatus $row.ValidationPath
    $clipReport = Read-ReportStatus $row.ClipsPath
    [pscustomobject]@{
        Name = $row.Name
        Package = $package
        ModelId = Get-ModelId $row.Name $package
        FbxCount = $row.FbxCount
        TextureCount = $row.TextureCount
        ClipsCount = $row.ClipsCount
        ValidationCount = $row.ValidationCount
        ValidationStatus = $report.Status
        ValidationJsonValid = $report.JsonValid
        ClipStatus = $clipReport.Status
        ClipJsonValid = $clipReport.JsonValid
        Fps = $clipReport.Fps
        ClipNames = @($clipReport.Clips | ForEach-Object Name)
        ClipRanges = @($clipReport.Clips | ForEach-Object {
            '{0}:{1}-{2}' -f $_.Name, $_.FirstFrame, $_.LastFrame
        })
        FbxBytes = $row.FbxBytes
        TextureBytes = $row.TextureBytes
    }
}

$expectedHeroCount = 38
$expectedMonsterCount = 38
$errors = @()
$sourceAssetRows = @()
foreach ($row in $rows) {
    $sourceRoot = if ($row.Package -eq 'hero') {
        $HeroSourceRoot
    } else {
        $MonsterSourceRoot
    }
    $sourceCharactersRoot = Join-Path $sourceRoot `
        'Assets\ProceduralHeroes\Characters'
    $sourceDirectory = Join-Path $sourceCharactersRoot $row.Name
    $sourceFbx = Join-Path $sourceDirectory "$($row.Name).fbx"
    $projectDirectory = Join-Path $ProjectCharactersRoot $row.Name
    $projectFbx = Join-Path $projectDirectory "$($row.Name).fbx"
    $sourceTextureRoot = Join-Path $sourceDirectory 'Textures'
    $projectTextureRoot = Join-Path $projectDirectory 'Textures'
    $sourceTextures = @(
        if (Test-Path -LiteralPath $sourceTextureRoot -PathType Container) {
            Get-ChildItem -LiteralPath $sourceTextureRoot -File |
                Where-Object { $_.Extension -iin @('.png', '.jpg', '.jpeg', '.tga', '.psd', '.exr') }
        }
    )
    $projectTextures = @(
        if (Test-Path -LiteralPath $projectTextureRoot -PathType Container) {
            Get-ChildItem -LiteralPath $projectTextureRoot -File |
                Where-Object { $_.Extension -iin @('.png', '.jpg', '.jpeg', '.tga', '.psd', '.exr') }
        }
    )
    $fbxMatch = $false
    if ((Test-Path -LiteralPath $sourceFbx -PathType Leaf) -and
        -not [string]::IsNullOrWhiteSpace($projectFbx) -and
        (Test-Path -LiteralPath $projectFbx -PathType Leaf)) {
        $sourceHash = (Get-FileHash -LiteralPath $sourceFbx -Algorithm SHA256).Hash
        $projectHash = (Get-FileHash -LiteralPath $projectFbx -Algorithm SHA256).Hash
        $fbxMatch = $sourceHash -eq $projectHash
    }
    $textureMismatchCount = 0
    $sourceTextureNames = @($sourceTextures | ForEach-Object Name)
    $projectTextureNames = @($projectTextures | ForEach-Object Name)
    if ((($sourceTextureNames | Sort-Object) -join "`n") -ne
        (($projectTextureNames | Sort-Object) -join "`n")) {
        $textureMismatchCount += 1
    }
    foreach ($sourceTexture in $sourceTextures) {
        $projectTexture = Join-Path $projectTextureRoot $sourceTexture.Name
        if (-not (Test-Path -LiteralPath $projectTexture -PathType Leaf)) {
            $textureMismatchCount += 1
            continue
        }
        $sourceTextureHash = (
            Get-FileHash -LiteralPath $sourceTexture.FullName -Algorithm SHA256
        ).Hash
        $projectTextureHash = (
            Get-FileHash -LiteralPath $projectTexture -Algorithm SHA256
        ).Hash
        if ($sourceTextureHash -ne $projectTextureHash) {
            $textureMismatchCount += 1
        }
    }
    $sourceAssetRows += [pscustomobject]@{
        ModelId = $row.ModelId
        Package = $row.Package
        SourceFbxPath = $sourceFbx
        ProjectFbxPath = $projectFbx
        FbxMatches = $fbxMatch
        SourceTextureCount = $sourceTextures.Count
        ProjectTextureCount = $projectTextures.Count
        TextureMismatchCount = $textureMismatchCount
        Matches = $fbxMatch -and $textureMismatchCount -eq 0
    }
    if (-not $fbxMatch) {
        $errors += "$($row.ModelId): project FBX differs from source"
    }
    if ($textureMismatchCount -gt 0) {
        $errors += "$($row.ModelId): project textures differ from source"
    }
}
$errors += @($rows | Where-Object {
    $_.FbxCount -ne 1 -or $_.TextureCount -lt 1 -or
    $_.ClipsCount -ne 1 -or $_.ValidationCount -ne 1
} | ForEach-Object { "$($_.Package)/$($_.Name): file layout incomplete" })
$errors += @($rows | Where-Object {
    $_.ValidationStatus -ne 'passed' -or $_.ClipStatus -ne 'exported'
} | ForEach-Object { "$($_.Package)/$($_.Name): report status failed" })
$errors += @($rows | Where-Object {
    $_.Fps -ne 24 -or
    (@($_.ClipNames) -join ',') -ne 'Idle,Move,Attack,Spell' -or
    (@($_.ClipRanges) -join ',') -notmatch 'Idle:1-48,Move:49-96,Attack:97-120,Spell:121-144'
} | ForEach-Object { "$($_.Package)/$($_.Name): animation layout mismatch" })
$errors += @($rows | Where-Object { [string]::IsNullOrWhiteSpace($_.ModelId) } |
    ForEach-Object { "$($_.Package)/$($_.Name): missing model id" })

$heroRowsResult = @($rows | Where-Object Package -eq 'hero')
$monsterRowsResult = @($rows | Where-Object Package -eq 'monster')
if ($heroRowsResult.Count -ne $expectedHeroCount) {
    $errors += "Expected $expectedHeroCount heroes, found $($heroRowsResult.Count)"
}
if ($monsterRowsResult.Count -ne $expectedMonsterCount) {
    $errors += "Expected $expectedMonsterCount monsters, found $($monsterRowsResult.Count)"
}

$optimizationReports = @()
foreach ($source in @(
    [pscustomobject]@{ Package = 'hero'; Root = $HeroSourceRoot },
    [pscustomobject]@{ Package = 'monster'; Root = $MonsterSourceRoot }
)) {
    $report = Read-OptimizationReport $source.Root
    if ($null -eq $report) {
        $errors += "$($source.Package): missing optimization report"
        continue
    }
    $optimizationReports += [pscustomobject]@{
        Package = $source.Package
        Expected = [int]$report.expected
        Completed = [int]$report.completed
        Failed = [int]$report.failed
        Status = [string]$report.status
        RatioRequested = [double]$report.ratio_requested
    }
    if ([int]$report.expected -ne 38 -or
        [int]$report.completed -ne 38 -or
        [int]$report.failed -ne 0 -or
        [string]$report.status -ne 'passed') {
        $errors += "$($source.Package): optimization report is not 38/38 passed"
    }
}

$reportObject = [pscustomobject]@{
    Schema = 'jwgb.model-delivery-verification.v1'
    GeneratedAtUtc = [DateTime]::UtcNow.ToString('o')
        ProjectCharactersRoot = $ProjectCharactersRoot
        Rows = $rows
        SourceAssets = $sourceAssetRows
        OptimizationReports = $optimizationReports
        Summary = [pscustomobject]@{
            HeroCount = $heroRowsResult.Count
            MonsterCount = $monsterRowsResult.Count
            FbxCount = [int](($rows | Measure-Object FbxCount -Sum).Sum)
            TextureCount = [int](($rows | Measure-Object TextureCount -Sum).Sum)
            SourceAssetCount = $sourceAssetRows.Count
            SourceAssetMismatchCount = [int](@(
                $sourceAssetRows | Where-Object { -not $_.Matches }
            ).Count)
            InvalidSidecarJsonCount = [int](@($rows | Where-Object {
                -not $_.ValidationJsonValid -or -not $_.ClipJsonValid
        }).Count)
        ErrorCount = $errors.Count
    }
    Errors = $errors
    Status = if ($errors.Count -eq 0) { 'passed' } else { 'failed' }
}

$reportDirectory = Split-Path -Parent $ReportPath
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
$reportObject | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReportPath -Encoding UTF8

if ($errors.Count -gt 0) {
    $errors | ForEach-Object { [Console]::Error.WriteLine($_) }
    exit 1
}

Write-Output ($reportObject | ConvertTo-Json -Depth 4)



