#!/usr/bin/env bash
# Regenerates the screenshots in docs/screenshots from real instance data:
#
#   scripts/screenshots/run.sh DATA_DIR [OUT_DIR]
#
# DATA_DIR holds instance .conf files and a stats.db, e.g. copies from a
# running install. The .conf files are shown as they are: replace
# passwords, API keys, private hostnames and Icecast mountpoints first.
# stats.db is only read; see prepare-db.py.
#
# Runs the panel in mock mode on a temporary copy (no systemd, nothing
# touched outside a temp folder), marks every instance running, serves fake
# control sockets for the Hardware page (fake-control-sockets.py, which
# listens on each config's control_socket_path, so don't run this on a
# machine whose rtl_airband uses those paths), and drives headless Chromium
# through shoot.cjs.
#
# Needs: cargo, npm, python3, node, and Playwright's Chromium. Set
# CHROMIUM to the browser binary and PLAYWRIGHT_CORE to a playwright-core
# package directory if they aren't the defaults below.
set -euo pipefail
cd "$(dirname "$0")/../.."

data="${1:?usage: $0 DATA_DIR [OUT_DIR]}"
out="${2:-docs/screenshots}"
port="${PORT:-3107}"
export CHROMIUM="${CHROMIUM:-$HOME/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome}"
export PLAYWRIGHT_CORE="${PLAYWRIGHT_CORE:-$(ls -d "$HOME"/.npm/_npx/*/node_modules/playwright-core 2>/dev/null | head -1)}"
[ -x "$CHROMIUM" ] || { echo "set CHROMIUM to a Chromium binary" >&2; exit 1; }
[ -d "$PLAYWRIGHT_CORE" ] || { echo "set PLAYWRIGHT_CORE to a playwright-core package directory" >&2; exit 1; }
[ -f "$data/stats.db" ] || { echo "$data/stats.db not found" >&2; exit 1; }

tmp="$(mktemp -d)"
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -TERM "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$tmp"
}
trap cleanup EXIT

mkdir -p "$tmp/instances" "$tmp/units" "$tmp/bin" "$out"
cp "$data"/*.conf "$tmp/instances/"
python3 scripts/screenshots/prepare-db.py "$data/stats.db" "$tmp/stats.db"
# What `rtl_airband -v` prints on the fork, so the editor shows a fork build.
cat > "$tmp/bin/rtl_airband" <<'EOF'
#!/bin/sh
echo "RTLSDR-Airband version v6.5.0"
echo "Features: fork control_socket stats_http rdio_scanner mixer_remote json_log reserve send_tx_tags post_write_script nfm"
EOF
chmod +x "$tmp/bin/rtl_airband"

npm run build --workspace=frontend >/dev/null
cargo build -q -p rtl-airband-panel

RTL_PANEL_DEFAULT_SERVICE_USER=rtl-airband RTL_PANEL_DEFAULT_SERVICE_GROUP=rtl-airband \
  target/debug/rtl-airband-panel --systemd-mode mock --port "$port" \
  --instances-dir "$tmp/instances" --unit-dir "$tmp/units" --stats-db-path "$tmp/stats.db" \
  --rtl-airband-bin "$tmp/bin/rtl_airband" --frontend-dist frontend/dist >"$tmp/panel.log" 2>&1 &
pids+=($!)
url="http://127.0.0.1:$port"
for _ in $(seq 60); do curl -sf "$url/api/health" >/dev/null && break; sleep 0.5; done

# The mock reports an instance running once it has been (re)started.
for name in $(curl -sf "$url/api/instances" | python3 -c 'import json,sys; print(" ".join(i["name"] for i in json.load(sys.stdin)))'); do
  curl -sf -X POST -H "Origin: $url" "$url/api/instances/$name/restart" >/dev/null
done

python3 scripts/screenshots/fake-control-sockets.py "$url" "$tmp/stats.db" &
pids+=($!)
sleep 2

node scripts/screenshots/shoot.cjs "$url" "$out"
