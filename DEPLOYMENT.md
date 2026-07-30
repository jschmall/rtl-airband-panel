# Deployment

This covers running rtl-airband-panel as a long-lived service, rather than
just starting it in a terminal to try it out. See [README.md](./README.md)
for install and first-run instructions, and the
[Configuration](./README.md#configuration) section for every environment
variable and flag mentioned here.

## Making the panel reachable on your network

By default the server only listens on `127.0.0.1` (this machine only). To
reach it from other devices on your LAN, bind it to all interfaces:

```bash
npm start --workspace=backend/api -- --host 0.0.0.0
```

Then open `http://<this-machine's-LAN-IP>:3000` from another device.

There is no authentication on this API. Binding to `0.0.0.0` means anyone on
your network can read and write instance configs and trigger restarts (and,
in `sudo` systemd mode, real `systemctl` actions). `127.0.0.1` is the
default specifically so that reaching a wider network is a choice you make
on purpose.

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
    proxy_http_version 1.1;
    proxy_buffering off;
    proxy_read_timeout 3600s;
    chunked_transfer_encoding on;
}
```

The backend also sends `X-Accel-Buffering: no` on the stream response itself
(nginx's own opt-out header), so no operator action is needed for that
specific piece — but `proxy_buffering off` above is still the primary fix,
and the only one that also helps with other proxies that don't honor that
header. The stream sends a small heartbeat comment every 15 seconds as a
second line of defense against any intermediary timing out an idle-looking
connection, but `proxy_read_timeout` is the right place to fix that for
nginx specifically.

## Running the panel as a systemd service

Running the panel process directly in a terminal (or backgrounded with
`&`/`nohup`) means it doesn't survive a reboot or restart itself if it
crashes. An example unit file is provided at
[`deploy/rtl-airband-panel.service`](./deploy/rtl-airband-panel.service) —
this manages the *panel's own* process, separate from the per-instance
`rtl_<name>.service` units the panel itself creates and controls for each
RTLSDR-Airband instance.

1. Clone and build the app in its final location, e.g.
   `/opt/rtl-airband-panel`:

   ```bash
   sudo git clone https://github.com/jschmall/rtl-airband-panel.git /opt/rtl-airband-panel
   cd /opt/rtl-airband-panel
   sudo npm install
   sudo npm run build:deps
   sudo npm run build
   ```

2. Create a dedicated system user to run the panel as (avoid running it as
   `root`):

   ```bash
   sudo useradd --system --create-home --home-dir /opt/rtl-airband-panel --shell /usr/sbin/nologin rtl-airband-panel
   sudo chown -R rtl-airband-panel:rtl-airband-panel /opt/rtl-airband-panel
   ```

3. Copy your `.env` (see [Configuration](./README.md#configuration)) to
   `/opt/rtl-airband-panel/.env` if you're using one, owned by the same
   user.

4. Install the unit file, adjusting `WorkingDirectory`, `User`, and
   `EnvironmentFile` inside it first if your install path or user differs
   from the example:

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

If you're running with `RTL_PANEL_SYSTEMD_MODE=sudo` (see
[Systemd control](./README.md#systemd-control)) so the panel can restart
real `rtl_airband` instances, the `rtl-airband-panel` system user needs
passwordless `sudo` access to `systemctl` — don't grant it blanket `sudo`
access. Instance naming is entirely up to you (see
[Systemd control](./README.md#systemd-control) for how to scope this to
only your instances), but even without that extra scoping, the example rule
at [`deploy/rtl-airband-panel.sudoers`](./deploy/rtl-airband-panel.sudoers)
still limits the grant to exactly the `systemctl`/`tee`/`rm` commands the
sudo adapter issues, never a blanket `sudo systemctl` or `sudo ALL`:

```bash
sudo cp deploy/rtl-airband-panel.sudoers /etc/sudoers.d/rtl-airband-panel
sudo chmod 0440 /etc/sudoers.d/rtl-airband-panel
sudo visudo -c -f /etc/sudoers.d/rtl-airband-panel
```

### Updating a systemd-managed install

After a `git pull` on a systemd-managed install, rebuild and restart instead
of manually starting the server:

```bash
cd /opt/rtl-airband-panel
sudo -u rtl-airband-panel git pull
sudo -u rtl-airband-panel npm install
sudo -u rtl-airband-panel npm run build:deps
sudo -u rtl-airband-panel npm run build
sudo systemctl restart rtl-airband-panel
```

If you're updating an install from before the Node 20 requirement was
added, upgrade Node on this machine first — `npm install` will fail (or the
server will fail to start) on Node 18.

## Logs & backups

**Panel logs.** The panel's own process writes structured JSON log lines to
stdout — it has no log file or rotation of its own. Running it via the
systemd unit above means journald owns storage and rotation for you
(`journalctl -u rtl-airband-panel`, subject to your system's normal
journald retention config, e.g. `SystemMaxUse=` in
`/etc/systemd/journald.conf`). The example unit also sets
`SyslogIdentifier=rtl-airband-panel`, so `journalctl -t rtl-airband-panel`
works as an alternative to `-u rtl-airband-panel`. If you instead run the
panel directly in a terminal or backgrounded with `nohup`/`&` — not
recommended for anything long-running — nothing rotates or caps that output
for you; redirect it through your own log rotation (e.g. `logrotate`, or
pipe through `svlogd`/`multilog`) if you go that route.

By default, the panel logs mutating actions (create/update/delete/rename/
restart/import) as one audit line each, plus warnings and errors — it does
*not* log a line for every HTTP request, so routine UI polling (the
instance list, stats, `/metrics` scrapes) doesn't flood the journal.
`RTL_PANEL_LOG_LEVEL` (default `info`) is a further volume knob on top of
that default, not the primary fix for request noise: raising it to `warn`
also silences the audit lines (they're logged at `info`), including a
failed save's validation errors, so an operator who wants "quiet but keep
every failed save visible" should leave it at `info` and rely on the
request-logging default alone. Lower it to `debug`/`trace` for
troubleshooting.

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
