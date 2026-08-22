[CmdletBinding()]
param(
    [string]$ReleaseId = (Get-Date -Format 'yyyyMMddHHmmss'),
    [switch]$SkipModels
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$sshKey = 'C:\Users\xinzh\.ssh\id_ed25519'
$sshTarget = 'root@47.84.61.45'
$cdnBase = 'https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl'
$webBase = "$cdnBase/current/"
$modelBase = "$cdnBase/models/v1/"
$tempRoot = Join-Path $env:TEMP "jwgb-web-deploy-$ReleaseId"
$credentialFile = Join-Path $root 'deploy\oss-credentials.txt'
$credentialNames = @(
    'OSS_ACCESS_KEY_ID',
    'OSS_ACCESS_KEY_SECRET',
    'OSS_ENDPOINT',
    'OSS_BUCKET_NAME',
    'OSS_BASE_PATH',
    'OSS_CDN_DOMAIN'
)
$loadedCredentialNames = @()

function Invoke-NativeWithRetry {
    param(
        [Parameter(Mandatory)]
        [scriptblock]$Command,
        [Parameter(Mandatory)]
        [string]$FailureMessage,
        [int]$Attempts = 4
    )

    for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
        & $Command
        $exitCode = $LASTEXITCODE
        if ($exitCode -eq 0) {
            return
        }
        if ($attempt -lt $Attempts) {
            Start-Sleep -Seconds ([Math]::Min(10, $attempt * 2))
        }
    }
    throw "$FailureMessage after $Attempts attempts"
}

if (-not (Test-Path -LiteralPath $sshKey -PathType Leaf)) {
    throw "SSH key not found: $sshKey"
}

if (Test-Path -LiteralPath $credentialFile -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $credentialFile) {
        if ($line -match '^\s*(OSS_[A-Z0-9_]+)\s*=\s*(.*?)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2]
            if ($credentialNames -contains $name -and
                [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name, 'Process'))) {
                Set-Item -Path "Env:$name" -Value $value
                $loadedCredentialNames += $name
            }
        }
    }
}

New-Item -ItemType Directory -Force -Path $tempRoot | Out-Null
try {
    $env:JWGB_RELEASE_ID = $ReleaseId
    $env:JWGB_WEB_BASE_URL = $webBase
    $env:VITE_MODEL_BASE_URL = $modelBase
    $env:VITE_PORTRAIT_BASE_URL = '/jwgb-assets/'
    $env:VITE_ASSET_VERSION = $ReleaseId

    Push-Location $root
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) {
            throw 'project build failed'
        }
        if ($SkipModels) {
            & npx.cmd tsx tools/deploy/upload-web-assets.ts --skip-models
        }
        else {
            & npx.cmd tsx tools/deploy/upload-web-assets.ts
        }
        if ($LASTEXITCODE -ne 0) {
            throw 'OSS upload failed'
        }
    }
    finally {
        Pop-Location
    }

    Copy-Item -LiteralPath (Join-Path $root 'apps\server\dist\server.mjs') `
        -Destination (Join-Path $tempRoot 'server.mjs') -Force
    Copy-Item -LiteralPath (Join-Path $root 'deploy\server\package.json') `
        -Destination (Join-Path $tempRoot 'package.json') -Force
    Copy-Item -LiteralPath (Join-Path $root 'deploy\systemd\jwgb-web.service') `
        -Destination (Join-Path $tempRoot 'jwgb-web.service') -Force
    Copy-Item -LiteralPath (Join-Path $root 'deploy\nginx\fanavatar.org.conf') `
        -Destination (Join-Path $tempRoot 'fanavatar.org.conf') -Force
    Copy-Item -LiteralPath (Join-Path $root 'apps\web\dist\index.html') `
        -Destination (Join-Path $tempRoot 'index.html') -Force

    $bundlePath = Join-Path $tempRoot 'deploy-bundle.tar.gz'
    # Archive from inside the staging directory using a relative output name.
    # Whichever tar comes first on PATH has to work: GNU tar reads the drive
    # letter of an absolute Windows path as a remote host and fails with
    # "Cannot connect to C: resolve failed", and bsdtar has no --force-local to
    # opt out of that reading. A relative name has no colon for either to
    # misinterpret.
    Push-Location -LiteralPath $tempRoot
    try {
        & tar.exe -czf 'deploy-bundle.tar.gz' `
            server.mjs package.json jwgb-web.service fanavatar.org.conf index.html
    }
    finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) {
        throw 'deployment bundle creation failed'
    }
    $remoteArchive = "/tmp/jwgb-web-deploy-$ReleaseId.tar.gz"
    Invoke-NativeWithRetry -FailureMessage 'scp deployment bundle failed' -Command {
        & scp -i $sshKey -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new `
            -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 `
            $bundlePath "$sshTarget`:$remoteArchive"
    }

    $remoteScript = @'
