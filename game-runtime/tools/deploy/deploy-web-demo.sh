#!/usr/bin/env bash
# Deploy the Web demo from macOS / Linux.
#
# Same pipeline as deploy-web-demo.ps1: build → upload dist to OSS
# (releases/{id} + current) → ship server.mjs, systemd unit, nginx conf and
# index.html to the ECS → restart → health check. Differences:
#   * SSH key and OSS credentials are read from deploy/ (both gitignored), with
#     JWGB_SSH_KEY / JWGB_OSS_CREDENTIALS overrides.
#   * Character FBX models are never uploaded here (they need unity/Assets).
#   * If this machine cannot complete a TLS handshake with Aliyun OSS, the dist
#     is uploaded through the game server instead (JWGB_UPLOAD_VIA=ssh|local|auto).
#     Credentials travel to the relay over the SSH channel on stdin and are
#     never written to its disk.
#   * The previous server.mjs is kept as server.mjs.prev on the ECS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RELEASE_ID="${JWGB_RELEASE_ID:-$(date +%Y%m%d%H%M%S)}"
SSH_TARGET="${JWGB_SSH_TARGET:-root@47.84.61.45}"
SSH_KEY="${JWGB_SSH_KEY:-$ROOT/deploy/ssh-private-key.txt}"
CREDENTIALS="${JWGB_OSS_CREDENTIALS:-$ROOT/deploy/oss-credentials.txt}"
UPLOAD_VIA="${JWGB_UPLOAD_VIA:-auto}"
SKIP_BUILD="${JWGB_SKIP_BUILD:-0}"
CDN_BASE="https://vibe-files.aigcresearch.com/AIGame/JourneyWestGreatBrawl"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/jwgb-web-deploy-${RELEASE_ID}.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

