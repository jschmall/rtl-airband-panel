#!/bin/sh
# rtl-airband-panel installer. Run from the extracted release folder:
#
#   sudo ./install.sh [options]
#
# Installs the panel and (unless you choose the panel only) the bundled
# rtl_airband built from the jschmall/RTLSDR-Airband fork, a service user, the udev
# rule and kernel-driver blacklist for SDR dongles, the sudoers rule, and
# the panel's systemd service, then starts it. Running it again upgrades the
# binaries and keeps your setup: the account, instances folder and unit
# prefix default to what the existing install uses, settings are never
# overwritten, and a panel service file you've edited is left alone. An
# old Node.js panel's account and .env settings carry over. It never
# touches your instances' own services or configs, or an existing
# /usr/local/bin/rtl_airband.
#
# Options (defaults are the existing install's, else the ones shown):
#   --instances-dir DIR  Where instance .conf files live
#                        (default: /etc/rtl-airband-panel/instances)
#   --user NAME          Account the panel (and new instances) run as
#                        (default: rtl-airband-panel). Asked for when run
#                        in a terminal without this option.
#   --unit-prefix P      Only let the panel manage services named P*.service,
#                        e.g. rtl_ (default: any validly named service)
#   --listen-all         Listen on every network interface and generate a
#                        login password (default: this machine only)
#   --panel-only         Don't install or upgrade the bundled rtl_airband; use
#                        the one already on this machine. A build other than
#                        the jschmall fork may not support every panel feature.
#   --with-rtl-airband   Install the bundled rtl_airband too (the default,
#                        unless the existing install is panel-only). Asked
#                        for when run in a terminal without either option.
#   --separate-rtl-airband
#                        When another rtl_airband is already installed, put
#                        the bundled one alongside it: existing instances
#                        keep running theirs (the default)
#   --replace-rtl-airband
#                        When another rtl_airband is already installed under
#                        /usr/local, replace it with the bundled one, keeping
#                        the original as <path>.pre-fork (restored by
#                        --uninstall). Existing instances that run it switch
#                        to the fork when they next restart. Asked for when
#                        run in a terminal without either option.
#   --no-start           Install everything but don't (re)start the panel
#   -y, --yes            Don't ask anything; take the defaults
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

# Empty until an option or the existing install sets them; see "Existing
# install" below for the fallbacks.
instances_dir=""
user=""
unit_prefix=""
unit_prefix_set=0
listen_all=0
assume_yes=0
bundle=""
# replace | separate: what the bundled rtl_airband does to one already installed.
airband_mode=""
start=1
action=install

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }
usage() { sed -n '2,/^set -eu/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; }
# The last KEY=value in a unit or env file, quotes stripped; empty if absent.
file_value() {
  [ -f "$2" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$2" | tail -1 | sed -e 's/[[:space:]]*$//' -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\\1/"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --instances-dir) [ $# -ge 2 ] || die "--instances-dir needs a value"; instances_dir="$2"; shift 2 ;;
    --user) [ $# -ge 2 ] || die "--user needs a value"; user="$2"; shift 2 ;;
    --unit-prefix) [ $# -ge 2 ] || die "--unit-prefix needs a value"; unit_prefix="$2"; unit_prefix_set=1; shift 2 ;;
    --listen-all) listen_all=1; shift ;;
    --no-start) start=0; shift ;;
    -y | --yes) assume_yes=1; shift ;;
    --panel-only) bundle=0; shift ;;
    --with-rtl-airband) bundle=1; shift ;;
    --replace-rtl-airband) bundle=1; airband_mode=replace; shift ;;
    --separate-rtl-airband) bundle=1; airband_mode=separate; shift ;;
    --uninstall) action=uninstall; shift ;;
    -h | --help) usage; exit 0 ;;
    *) die "unknown option: $1 (see --help)" ;;
  esac
done

[ "$(id -u)" -eq 0 ] || die "run as root: sudo $0"
command -v systemctl >/dev/null 2>&1 || die "systemd is required"
command -v visudo >/dev/null 2>&1 || die "sudo (visudo) is required"

# ------------------------------------------------------------ existing install

