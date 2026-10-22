#!/bin/sh
# rtl-airband-panel installer. Run from the extracted release folder:
#
#   sudo ./install.sh [options]
#
# Installs the panel and the bundled rtl_airband, a service user, the udev
# rule and kernel-driver blacklist for SDR dongles, the sudoers rule, and
# the panel's systemd service, then starts it. Running it again upgrades the
# binaries and keeps your settings. It never touches your instances' own
# services or configs, an existing /usr/local/bin/rtl_airband, or an
# existing settings file.
#
# Options:
#   --instances-dir DIR  Where instance .conf files live
#                        (default: /etc/rtl-airband-panel/instances)
#   --user NAME          Account the panel (and new instances) run as
#                        (default: rtl-airband-panel)
#   --unit-prefix P      Only let the panel manage services named P*.service,
#                        e.g. rtl_ (default: any validly named service)
#   --listen-all         Listen on every network interface and generate a
#                        login password (default: this machine only)
#   --no-start           Install everything but don't (re)start the panel
#   --uninstall          Remove the panel; keep configs, settings and stats
#   -h, --help           Show this help
set -eu

PREFIX=/usr/local
LIB_DIR="$PREFIX/lib/rtl-airband-panel"
ETC_DIR=/etc/rtl-airband-panel
STATE_DIR=/var/lib/rtl-airband-panel
ENV_FILE="$ETC_DIR/panel.env"
UNIT_FILE=/etc/systemd/system/rtl-airband-panel.service
SUDOERS_FILE=/etc/sudoers.d/rtl-airband-panel
UDEV_FILE=/etc/udev/rules.d/60-rtl-airband-panel.rules
BLACKLIST_FILE=/etc/modprobe.d/rtl-airband-panel-blacklist.conf

instances_dir="$ETC_DIR/instances"
user=rtl-airband-panel
unit_prefix=""
listen_all=0
start=1
action=install

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
  case "$1" in
    --instances-dir) [ $# -ge 2 ] || die "--instances-dir needs a value"; instances_dir="$2"; shift 2 ;;
    --user) [ $# -ge 2 ] || die "--user needs a value"; user="$2"; shift 2 ;;
    --unit-prefix) [ $# -ge 2 ] || die "--unit-prefix needs a value"; unit_prefix="$2"; shift 2 ;;
    --listen-all) listen_all=1; shift ;;
    --no-start) start=0; shift ;;
    --uninstall) action=uninstall; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root: sudo $0"
command -v systemctl >/dev/null 2>&1 || die "systemd is required"
command -v visudo >/dev/null 2>&1 || die "sudo (visudo) is required"
case "$unit_prefix" in *[!A-Za-z0-9_-]*) die "--unit-prefix may only contain letters, digits, _ and -" ;; esac
case "$user" in "" | *[!a-z0-9_-]*) die "--user must be a lowercase account name" ;; esac

here="$(cd "$(dirname "$0")" && pwd)"

# ------------------------------------------------------------------ uninstall

if [ "$action" = uninstall ]; then
  step "Stopping and removing the panel service"
  if [ -f "$UNIT_FILE" ]; then
    systemctl disable --now rtl-airband-panel >/dev/null 2>&1 || true
    rm -f "$UNIT_FILE"
    systemctl daemon-reload
  fi
  step "Removing the panel's files"
  rm -f "$SUDOERS_FILE" "$UDEV_FILE" "$BLACKLIST_FILE"
  [ -L "$PREFIX/bin/rtl-airband-panel" ] && rm -f "$PREFIX/bin/rtl-airband-panel"
  [ -L "$PREFIX/bin/rtl_airband" ] && [ "$(readlink "$PREFIX/bin/rtl_airband")" = "$LIB_DIR/rtl_airband" ] \
    && rm -f "$PREFIX/bin/rtl_airband"
  rm -rf "$LIB_DIR"
  command -v udevadm >/dev/null 2>&1 && udevadm control --reload || true
  say ""
  say "Removed. Kept: $ETC_DIR (settings and instance configs), $STATE_DIR (stats),"
  say "the '$user' account, and every instance's own service."
  say "Instances created by the panel still run $LIB_DIR/rtl_airband,"
  say "which is now gone; point their services at another rtl_airband before restarting them."
  exit 0
