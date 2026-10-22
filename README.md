# rtl-airband-panel

[![CI](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml)
[![License: GPL v2](https://img.shields.io/badge/License-GPLv2-blue.svg)](./LICENSE)

A web control panel for [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband).

If you run more than one SDR with RTLSDR-Airband, each one is its own
`rtl_airband` process with its own `.conf` file and systemd service. This
panel gives you one place to see them all, edit their configs safely, and
restart only the one you changed.

![Overview](./docs/screenshots/main_page.png)

## What it does

- **See everything at a glance.** Every instance with a status light
  (running, starting, failed, stopped), uptime, the frequencies it covers,
  and any problem counters such as buffer overflows or failed uploads.
- **Edit configs in a form, not a text file.** Devices, channels, mixers and
  every output type (Icecast, file, UDP, PulseAudio, rdio-scanner uploads,
  and more), with drag-and-drop channel ordering and duplicate/copy buttons.
- **Catch mistakes before they reach the radio.** Errors show up as you
  type: frequencies outside the dongle's range, two channels landing in the
  same FFT bin, unsupported sample rates, CTCSS typos, and many more. A
  config with errors can't be saved.
- **Know what a change will do before you make it.** The editor tells you
  whether a change can be applied to the running instance on the fly, or
  needs a restart, and which channels would briefly drop out.
- **Apply changes without a restart** where the radio supports it: retune,
  gain, sample rate, adding or editing channels, and turning channels on or
  off. Needs the RTLSDR-Airband fork, see
  [Live apply](#applying-changes-without-a-restart).
- **Restart only what you changed.** Saving one instance never touches the
  others. Instances with saved changes that aren't running yet are flagged,
  with one click to restart them all.
- **Watch logs and history.** A live log viewer per instance, plus charts
  of signal versus squelch level per channel, and a Prometheus `/metrics`
  endpoint.
- **Nothing is lost on save.** Every save keeps a backup of the previous
  file, settings the panel doesn't know about are kept exactly as written,
  and passwords are hidden unless you ask to see them.
- **Works from your phone.** The layout adapts to small screens. There's
  a dark and a light theme.

## Which RTLSDR-Airband do I need?

The panel works with standard RTLSDR-Airband. A few features need
[`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband), a
fork that tracks upstream and adds:

- applying changes without a restart (the control socket)
- rdio-scanner call uploads
- combining channels from different SDRs into one mix (`mixer_remote`)
- structured JSON logs, and a stats HTTP endpoint

The editor marks fork-only settings as such. Standard RTLSDR-Airband
ignores most of them, but a few (the `mixer_remote` output type, JSON
logging) stop it from starting.

## Installing

There are no ready-made downloads yet, so you build the panel yourself. It
takes a few minutes on a PC. A Raspberry Pi can build it too, but slowly
(think tens of minutes on a Pi 4, with at least 2 GB of RAM).

**1. Install the build tools.** On Debian, Ubuntu or Raspberry Pi OS:

```bash
sudo apt install build-essential git
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh   # Rust
```

You also need Node.js 20 or newer (check with `node --version`). It's
only used during the build; the panel itself doesn't need it.

**2. Build:**

```bash
git clone https://github.com/jschmall/rtl-airband-panel.git
cd rtl-airband-panel
npm ci
npm run build --workspace=frontend
cargo build --release -p rtl-airband-panel
```

**3. Install the program:**

```bash
sudo install -m 0755 target/release/rtl-airband-panel /usr/local/bin/
rtl-airband-panel --version
```

That's one file with everything built in. You can copy it to another
machine of the same kind (for example, from one 64-bit Intel/AMD Debian box
to another) instead of building there too.

## Trying it out

Start with a **copy** of your configs, so nothing you try can affect your
running radios:

```bash
mkdir -p ~/panel-test
cp /path/to/your/configs/*.conf ~/panel-test/
rtl-airband-panel --instances-dir ~/panel-test
```

Then open <http://localhost:3000>. If the panel runs on a different machine,
connect with `ssh -L 3000:localhost:3000 you@that-machine` and open the
same address on your own computer.

Out of the box the panel is in **safe mode**: it never starts, stops or
restarts anything, so statuses read "Unknown". Saving does write to the
config files in the folder you pointed it at, which is why you're using a
copy.

When you're ready to manage your real instances (start the panel at boot,
reach it from other devices, let it restart services), follow
[DEPLOYMENT.md](./DEPLOYMENT.md).

## Using the panel

**Instances.** Each instance is one config file, `<name>.conf`, managed by a
systemd service of the same name, `<name>.service`. Pick any names you like.
The left-hand list shows every instance with its status light. Type in the
filter box to find an instance by name, channel label, frequency or
modulation. **+ New** creates an instance (config file and service).
Rename, restart and delete are at the top of each instance's page.

**Editing and saving.** Open an instance, change what you need, and use the
bar at the bottom of the page:

- **Save** writes the config. The running instance keeps its old settings
  until it's restarted, and the instance is marked *pending restart*.
- **Apply live** saves, then asks the running instance to pick up whatever
  it can without restarting (see the next section).
- **Save and restart** saves and restarts that instance. Its audio drops
  for a few seconds.
- **Check config** runs the full check without saving.

As you edit, the bar shows which of these your change needs: "Can be
applied live", "Needs a restart", or "already running". Click **Details** to
see exactly what changes and which channels would briefly drop out. Errors
appear at the top of the page and in the bar; click one to jump to the
field. `Ctrl+S` saves.

**Pending restarts.** A yellow banner lists instances whose saved config
isn't running yet, with a button to restart them all.

**Passwords.** Icecast passwords and rdio-scanner API keys show as dots.
Leave them alone and they're kept as they are; click **Show** to reveal one.

**Logs.** Each instance's page has a live log viewer. Turn on JSON logging
there (fork only) for cleaner, structured log lines; this restarts the
instance.

**Stats.** The Stats page charts each channel's signal against its squelch
level over the last hour, 6 hours or day, plus device and output counters.
For this, an instance needs `stats_filepath` set in its config. History is
kept for 7 days by default.

**Themes.** The bottom of the left-hand list switches between automatic
(follows your system), dark and light.

## Applying changes without a restart

This needs the [fork](#which-rtlsdr-airband-do-i-need). To turn it on for an
instance:

1. Set **Control socket path** in the instance's config to a path unique to
   that instance, for example `/run/rtl-airband/<name>.sock`, and restart it
   once.
2. Make the instance run as the same user as the panel: set **Service
   account** on its page, or set `RTL_PANEL_DEFAULT_SERVICE_USER` for every
   instance (see [Settings](#settings)). The panel warns you if this is
   missing; without it, Apply live fails with a permission error.

**What can change without a restart:**

- center frequency (a retune)
- sample rate on RTL-SDR and Mirics dongles (the whole dongle pauses
  briefly)
- gain and tuner bandwidth on RTL-SDR and SoapySDR devices
- frequency correction (PPM) on RTL-SDR dongles
- switching channels and mixers on or off (the **Enabled** checkbox)
- adding, editing and removing channels, as long as the device has spare
  capacity: set **Reserve channels** on the device (and **Reserve inputs**
  on any mixer those channels feed), then restart once. Editing a channel
  briefly drops it and the channels listed after it.

**What always needs a restart:** global settings, a mixer's own outputs
and filters, device serial numbers or buffers, and adding or removing a
device or mixer. You don't need to remember this list: the bar at the
bottom of the editor tells you before you save.

After Apply live, the panel shows what was applied, what still needs a
restart, and anything that didn't take but can simply be retried, for
example after a brief hardware hiccup. A failed live change never stops the
instance; it keeps running with its previous settings.

## Combining channels from different SDRs

With the fork, a mixer in one instance can take audio from a channel in
another instance on the same machine. This is useful for building one mixed
stream out of several dongles. On the sending channel, add an output of type
**mixer_remote**. On the receiving mixer, add a **Remote input** with the
same path and stream ID:

```
# sending instance, on a channel:
outputs: ( { type = "mixer_remote"; dest_path = "/run/rtl-airband/mymix.sock"; stream_id = 0; } );

# receiving instance:
mixers: { mymix: {
  remote_inputs: ( { listen_path = "/run/rtl-airband/mymix.sock"; stream_id = 0; label = "site 2"; } );
  outputs: ( /* ... */ );
}; };
```

Both instances must run as the same user. Several senders can share one
path as long as each has its own stream ID. Remote inputs only connect when
the receiving instance starts, so changing them always needs a restart.

## Settings

Settings can be given as command-line options
(`rtl-airband-panel --port 8080`), environment variables
(`RTL_PANEL_PORT=8080`), or a settings file: a `.env` file in the current
folder, `--env-file <path>`, or the `panel.env` file when running as a
service ([DEPLOYMENT.md](./DEPLOYMENT.md)). If a setting appears more than
once, the command line wins, then the environment, then the file. See
[`.env.example`](.env.example) for a template, and `rtl-airband-panel --help`
for the full list.

| Setting | Option | Default | What it does |
|---|---|---|---|
| `RTL_PANEL_INSTANCES_DIR` | `--instances-dir` | `/etc/rtl-airband-panel/instances` | Folder holding the `<name>.conf` files. The panel keeps its own bookkeeping files here too (names starting with `.`); leave those alone |
| `RTL_PANEL_SYSTEMD_MODE` | `--systemd-mode` | `mock` | `mock` never touches systemd (safe mode); `sudo` really starts, stops and restarts services. See [DEPLOYMENT.md](./DEPLOYMENT.md#allowing-real-systemd-control-sudo-mode) |
| `RTL_PANEL_SUDO_UNIT_PREFIX` | `--sudo-unit-prefix` | empty | Only manage services whose names start with this, e.g. `rtl_`. Recommended if your instance names share a prefix |
| `RTL_PANEL_RTL_AIRBAND_BIN` | `--rtl-airband-bin` | `/usr/local/bin/rtl_airband` | The `rtl_airband` program new instances run |
| `RTL_PANEL_UNIT_DIR` | `--unit-dir` | `/etc/systemd/system` | Where service files for new instances are written |
| `RTL_PANEL_DEFAULT_SERVICE_USER` / `_GROUP` | `--default-service-user` / `--default-service-group` | empty | User and group instances run as, unless set on the instance's page. Set to the panel's own user for [live apply](#applying-changes-without-a-restart) |
| `RTL_PANEL_HOST` | `--host` | `127.0.0.1` | Network address to listen on. The default is this machine only; `0.0.0.0` means every network |
| `RTL_PANEL_PORT` | `--port` | `3000` | Port to listen on |
| `RTL_PANEL_PASSWORD` | `--password` | none | Login password. Required when the panel is reachable from other machines |
| `RTL_PANEL_USERNAME` | `--username` | `admin` | Login username |
| `RTL_PANEL_ALLOWED_HOSTS` | `--allowed-hosts` | none | Address(es) people use to reach the panel through a reverse proxy, e.g. `panel.example.com`. See [DEPLOYMENT.md](./DEPLOYMENT.md#running-behind-a-reverse-proxy) |
| `RTL_PANEL_ALLOW_UNAUTHENTICATED` | `--allow-unauthenticated` | `false` | Allow access from other machines without a password. Anyone who can reach the panel can then change your configs |
| `RTL_PANEL_STATS_DB_PATH` | `--stats-db-path` | `~/.rtl-airband-panel/stats.db` | Where stats history is stored |
| `RTL_PANEL_STATS_RETENTION_DAYS` | `--stats-retention-days` | `7` | How many days of stats history to keep; `0` keeps everything |
| `RTL_PANEL_STATS_POLL_INTERVAL_MS` | `--stats-poll-interval-ms` | `15000` | How often stats are collected, in milliseconds |
| `RTL_PANEL_STATS_PRUNE_INTERVAL_MS` | `--stats-prune-interval-ms` | `3600000` | How often old stats are cleaned up, in milliseconds |
| `RTL_PANEL_CONTROL_SOCKET_TIMEOUT_MS` | `--control-socket-timeout-ms` | `8000` | How long Apply live waits for an answer, in milliseconds |
| `RTL_PANEL_LOG_LEVEL` | `--log-level` | `info` | How much the panel logs: `error`, `warn`, `info`, `debug` |
| `RTL_PANEL_LOG_FILE` | `--log-file` | none | Write the panel's log to this file instead of the system journal |

## Backups and moving to a new machine

- **Every save keeps the previous version** of that instance's config in
  `.backups/<name>/` inside the instances folder (the last 10 per instance).
- **Export and import** every instance's config (including passwords) from
  the command line:

  ```bash
  curl -u admin:yourpassword http://localhost:3000/api/instances/export > instances.json
  curl -u admin:yourpassword -H 'content-type: application/json' \
       --data @instances.json http://localhost:3000/api/instances/import
  ```

  Import creates the instances that don't exist yet and skips those that
  do. Leave out `-u ...` if the panel has no password.
- **Stats history** (`stats.db`) can be thrown away at any time; the panel
  starts a new one.

## Troubleshooting

**Statuses all say "Unknown".** The panel is in safe mode
(`RTL_PANEL_SYSTEMD_MODE=mock`). That's expected when trying it out; see
[DEPLOYMENT.md](./DEPLOYMENT.md) to let it control your services.

**"Refusing to listen on 0.0.0.0 without authentication".** Set
`RTL_PANEL_PASSWORD` when the panel is reachable from other machines.

**Apply live says "permission denied" or "unreachable".** The instance must
run as the same user as the panel (see
[Applying changes without a restart](#applying-changes-without-a-restart)),
have a control socket path, and have been restarted since that path was
set.

**Status checks or restarts fail with a sudo error.** Install or update the
sudoers rule ([DEPLOYMENT.md](./DEPLOYMENT.md#allowing-real-systemd-control-sudo-mode)).
Rules from older versions of the panel are missing a permission the current
one needs.

**"Host not allowed" behind a reverse proxy.** Add the address you use to
`RTL_PANEL_ALLOWED_HOSTS` and pass the `Host` header through
([DEPLOYMENT.md](./DEPLOYMENT.md#running-behind-a-reverse-proxy)).

**My comments disappeared from a config file.** The panel rewrites the whole
file on every save and doesn't keep comments. The previous version, with
comments, is in `.backups/<name>/`.

**The Stats page is empty.** The instance needs `stats_filepath` set, and
needs to be running for a few minutes to collect history.

**Something else.** Check the panel's log with
`journalctl -u rtl-airband-panel`, and include `rtl-airband-panel --version`
when you report a problem.

## More screenshots

Editing an instance. The bar at the bottom says this change can be applied
live:

![Instance editor with change preview](./docs/screenshots/instance_example.png)

A channel's settings and outputs:

![Channel and output editor](./docs/screenshots/Individual_channel.png)

Signal versus squelch level for one channel:

![Stats page](./docs/screenshots/stats.png)

## More documentation

- [DEPLOYMENT.md](./DEPLOYMENT.md): running the panel as a service,
  reaching it from other devices, passwords, reverse proxies, letting it
  control systemd, and upgrading from the older Node.js version.
- [DEVELOPMENT.md](./DEVELOPMENT.md): how the panel works inside, building
  and testing, and the project's architecture.
- [CONTRIBUTING.md](./CONTRIBUTING.md): how to propose a change.
- [CHANGELOG.md](./CHANGELOG.md): what changed in each version.

## License

[GPL-2.0](./LICENSE).