# An upgrade keeps the existing install's choices unless an option says
# otherwise: the account from the panel's service (the old Node.js one
# too), the instances folder and unit prefix from panel.env. A Node.js
# install's .env seeds the new panel.env.
node_unit=0
node_dir=""
node_env=""
[ -f "$UNIT_FILE" ] && grep -q '/usr/bin/node' "$UNIT_FILE" && node_unit=1
existing_user="$(file_value User "$UNIT_FILE")"
if [ "$node_unit" -eq 1 ]; then
  node_dir="$(file_value WorkingDirectory "$UNIT_FILE")"
  node_env="$(file_value EnvironmentFile "$UNIT_FILE" | sed 's/^-//')"
  case "$node_env" in
    /*) ;;
    ?*) node_env="$node_dir/$node_env" ;;
  esac
  [ -n "$node_env" ] && [ -f "$node_env" ] || node_env=""
fi
settings_file="$ENV_FILE"
[ -f "$settings_file" ] || settings_file="$node_env"
if [ -n "$settings_file" ]; then
  [ -n "$instances_dir" ] || instances_dir="$(file_value RTL_PANEL_INSTANCES_DIR "$settings_file")"
  [ "$unit_prefix_set" -eq 1 ] || unit_prefix="$(file_value RTL_PANEL_SUDO_UNIT_PREFIX "$settings_file")"
fi
user_given=0
[ -z "$user" ] || user_given=1
[ -n "$user" ] || user="${existing_user:-rtl-airband-panel}"
[ -n "$instances_dir" ] || instances_dir="$ETC_DIR/instances"

case "$unit_prefix" in *[!A-Za-z0-9_-]*) die "--unit-prefix may only contain letters, digits, _ and -" ;; esac
case "$user" in "" | *[!a-z0-9_-]*) die "--user must be a lowercase account name (got '$user')" ;; esac

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
  # An rtl_airband the installer replaced (--replace-rtl-airband) gets its original back.
  for replaced in "$PREFIX/bin/rtl_airband" "$PREFIX/sbin/rtl_airband" $(command -v rtl_airband 2>/dev/null); do
    [ -e "$replaced.pre-fork" ] || continue
    mv -f "$replaced.pre-fork" "$replaced"
    say "restored your original $replaced"
  done
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

[ -x "$here/bin/rtl-airband-panel" ] \
  || die "run this from the extracted release folder (bin/ not found next to install.sh)"
"$here/bin/rtl-airband-panel" --version >/dev/null 2>&1 \
  || die "bin/rtl-airband-panel doesn't run on this machine; is this the release for $(uname -m)?"

# Accounts the rtl_airband services already on this machine run as. The
# control socket (Apply live, the Hardware page) only answers its own
# account, so the panel should run as theirs.
instance_users=""
for unit in /etc/systemd/system/*.service; do
  [ -f "$unit" ] && [ "$unit" != "$UNIT_FILE" ] || continue
  grep -q '^[[:space:]]*ExecStart=.*rtl_airband' "$unit" || continue
  u="$(file_value User "$unit")"
  instance_users="$instance_users$(basename "$unit" .service) (${u:-root})
"
done
instance_accounts="$(printf '%s' "$instance_users" | sed -n 's/.*(\(.*\))$/\1/p' | sort -u | tr '\n' ' ' | sed 's/ $//')"

if [ "$user_given" -eq 0 ] && [ "$assume_yes" -eq 0 ] && [ -t 0 ]; then
  step "Which account should run the panel?"
  say "The panel, and the instances it creates, run as this account. It needs to"
  say "be the account your rtl_airband services run as, or Apply live and the"
  say "Hardware page can't reach them. It's created if it doesn't exist."
  if [ -n "$instance_users" ]; then
    say "rtl_airband services on this machine:"
    printf '%s' "$instance_users" | sed 's/^/  /'
    case "$instance_accounts" in *" "* | root) ;; *) [ -n "$existing_user" ] || user="$instance_accounts" ;; esac
  fi
  printf 'Account [%s]: ' "$user"
  read -r answer || answer=""
  [ -z "$answer" ] || user="$answer"
  case "$user" in "" | *[!a-z0-9_-]*) die "the account must be a lowercase name (got '$user')" ;; esac
fi
if [ -n "$instance_accounts" ] && [ "$instance_accounts" != "$user" ]; then
  say "note: your rtl_airband services run as $instance_accounts, the panel as '$user'; Apply live"
  say "      and the Hardware page only reach instances running as '$user'"
fi

# The bundled rtl_airband, or only the panel? An upgrade keeps what the
# existing install chose.
airband_version() { "$1" -v 2>&1 | sed -n 's/^RTLSDR-Airband version //p' | head -1; }
other_airband=""
for candidate in "$PREFIX/bin/rtl_airband" $(command -v rtl_airband 2>/dev/null); do
  [ -x "$candidate" ] || continue
  case "$(readlink -f "$candidate")" in "$LIB_DIR/rtl_airband") continue ;; esac
  other_airband="$candidate"
  break
done
# A previous --replace-rtl-airband left the original next to it: an upgrade
# keeps replacing it, and that original is what was "already installed".
if [ -n "$other_airband" ] && [ -e "$other_airband.pre-fork" ]; then
  [ -n "$airband_mode" ] || airband_mode=replace
fi
# Only a plain file under $PREFIX, not a package manager's, is replaced.
replaceable_airband() {
  case "$1" in "$PREFIX"/*) ;; *) return 1 ;; esac
  [ -f "$1" ] && [ ! -L "$1" ] || return 1
  if command -v dpkg >/dev/null 2>&1 && dpkg -S "$1" >/dev/null 2>&1; then return 1; fi
  if command -v rpm >/dev/null 2>&1 && rpm -qf "$1" >/dev/null 2>&1; then return 1; fi
  return 0
}
if [ -z "$bundle" ]; then
  bundle=1
  [ -x "$LIB_DIR/rtl-airband-panel" ] && [ ! -e "$LIB_DIR/rtl_airband" ] && bundle=0
  if [ "$assume_yes" -eq 0 ] && [ -t 0 ]; then
    step "Install the bundled rtl_airband too?"
    say "This release includes rtl_airband $(airband_version "$here/bin/rtl_airband"), built from the jschmall/RTLSDR-Airband fork the"
    say "panel is developed against. Apply live, the Hardware page and other fork-only settings need it."
    [ -z "$other_airband" ] || say "Already on this machine: $other_airband ($(airband_version "$other_airband" || true)). If you install the fork, you'll choose next whether it replaces that one."
    if [ "$bundle" -eq 1 ]; then printf 'Install it? [Y/n]: '; else printf 'Install it? [y/N]: '; fi
    read -r answer || answer=""
    case "$answer" in [Yy]*) bundle=1 ;; [Nn]*) bundle=0 ;; esac
  fi
fi
if [ "$bundle" -eq 1 ]; then
  [ -x "$here/bin/rtl_airband" ] || die "bin/rtl_airband is missing from this release folder; use --panel-only"
fi

# The bundled rtl_airband and one already installed: replace it, or alongside?
if [ "$bundle" -eq 1 ] && [ -n "$other_airband" ]; then
  if [ "$airband_mode" != separate ] && ! replaceable_airband "$other_airband"; then
    [ "$airband_mode" != replace ] \
      || say "note: $other_airband belongs to your system's packages (or isn't under $PREFIX); installing the fork alongside it instead of replacing it"
    airband_mode=separate
  elif [ -z "$airband_mode" ] && [ "$assume_yes" -eq 0 ] && [ -t 0 ]; then
    step "Replace your rtl_airband, or install the fork alongside it?"
    say "  1) Alongside: $other_airband stays as it is, and existing instances keep"
    say "     running it. New instances run the fork, $LIB_DIR/rtl_airband."
    say "  2) Replace: $other_airband becomes the fork. The original is kept as"
    say "     $other_airband.pre-fork (--uninstall puts it back). Existing instances"
    say "     that run $other_airband switch to the fork when they next restart."
    printf 'Choice [1]: '
    read -r answer || answer=""
    case "$answer" in 2 | [Rr]*) airband_mode=replace ;; *) airband_mode=separate ;; esac
  fi
  [ -n "$airband_mode" ] || airband_mode=separate
fi

panel_version="$("$here/bin/rtl-airband-panel" --version | awk '{print $2}')"
if [ "$bundle" -eq 1 ]; then
  say "Installing rtl-airband-panel $panel_version with rtl_airband $(airband_version "$here/bin/rtl_airband")"
  default_airband_bin="$LIB_DIR/rtl_airband"
else
  say "Installing rtl-airband-panel $panel_version only (no bundled rtl_airband)"
  default_airband_bin="${other_airband:-$PREFIX/bin/rtl_airband}"
fi

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
ln -sf "$LIB_DIR/rtl-airband-panel" "$PREFIX/bin/rtl-airband-panel"
if [ "$bundle" -eq 0 ]; then
  if [ -e "$LIB_DIR/rtl_airband" ]; then
    say "panel only: left the previously bundled $LIB_DIR/rtl_airband as it was (not upgraded)"
  else
    say "panel only: no bundled rtl_airband installed"
  fi
else
  install -m 0755 "$here/bin/rtl_airband" "$LIB_DIR/rtl_airband"
  if [ "$airband_mode" = replace ]; then
    if [ -e "$other_airband.pre-fork" ]; then
      say "replaced $other_airband with the fork again (your original is still $other_airband.pre-fork)"
    else
      mv "$other_airband" "$other_airband.pre-fork"
      say "replaced $other_airband with the fork; your original is now $other_airband.pre-fork"
    fi
    install -m 0755 "$here/bin/rtl_airband" "$other_airband"
    say "instances that run $other_airband switch to the fork when they next restart"
  elif [ -e "$PREFIX/bin/rtl_airband" ] && [ "$(readlink "$PREFIX/bin/rtl_airband" 2>/dev/null)" != "$LIB_DIR/rtl_airband" ]; then
    say "left your existing $PREFIX/bin/rtl_airband alone; the bundled one is $LIB_DIR/rtl_airband"
  else
    ln -sf "$LIB_DIR/rtl_airband" "$PREFIX/bin/rtl_airband"
  fi
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
  service_user="$(file_value RTL_PANEL_DEFAULT_SERVICE_USER "$ENV_FILE")"
  [ -z "$service_user" ] || [ "$service_user" = "$user" ] \
    || say "note: panel.env creates new instances as RTL_PANEL_DEFAULT_SERVICE_USER=$service_user; set it (and _GROUP) to $user to match the panel"
  configured_bin="$(file_value RTL_PANEL_RTL_AIRBAND_BIN "$ENV_FILE")"
  [ "$bundle" -eq 0 ] || [ "${configured_bin:-$PREFIX/bin/rtl_airband}" = "$LIB_DIR/rtl_airband" ] \
    || [ "$(readlink -f "${configured_bin:-$PREFIX/bin/rtl_airband}")" = "$LIB_DIR/rtl_airband" ] \
    || say "note: new instances run ${configured_bin:-$PREFIX/bin/rtl_airband}; set RTL_PANEL_RTL_AIRBAND_BIN=$LIB_DIR/rtl_airband in panel.env to use the bundled one"
  configured_dir="$(file_value RTL_PANEL_INSTANCES_DIR "$ENV_FILE")"
  [ "$instances_dir" = "${configured_dir:-$ETC_DIR/instances}" ] \
    || say "note: panel.env still says RTL_PANEL_INSTANCES_DIR=${configured_dir:-(unset)}; edit it to use $instances_dir"
elif [ -n "$node_env" ]; then
  # Carry the Node.js panel's settings over, minus the ones the binary
  # dropped, and add the bundled binary and stats path if they're missing.
  umask 077
  {
    printf '# rtl-airband-panel settings, carried over from %s.\n' "$node_env"
    # Relative paths were relative to the old checkout; anchor them there.
    grep -v -e '^[[:space:]]*RTL_PANEL_FRONTEND_DIST=' -e '^[[:space:]]*RTL_PANEL_INSTANCES_DIR=' "$node_env" \
      | sed "s#^\([[:space:]]*RTL_PANEL_[A-Z_]*\(DIR\|PATH\|BIN\)=\)\([\"']\{0,1\}\)\([^/\"'][^\"']*\)#\1\3$node_dir/\4#"
    printf 'RTL_PANEL_INSTANCES_DIR=%s\n' "$instances_dir"
    [ -n "$(file_value RTL_PANEL_STATS_DB_PATH "$node_env")" ] || printf 'RTL_PANEL_STATS_DB_PATH=%s\n' "$STATE_DIR/stats.db"
    [ -n "$(file_value RTL_PANEL_SYSTEMD_MODE "$node_env")" ] || printf 'RTL_PANEL_SYSTEMD_MODE=sudo\n'
    [ -n "$(file_value RTL_PANEL_RTL_AIRBAND_BIN "$node_env")" ] || printf 'RTL_PANEL_RTL_AIRBAND_BIN=%s\n' "$default_airband_bin"
    [ -n "$(file_value RTL_PANEL_DEFAULT_SERVICE_USER "$node_env")" ] || printf 'RTL_PANEL_DEFAULT_SERVICE_USER=%s\nRTL_PANEL_DEFAULT_SERVICE_GROUP=%s\n' "$user" "$user"
  } > "$ENV_FILE"
  umask 022
  chown "$user:$user" "$ENV_FILE"
  chmod 0600 "$ENV_FILE"
  say "created from your Node.js panel's $node_env"
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
RTL_PANEL_RTL_AIRBAND_BIN=$default_airband_bin
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
unit_tmp="$(mktemp)"
sed -e "s|^User=.*|User=$user|" \
    -e "s|^EnvironmentFile=.*|EnvironmentFile=$ENV_FILE|" \
    -e "s|^ExecStart=.*|ExecStart=$LIB_DIR/rtl-airband-panel|" \
    "$here/deploy/rtl-airband-panel.service" > "$unit_tmp"
# $LIB_DIR keeps a copy of the unit as last installed: a service file that
# still matches it (or this release's) wasn't edited and can be replaced.
installed_unit="$LIB_DIR/rtl-airband-panel.service"
if [ "$node_unit" -eq 1 ]; then
  say "replacing the old Node.js panel service (backup: $UNIT_FILE.node-backup)"
  systemctl stop rtl-airband-panel >/dev/null 2>&1 || true
  cp "$UNIT_FILE" "$UNIT_FILE.node-backup"
  install -m 0644 "$unit_tmp" "$UNIT_FILE"
elif [ ! -f "$UNIT_FILE" ]; then
  install -m 0644 "$unit_tmp" "$UNIT_FILE"
  say "installed"
elif cmp -s "$unit_tmp" "$UNIT_FILE"; then
  say "up to date"
elif cmp -s "$installed_unit" "$UNIT_FILE"; then
  install -m 0644 "$unit_tmp" "$UNIT_FILE"
  say "updated"
else
  # Edited by hand: keep it, only moving it to a newly chosen account.
  [ "$existing_user" = "$user" ] || sed -i "s|^User=.*|User=$user|" "$UNIT_FILE"
  say "kept your edited service file; this release's version is $installed_unit"
fi
install -m 0644 "$unit_tmp" "$installed_unit"
rm -f "$unit_tmp"
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
airband_bin="$(file_value RTL_PANEL_RTL_AIRBAND_BIN "$ENV_FILE")"
airband_bin="${airband_bin:-$PREFIX/bin/rtl_airband}"
if [ -x "$airband_bin" ]; then
  say "New instances run $airband_bin ($(airband_version "$airband_bin" || true)). Existing instances"
  say "keep running whatever their service already uses until you change that."
else
  say "New instances run $airband_bin, which isn't there yet: install rtl_airband (or set"
  say "RTL_PANEL_RTL_AIRBAND_BIN in $ENV_FILE) before starting any."
fi
if [ "$bundle" -eq 0 ]; then
  say ""
  say "Panel only: an rtl_airband that isn't the jschmall/RTLSDR-Airband fork may not support"
  say "every panel feature (Apply live, the Hardware page, fork-only settings). Run this"
  say "installer with --with-rtl-airband any time to add the bundled one."
fi