fi

# -------------------------------------------------------------------- install

[ -x "$here/bin/rtl-airband-panel" ] && [ -x "$here/bin/rtl_airband" ] \
  || die "run this from the extracted release folder (bin/ not found next to install.sh)"
"$here/bin/rtl-airband-panel" --version >/dev/null 2>&1 \
  || die "bin/rtl-airband-panel doesn't run on this machine; is this the release for $(uname -m)?"

panel_version="$("$here/bin/rtl-airband-panel" --version | awk '{print $2}')"
airband_version="$("$here/bin/rtl_airband" -v 2>&1 | sed -n 's/^RTLSDR-Airband version //p')"
say "Installing rtl-airband-panel $panel_version with rtl_airband $airband_version"

step "Service account '$user'"
getent group plugdev >/dev/null 2>&1 || groupadd --system plugdev
if id "$user" >/dev/null 2>&1; then
  say "exists"
else
  useradd --system --home-dir "$STATE_DIR" --create-home --shell /usr/sbin/nologin --user-group "$user"
  say "created"
fi
usermod -a -G plugdev "$user"

step "Programs in $LIB_DIR"
mkdir -p "$LIB_DIR"
# install(1) writes a new file and renames it over the old one, so running
# instances keep their open copy of the old rtl_airband until they restart.
install -m 0755 "$here/bin/rtl-airband-panel" "$LIB_DIR/rtl-airband-panel"
install -m 0755 "$here/bin/rtl_airband" "$LIB_DIR/rtl_airband"
ln -sf "$LIB_DIR/rtl-airband-panel" "$PREFIX/bin/rtl-airband-panel"
if [ -e "$PREFIX/bin/rtl_airband" ] && [ "$(readlink "$PREFIX/bin/rtl_airband" 2>/dev/null)" != "$LIB_DIR/rtl_airband" ]; then
  say "left your existing $PREFIX/bin/rtl_airband alone; the bundled one is $LIB_DIR/rtl_airband"
else
  ln -sf "$LIB_DIR/rtl_airband" "$PREFIX/bin/rtl_airband"
fi

step "SDR dongle access (udev rule, DVB driver blacklist)"
install -m 0644 "$here/deploy/60-rtl-airband-panel.rules" "$UDEV_FILE"
install -m 0644 "$here/deploy/rtl-airband-panel-blacklist.conf" "$BLACKLIST_FILE"
if command -v udevadm >/dev/null 2>&1; then
  udevadm control --reload && udevadm trigger --subsystem-match=usb --action=change || true
fi
loaded_dvb="$(lsmod 2>/dev/null | awk '$1 ~ /^(dvb_usb_rtl28xxu|rtl2832_sdr|msi2500)$/ {print $1}' | tr '\n' ' ')"
[ -z "$loaded_dvb" ] || say "note: kernel TV drivers are loaded ($loaded_dvb); reboot (or unload them) before dongles are usable"

step "Settings ($ENV_FILE)"
mkdir -p "$ETC_DIR" "$STATE_DIR"
chown "$user:$user" "$ETC_DIR" "$STATE_DIR"
# Only a folder made here gets handed to the panel's account; an existing
# one (maybe a home directory) keeps its owner, so warn if it's unwritable.
if [ -d "$instances_dir" ]; then
  sudo -n -u "$user" test -w "$instances_dir" 2>/dev/null \
    || say "note: '$user' can't write to $instances_dir; give it access (chgrp/chmod or an ACL) or the panel can't save"
else
  mkdir -p "$instances_dir"
  chown "$user:$user" "$instances_dir"
fi
password=""
if [ -f "$ENV_FILE" ]; then
  say "kept your existing settings"