log() { printf '\n==> %s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

[[ -f "$SSH_KEY" ]] || SSH_KEY="$HOME/.ssh/id_ed25519"
[[ -f "$SSH_KEY" ]] || die "SSH key not found (deploy/ssh-private-key.txt or ~/.ssh/id_ed25519)"
[[ -f "$CREDENTIALS" ]] || die "OSS credentials not found: $CREDENTIALS"
chmod 600 "$SSH_KEY" 2>/dev/null || true
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 -o ServerAliveInterval=10 -o ServerAliveCountMax=3)
SCP=(scp -i "$SSH_KEY" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

# Load OSS_* credentials into this process only.
while IFS= read -r line || [[ -n "$line" ]]; do
  if [[ "$line" =~ ^[[:space:]]*(OSS_[A-Z0-9_]+)[[:space:]]*=[[:space:]]*(.*)$ ]]; then
    name="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]%"${BASH_REMATCH[2]##*[![:space:]]}"}"
    [[ -n "${!name:-}" ]] || export "$name=$value"
  fi
done < "$CREDENTIALS"
for name in OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_ENDPOINT OSS_BUCKET_NAME OSS_BASE_PATH; do
  [[ -n "${!name:-}" ]] || die "$name missing from $CREDENTIALS"
done

cd "$ROOT"
export JWGB_RELEASE_ID="$RELEASE_ID"
export JWGB_WEB_BASE_URL="$CDN_BASE/current/"
export VITE_MODEL_BASE_URL="$CDN_BASE/models/v1/"
export VITE_PORTRAIT_BASE_URL="/jwgb-assets/"
export VITE_ASSET_VERSION="$RELEASE_ID"

if [[ "$SKIP_BUILD" != "1" ]]; then
  log "Building web + server (release $RELEASE_ID)"
  npm run build
fi
[[ -f apps/web/dist/index.html && -f apps/server/dist/server.mjs ]] || die "build outputs missing"

# Decide how to reach OSS.
if [[ "$UPLOAD_VIA" == "auto" ]]; then
  if curl -sS -m 10 -o /dev/null "https://${OSS_BUCKET_NAME}.${OSS_ENDPOINT}/" 2>/dev/null; then
    UPLOAD_VIA=local
  else
    log "This machine cannot reach OSS over TLS; relaying the upload through $SSH_TARGET"
    UPLOAD_VIA=ssh
  fi
fi

if [[ "$UPLOAD_VIA" == "local" ]]; then
  log "Uploading dist to OSS from this machine"
  npx tsx tools/deploy/upload-web-assets.ts --skip-models
else
  log "Packing dist for relay upload"
  tar -C apps/web -czf "$TMP/dist.tar.gz" dist
  "${SCP[@]}" "$TMP/dist.tar.gz" tools/deploy/oss-upload-dist.mjs "$SSH_TARGET:/tmp/"
  log "Uploading dist to OSS from the relay"
  # Credentials are exported inside the remote shell from this stdin script;
  # they never appear on a command line or in a file on the relay.
  "${SSH[@]}" "$SSH_TARGET" 'bash -s' <<REMOTE
set -euo pipefail
export OSS_ACCESS_KEY_ID='$OSS_ACCESS_KEY_ID'
export OSS_ACCESS_KEY_SECRET='$OSS_ACCESS_KEY_SECRET'
export OSS_ENDPOINT='$OSS_ENDPOINT'
export OSS_BUCKET_NAME='$OSS_BUCKET_NAME'
export OSS_BASE_PATH='$OSS_BASE_PATH'
work=\$(mktemp -d /tmp/jwgb-oss-relay-$RELEASE_ID.XXXXXX)
cleanup() { rm -rf "\$work" /tmp/dist.tar.gz /tmp/oss-upload-dist.mjs; }
trap cleanup EXIT
tar -xzf /tmp/dist.tar.gz -C "\$work"
cd "\$work"
printf '{"name":"jwgb-oss-relay","private":true,"type":"module"}' > package.json
npm install --no-audit --no-fund --silent ali-oss@6 >/dev/null
cp /tmp/oss-upload-dist.mjs ./upload.mjs
node upload.mjs "\$work/dist" '$RELEASE_ID'
REMOTE
fi

log "Bundling server release"
mkdir -p "$TMP/bundle"
cp apps/server/dist/server.mjs deploy/server/package.json deploy/systemd/jwgb-web.service deploy/nginx/fanavatar.org.conf apps/web/dist/index.html "$TMP/bundle/"
tar -C "$TMP/bundle" -czf "$TMP/deploy-bundle.tar.gz" server.mjs package.json jwgb-web.service fanavatar.org.conf index.html
REMOTE_ARCHIVE="/tmp/jwgb-web-deploy-$RELEASE_ID.tar.gz"
"${SCP[@]}" "$TMP/deploy-bundle.tar.gz" "$SSH_TARGET:$REMOTE_ARCHIVE"

log "Installing on $SSH_TARGET"
"${SSH[@]}" "$SSH_TARGET" 'bash -s' <<REMOTE
set -eu
release_id='$RELEASE_ID'
remote_archive='$REMOTE_ARCHIVE'
remote_dir=\$(mktemp -d "/tmp/jwgb-web-deploy-\${release_id}.XXXXXX")
cleanup() { rm -rf "\$remote_dir"; rm -f "\$remote_archive"; }
trap cleanup EXIT
tar -xzf "\$remote_archive" -C "\$remote_dir"
if ! command -v node >/dev/null 2>&1 || ! node --version | grep -Eq '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs
fi
if ! id -u jwgb-web >/dev/null 2>&1; then
  useradd --system --home-dir /opt/jwgb-web --shell /usr/sbin/nologin jwgb-web
fi
install -d -o jwgb-web -g jwgb-web /opt/jwgb-web/current /opt/jwgb-web/.npm
if [ -f /opt/jwgb-web/current/server.mjs ]; then
  cp -f /opt/jwgb-web/current/server.mjs /opt/jwgb-web/current/server.mjs.prev
fi
install -m 0755 "\$remote_dir/server.mjs" /opt/jwgb-web/current/server.mjs
install -m 0644 "\$remote_dir/package.json" /opt/jwgb-web/current/package.json
chown -R jwgb-web:jwgb-web /opt/jwgb-web/current
cd /opt/jwgb-web/current
runuser -u jwgb-web -- npm install --omit=dev --no-audit --no-fund --cache /opt/jwgb-web/.npm
install -m 0644 "\$remote_dir/jwgb-web.service" /etc/systemd/system/jwgb-web.service
install -m 0644 "\$remote_dir/fanavatar.org.conf" /etc/nginx/sites-enabled/fanavatar.org
install -d /var/www/fanavatar.org
if [ -f /var/www/fanavatar.org/index.html ]; then
  cp -f /var/www/fanavatar.org/index.html /var/www/fanavatar.org/index.html.prev
fi
install -m 0644 "\$remote_dir/index.html" /var/www/fanavatar.org/index.html
systemctl daemon-reload
systemctl enable jwgb-web.service
systemctl restart jwgb-web.service
nginx -t
systemctl reload nginx
for attempt in \$(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:8787/health >/dev/null; then break; fi
  sleep 1
done
systemctl is-active --quiet jwgb-web.service
curl --fail --silent --show-error http://127.0.0.1:8787/health
printf '\ndeployed release %s\n' "\$release_id"
REMOTE

log "Done: https://fanavatar.org/  (release $RELEASE_ID)"
