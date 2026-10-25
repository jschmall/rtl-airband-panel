# Deployment

This covers running rtl-airband-panel as a long-lived service, rather than
just starting it in a terminal to try it out. See [README.md](./README.md)
for installing and a first run, and its
[Settings](./README.md#settings) section for every setting
mentioned here.

**If you installed from a release, `install.sh` has already done the
service setup below:** the service account, `panel.env`, the sudoers rule
and the panel's unit. You don't need to repeat those steps. The rest of
this page still applies: network access, the reverse proxy, logs and
backups. To change a setting, edit `/etc/rtl-airband-panel/panel.env` and
`sudo systemctl restart rtl-airband-panel`. Re-running `install.sh` never
overwrites that file.
- **Defaults on a re-run:** the account comes from the existing panel unit,
  and the instances folder and unit prefix from `panel.env`. Options still
  override them.
- **Edited panel unit:** a unit you've edited is kept. The release's
  version is saved as `/usr/local/lib/rtl-airband-panel/rtl-airband-panel.service`
  so you can compare them. Prefer a drop-in
  (`systemctl edit rtl-airband-panel`) for your own changes.

The steps below are for a panel built from source, or for setting things up
by hand.

## Running the panel as a systemd service

An example unit is provided at
[`deploy/rtl-airband-panel.service`](./deploy/rtl-airband-panel.service).
It manages the *panel's own* process, separate from the per-instance
`<name>.service` units the panel creates and controls for each
RTLSDR-Airband instance.

1. Install the binary (see [Installing](./README.md#installing)):

   ```bash
   sudo install -m 0755 target/release/rtl-airband-panel /usr/local/bin/
   ```

2. Create a dedicated system user to run the panel as (don't run it as
   `root`):

   ```bash
   sudo useradd --system --create-home --home-dir /var/lib/rtl-airband-panel --shell /usr/sbin/nologin rtl-airband-panel
   sudo mkdir -p /etc/rtl-airband-panel/instances
   sudo chown -R rtl-airband-panel:rtl-airband-panel /etc/rtl-airband-panel
   ```

3. Write its settings to `/etc/rtl-airband-panel/panel.env`, readable only
   by that user since it can hold the password:

   ```bash
   sudo install -m 0600 -o rtl-airband-panel /dev/null /etc/rtl-airband-panel/panel.env
   sudoedit /etc/rtl-airband-panel/panel.env
   ```

   For example:

   ```ini
   RTL_PANEL_INSTANCES_DIR=/etc/rtl-airband-panel/instances
   RTL_PANEL_STATS_DB_PATH=/var/lib/rtl-airband-panel/stats.db
   RTL_PANEL_SYSTEMD_MODE=sudo
   RTL_PANEL_SUDO_UNIT_PREFIX=rtl_
   RTL_PANEL_RTL_AIRBAND_BIN=/usr/local/bin/rtl_airband
   RTL_PANEL_DEFAULT_SERVICE_USER=rtl-airband-panel
   RTL_PANEL_DEFAULT_SERVICE_GROUP=rtl-airband-panel
   ```

   See [`.env.example`](./.env.example) for every setting.

4. Install and start the unit, adjusting `User=` and `EnvironmentFile=`
   inside it first if yours differ:

   ```bash
   sudo cp deploy/rtl-airband-panel.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now rtl-airband-panel
   ```

5. Check it's running and follow its logs:

   ```bash
   sudo systemctl status rtl-airband-panel
   sudo journalctl -u rtl-airband-panel -f
   ```

### Updating

From a release: run the new release's `sudo ./install.sh`. From source:
build the new version (see [Installing](./README.md#installing)), then:

```bash
sudo install -m 0755 target/release/rtl-airband-panel /usr/local/bin/
sudo systemctl restart rtl-airband-panel
```

Restarting the panel never restarts any `rtl_airband` instance; they're
separate units. Check the [CHANGELOG](./CHANGELOG.md) for anything an
update asks you to change, such as the sudoers rule.

## Making the panel reachable on your network

By default the panel only listens on `127.0.0.1` (this machine only). To
reach it from other devices on your LAN, set a password and bind it to all
interfaces:

```ini
RTL_PANEL_HOST=0.0.0.0
RTL_PANEL_PASSWORD=pick-a-long-password
```

Then open `http://<this-machine's-LAN-IP>:3000`; your browser asks for the
username (`admin` unless you set `RTL_PANEL_USERNAME`) and password. The
panel refuses to start on a non-loopback address without a password
unless you set `RTL_PANEL_ALLOW_UNAUTHENTICATED=true`, in which case anyone
who can reach the port can edit configs and restart units.

Basic auth sends the password with every request, so put the panel behind
an HTTPS reverse proxy (below) if it's reachable from anywhere you don't
fully trust. The panel also refuses state-changing requests from other
sites (an `Origin` check), and rate-limits requests per client: 300 a minute
overall, 60 a minute for each action that writes configs or touches
systemd.

## Allowing real systemd control (sudo mode)

With `RTL_PANEL_SYSTEMD_MODE=sudo` the panel really starts, stops and
restarts your instances' services, by running `systemctl`/`journalctl`
through `sudo`. Only turn it on once you're ready to affect running
instances; consider trying it on a non-critical one first.

The panel's user needs passwordless `sudo` for exactly those commands,
never a blanket grant. The example rule at
[`deploy/rtl-airband-panel.sudoers`](./deploy/rtl-airband-panel.sudoers)
allows only the exact commands the panel runs. sudo matches commands word
for word, so use the rule from the version of the panel you're running.

**Limiting it to your instances.** If your instance names share a prefix
(for example `rtl_151`, `rtl_office`), set `RTL_PANEL_SUDO_UNIT_PREFIX=rtl_`
and keep the same prefix in the sudoers rule's globs. The panel then
refuses to touch any other service, and sudo refuses as well. If your names
don't share a prefix, leave it empty and change the rule's `rtl_*.service`
globs to `*.service`. The rule still limits the panel to those exact
commands.

Adjust the username, the prefix and the unit directory in the rule, then:

```bash
sudo cp deploy/rtl-airband-panel.sudoers /etc/sudoers.d/rtl-airband-panel
sudo chmod 0440 /etc/sudoers.d/rtl-airband-panel
sudo visudo -c -f /etc/sudoers.d/rtl-airband-panel
```

The panel always calls `sudo -n` (non-interactive), so a missing or
out-of-date rule fails with a clean, logged error rather than a password
prompt.

## Migrating from the Node.js panel

Versions up to v0.4.110 shipped a Node.js backend (`backend/api`). The
binary replaces it in place: it reads and writes the same instances
directory, the same `.pending-restarts.json`, `.instance-options.json` and
`.backups/`, and the same stats database, and takes the same `RTL_PANEL_*`
settings.

**With a release:** run `sudo ./install.sh`. It:
- stops the old service and saves its unit as
  `rtl-airband-panel.service.node-backup`;
- keeps the account the old unit ran as (`User=`);
- creates `/etc/rtl-airband-panel/panel.env` from the old unit's
  `EnvironmentFile` (your `.env`):
  - your instances folder, password and other settings carry over;
  - relative paths, such as a stats database under the old checkout, are
    anchored to its `WorkingDirectory`;
  - the bundled `rtl_airband` and sudo mode are added unless you had set
    them;
- installs the sudoers rule for that account.

Check the new `panel.env`. `--user` and `--instances-dir` override what
the installer finds.

**By hand:**

1. Stop the old panel: `sudo systemctl disable --now rtl-airband-panel`.
2. Install the binary and the new unit as above, replacing
   `/etc/systemd/system/rtl-airband-panel.service`. The old unit ran
   `/usr/bin/node backend/api/dist/index.js` from the repo checkout.
3. Move your settings into `panel.env`, or point `EnvironmentFile=` at your
   existing `.env`. `RTL_PANEL_FRONTEND_DIST` is no longer needed (the UI is
   built in), and `RTL_PANEL_LOG_LEVEL` takes the new filter syntax (plain
   levels like `info` still work).
4. **In sudo mode, reinstall the sudoers rule.** The status query now asks
   systemd for each unit's start time (`--property=ActiveEnterTimestamp
   --timestamp=utc`), which the old rule doesn't allow, so every status
   check would be refused.
5. If the panel now listens beyond localhost, set `RTL_PANEL_PASSWORD`.
6. `sudo systemctl daemon-reload && sudo systemctl enable --now rtl-airband-panel`.

The panel adds a `.running/` directory next to your configs (what each
instance was started with, for live-apply predictions).

## Running behind a reverse proxy

The live log viewer (the "Logs" section on an instance's edit page) streams
via Server-Sent Events — a single long-lived HTTP response. nginx (and most
reverse proxies) buffer a proxied response by default, which breaks this:
instead of arriving live, log lines get held back and delivered in delayed
bursts, or not at all until the connection eventually closes. If you're
putting this panel behind nginx, disable buffering and raise the read
timeout for its API traffic:

```nginx
location /api/instances/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    chunked_transfer_encoding on;
}
```

The panel also sends `X-Accel-Buffering: no` on the stream response itself
(nginx's own opt-out header), so no operator action is needed for that
specific piece — but `proxy_buffering off` above is still the primary fix,
and the only one that also helps with other proxies that don't honor that
header. The stream sends a small heartbeat comment every 15 seconds as a
second line of defense against any intermediary timing out an idle-looking
connection, but `proxy_read_timeout` is the right place to fix that for
nginx specifically.

The panel's live-update channel is a WebSocket at `/api/ws`, so the proxy
also needs to pass WebSocket upgrades through. And the rest of the panel
(`location /`) needs the same `Host` handling:

```nginx
location /api/ws {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}

location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
}
```

Without the WebSocket block the UI still works; it just falls back to
refreshing every 20 seconds (the rail footer shows "Polling" instead of
"Live").

**`Host` must be passed through, and allowed.** The panel refuses
state-changing requests and WebSocket upgrades whose `Origin` doesn't match
the `Host` header, so the proxy must forward the browser's `Host`
(`proxy_set_header Host $host`, as above), not nginx's default
`127.0.0.1:3000`. A panel bound to `127.0.0.1` also only answers loopback
host names, as a guard against DNS rebinding, so tell it your proxy's
public name:

```ini
RTL_PANEL_ALLOWED_HOSTS=panel.example.com
```

(comma-separated for several names). Without it, requests through the
proxy get `403 Host not allowed`.

## Logs & backups

**Panel logs.** By default the panel's own process writes log lines to
stdout — it has no log file or rotation of its own. Running it
via the systemd unit above means journald owns storage and rotation for you
(`journalctl -u rtl-airband-panel`, subject to your system's normal
journald retention config, e.g. `SystemMaxUse=` in
`/etc/systemd/journald.conf`). The example unit also sets
`SyslogIdentifier=rtl-airband-panel`, so `journalctl -t rtl-airband-panel`
works as an alternative to `-u rtl-airband-panel`. Set `RTL_PANEL_LOG_FILE`
(or `--log-file`) to a path instead if you'd rather the panel write NDJSON
(NDJSON) straight to a dedicated file — rotation of that file is then on you (e.g.
`logrotate`), same as if you'd run the panel directly in a terminal or
backgrounded with `nohup`/`&` (not recommended for anything long-running)
without redirecting its stdout yourself.

`RTL_PANEL_LOG_FILE` only relocates the panel's *own* logging. In `sudo`
systemd mode, every `sudo systemctl ...` the panel runs also produces its
own PAM session-open/close and command-audit lines, written by `sudo`
itself straight to syslog (typically `/var/log/auth.log` or equivalent) —
independent of the panel's process and unaffected by this setting, since
it's the OS's `sudo`/PAM stack doing the logging, not the panel. The
panel batches every instance's status check into one `sudo systemctl show`
call rather than one call per instance specifically to keep that volume
from scaling with instance count;
if you still want to relocate what's left, that's a syslog/rsyslog-side
routing rule for `sudo`'s facility, not something the panel can configure.

By default, the panel logs mutating actions (create/update/delete/rename/
restart/import) as one audit line each, plus warnings and errors — it does
*not* log a line for every HTTP request, so routine UI polling (the
instance list, stats, `/metrics` scrapes) doesn't flood the journal.
Every response carries an `x-request-id` header, and the audit line for
the same action is tagged with it. `RTL_PANEL_LOG_LEVEL` (default `info`)
is a further volume knob on top of
that default, not the primary fix for request noise: raising it to `warn`
also silences the audit lines (they're logged at `info`), including a
failed save's validation errors, so an operator who wants "quiet but keep
every failed save visible" should leave it at `info` and rely on the
request-logging default alone. Lower it to `debug`/`trace` (or e.g.
`panel=debug,info`) for troubleshooting.

**Stats database.** `RTL_PANEL_STATS_DB_PATH` (default
`~/.rtl-airband-panel/stats.db`) is regenerable, not authoritative: it's a
rolling window of samples re-derived by polling each instance's stats file,
capped at `RTL_PANEL_STATS_RETENTION_DAYS`, not a record of anything
RTLSDR-Airband itself persists. Losing it costs you historical charts back
to your retention window, not any operational state — the panel starts a
fresh one automatically if the file is missing. If you want longer-lived
history than your retention setting keeps, back the file up on whatever
schedule matches how much history you'd tolerate losing (a plain file copy
is safe to take live; SQLite's WAL mode, which this file uses, tolerates
being copied while the panel is running, though you may catch a write
mid-flight — prefer `sqlite3 stats.db ".backup backup.db"` over `cp` if that
matters to you). There's no built-in backup/export for this file today.