set -eu
release_id='__RELEASE_ID__'
remote_archive='__REMOTE_ARCHIVE__'
remote_dir=$(mktemp -d "/tmp/jwgb-web-deploy-${release_id}.XXXXXX")
cleanup() {
  rm -rf "$remote_dir"
  rm -f "$remote_archive"
}
trap cleanup EXIT
tar -xzf "$remote_archive" -C "$remote_dir"

if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi

if ! id -u jwgb-web >/dev/null 2>&1; then
  useradd --system --home-dir /opt/jwgb-web --shell /usr/sbin/nologin jwgb-web
fi

install -d -o jwgb-web -g jwgb-web /opt/jwgb-web/current
install -d -o jwgb-web -g jwgb-web /opt/jwgb-web/.npm
install -m 0755 "$remote_dir/server.mjs" /opt/jwgb-web/current/server.mjs
install -m 0644 "$remote_dir/package.json" /opt/jwgb-web/current/package.json
chown -R jwgb-web:jwgb-web /opt/jwgb-web/current
cd /opt/jwgb-web/current
runuser -u jwgb-web -- npm install --omit=dev --no-audit --no-fund --cache /opt/jwgb-web/.npm

install -m 0644 "$remote_dir/jwgb-web.service" /etc/systemd/system/jwgb-web.service
install -m 0644 "$remote_dir/fanavatar.org.conf" /etc/nginx/sites-enabled/fanavatar.org
install -m 0644 "$remote_dir/index.html" /var/www/fanavatar.org/index.html

systemctl daemon-reload
systemctl enable jwgb-web.service
systemctl restart jwgb-web.service
nginx -t
systemctl reload nginx
systemctl is-active --quiet jwgb-web.service
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8787/health >/dev/null; then
    break
  fi
  sleep 1
done
curl --fail --silent --show-error http://127.0.0.1:8787/health
printf '\n'
printf 'deployed release %s\n' "$release_id"
'@
    $remoteScript = $remoteScript.Replace('__RELEASE_ID__', $ReleaseId)
    $remoteScript = $remoteScript.Replace('__REMOTE_ARCHIVE__', $remoteArchive)
    # The remote end is bash. This file is stored with CRLF endings, so the
    # here-string carries them into the payload and every line reaches the
    # server with a trailing carriage return; bash then reports a syntax error
    # at the first brace and the deployment dies remotely rather than here.
    $remoteScript = $remoteScript.Replace("`r`n", "`n")
    $remoteBytes = [Text.Encoding]::UTF8.GetBytes($remoteScript)
    $remoteBase64 = [Convert]::ToBase64String($remoteBytes)
    Invoke-NativeWithRetry -FailureMessage 'remote web deployment failed' -Command {
        & ssh -i $sshKey -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new `
            -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=2 `
            $sshTarget "echo $remoteBase64 | base64 -d | bash"
    }

    Write-Output "Web demo deployed: https://fanavatar.org/"
}
finally {
    $env:JWGB_RELEASE_ID = $null
    $env:JWGB_WEB_BASE_URL = $null
    $env:VITE_MODEL_BASE_URL = $null
    $env:VITE_PORTRAIT_BASE_URL = $null
    $env:VITE_ASSET_VERSION = $null
    foreach ($name in $loadedCredentialNames) {
        Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
    }
    $resolvedTempRoot = [IO.Path]::GetFullPath($tempRoot)
    $resolvedTemp = [IO.Path]::GetFullPath($env:TEMP)
    if ($resolvedTempRoot.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTempRoot -Force -Recurse -ErrorAction SilentlyContinue
    }
}