else
  host=127.0.0.1
  if [ "$listen_all" -eq 1 ]; then
    host=0.0.0.0
    password="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  fi
  umask 077
  cat > "$ENV_FILE" <<ENV
# rtl-airband-panel settings (see .env.example in the release for all of them).
RTL_PANEL_INSTANCES_DIR=$instances_dir
RTL_PANEL_STATS_DB_PATH=$STATE_DIR/stats.db
RTL_PANEL_SYSTEMD_MODE=sudo
RTL_PANEL_SUDO_UNIT_PREFIX=$unit_prefix
RTL_PANEL_RTL_AIRBAND_BIN=$LIB_DIR/rtl_airband
RTL_PANEL_DEFAULT_SERVICE_USER=$user
RTL_PANEL_DEFAULT_SERVICE_GROUP=$user
RTL_PANEL_HOST=$host
RTL_PANEL_PORT=3000
ENV
  [ -z "$password" ] || printf 'RTL_PANEL_PASSWORD=%s\n' "$password" >> "$ENV_FILE"
  umask 022
  chown "$user:$user" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  say "created"
fi

step "sudo rule ($SUDOERS_FILE)"
glob="${unit_prefix}*.service"
tmp="$(mktemp)"
sed -e "s/^rtl-airband-panel ALL=/$user ALL=/" \
    -e "s/rtl_\*\.service/$(printf '%s' "$glob" | sed 's/[*.]/\\&/g')/g" \
    "$here/deploy/rtl-airband-panel.sudoers" > "$tmp"
visudo -cqf "$tmp" || { rm -f "$tmp"; die "the generated sudo rule didn't validate; nothing installed for it"; }
install -m 0440 "$tmp" "$SUDOERS_FILE"
rm -f "$tmp"
say "installed (services: $glob)"

step "Panel service"
if [ -f "$UNIT_FILE" ] && grep -q '/usr/bin/node' "$UNIT_FILE"; then
  say "replacing the old Node.js panel service (backup: $UNIT_FILE.node-backup)"
  systemctl stop rtl-airband-panel >/dev/null 2>&1 || true
  cp "$UNIT_FILE" "$UNIT_FILE.node-backup"
fi
sed -e "s|^User=.*|User=$user|" \
    -e "s|^EnvironmentFile=.*|EnvironmentFile=$ENV_FILE|" \
    -e "s|^ExecStart=.*|ExecStart=$LIB_DIR/rtl-airband-panel|" \
    "$here/deploy/rtl-airband-panel.service" > "$UNIT_FILE"
chmod 0644 "$UNIT_FILE"
systemctl daemon-reload
systemctl enable rtl-airband-panel >/dev/null 2>&1
if [ "$start" -eq 1 ]; then
  systemctl restart rtl-airband-panel
  sleep 2
  systemctl is-active --quiet rtl-airband-panel \
    || die "the panel didn't start; see: journalctl -u rtl-airband-panel -n 50"
  say "running"
else
  say "installed, not started (--no-start)"
fi

port="$(sed -n 's/^RTL_PANEL_PORT=//p' "$ENV_FILE" | tail -1)"
host="$(sed -n 's/^RTL_PANEL_HOST=//p' "$ENV_FILE" | tail -1)"
step "Done"
if [ "${host:-127.0.0.1}" = "0.0.0.0" ]; then
  say "Open http://$(hostname -I 2>/dev/null | awk '{print $1}'):${port:-3000} from any device on your network."
else
  say "Open http://localhost:${port:-3000} on this machine"
  say "(or tunnel it: ssh -L ${port:-3000}:localhost:${port:-3000} you@$(hostname))."
fi
[ -z "$password" ] || say "Log in as 'admin' with password: $password  (stored in $ENV_FILE)"
say ""
say "Instance configs: $instances_dir"
say "Settings:         $ENV_FILE  (restart the panel after editing: systemctl restart rtl-airband-panel)"
say "New instances run $LIB_DIR/rtl_airband ($airband_version). Existing instances"
say "keep running whatever their service already uses until you change that."
