Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Format-JwgbJson {
    param(
        [Parameter(Mandatory = $true)]
        [string] $Json
    )

    $builder = New-Object System.Text.StringBuilder
    $indent = 0
    $inString = $false
    $escaped = $false
    $characters = $Json.ToCharArray()

    for ($index = 0; $index -lt $characters.Length; $index++) {
        $character = $characters[$index]
        if ($inString) {
            [void]$builder.Append($character)
            if ($escaped) {
                $escaped = $false
            } elseif ($character -eq '\') {
                $escaped = $true
            } elseif ($character -eq '"') {
                $inString = $false
            }
            continue
        }

        if ($character -eq '"') {
            $inString = $true
            [void]$builder.Append($character)
        } elseif ($character -eq '{' -or $character -eq '[') {
            [void]$builder.Append($character)
            $closingCharacter = if ($character -eq '{') { '}' } else { ']' }
            $isEmpty = (
                $index + 1 -lt $characters.Length -and
                $characters[$index + 1] -eq $closingCharacter
            )
            if (-not $isEmpty) {
                $indent++
                Add-JwgbJsonLineBreak `
                    -Builder $builder `
                    -Indent $indent
            }
        } elseif ($character -eq '}' -or $character -eq ']') {
            $openingCharacter = if ($character -eq '}') { '{' } else { '[' }
            $isEmpty = (
                $index -gt 0 -and
                $characters[$index - 1] -eq $openingCharacter
            )
            if (-not $isEmpty) {
                $indent--
                Add-JwgbJsonLineBreak `
                    -Builder $builder `
                    -Indent $indent
            }
            [void]$builder.Append($character)
        } elseif ($character -eq ',') {
            [void]$builder.Append($character)
            Add-JwgbJsonLineBreak `
                -Builder $builder `
                -Indent $indent
        } elseif ($character -eq ':') {
            [void]$builder.Append(': ')
        } elseif (-not [char]::IsWhiteSpace($character)) {
            [void]$builder.Append($character)
        }
    }

    return $builder.ToString()
}

function Add-JwgbJsonLineBreak {
    param(
        [Parameter(Mandatory = $true)]
        [System.Text.StringBuilder] $Builder,

        [Parameter(Mandatory = $true)]
        [int] $Indent
    )

    [void]$Builder.Append("`n")
    [void]$Builder.Append(' ' * ($Indent * 2))
}
