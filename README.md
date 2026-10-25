# rtl-airband-panel

[![CI](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml/badge.svg)](https://github.com/jschmall/rtl-airband-panel/actions/workflows/ci.yml)
[![License: GPL v2](https://img.shields.io/badge/License-GPLv2-blue.svg)](./LICENSE)

A web control panel for [RTLSDR-Airband](https://github.com/rtl-airband/RTLSDR-Airband).

If you run more than one SDR with RTLSDR-Airband, each one is its own
`rtl_airband` process with its own `.conf` file and systemd service. This
panel gives you one place to see them all, edit their configs safely, and
restart only the one you changed.

![Overview: every instance with its status, frequencies and SDR window](./docs/screenshots/overview.png)

## What it does

- **See everything at a glance.** Every instance with its status, uptime,
  frequencies, each SDR's window for new channels, and problem counters
  such as buffer overflows or failed uploads.
- **Edit configs in a form, not a text file.** Devices, channels, mixers and
  every output type (Icecast, file, UDP, PulseAudio, rdio-scanner uploads,
  and more), with drag-and-drop channel ordering and duplicate buttons.
- **Catch mistakes before they reach the radio.** Errors show up as you
  type: frequencies outside the dongle's window, two channels in the same
  FFT bin, unsupported sample rates, CTCSS typos, and more. A config with
  errors can't be saved.
- **Know what a change will do before you make it.** The editor says
  whether a change can be applied on the fly or needs a restart, and which
  channels would briefly drop out.
- **Apply changes without a restart** where the radio supports it: retune,
  gain, sample rate, adding or editing channels, turning channels on or
  off.
- **Restart only what you changed.** Saving one instance never touches the
  others.
- **Check each radio's health live.** Headroom before the ADC clips, noise
  floor, frequency drift with a suggested `correction`, and gain advice.
- **Watch logs and history.** A live log viewer per instance, charts of
  signal versus squelch per channel, and a Prometheus `/metrics` endpoint.
- **Nothing is lost on save.** Every save keeps a backup of the previous
  file, settings the panel doesn't know are kept exactly as written, and
  passwords stay hidden unless you ask.
- **Works from your phone,** in a dark or light theme.

Applying changes live and the health readings need the bundled
[RTLSDR-Airband fork](#which-rtlsdr-airband-do-i-need). Everything else
works with any RTLSDR-Airband.

## A quick tour

**Editing an instance.** Every section collapses, and the page remembers
your layout for each instance. The bar at the bottom predicts what your
change needs; this gain change can be applied live, without a restart.

![Instance editor](./docs/screenshots/instance-editor.png)

**Channels and outputs** are forms, with a field for every setting
rtl_airband supports.

![A channel and its outputs](./docs/screenshots/channel-editor.png)

**Apply live** saves and hands the change to the running instance. Audio
keeps playing.

![Apply live result](./docs/screenshots/apply-live.png)

**Hardware** shows every SDR live: how close it is to clipping, with gain
advice, its noise floor, and its frequency drift with the `correction`
that would cancel it.

![Hardware page](./docs/screenshots/hardware.png)

**Stats** charts each channel's signal against its squelch level over the
last hour, 6 hours or day.

![Stats page](./docs/screenshots/stats.png)

The [user guide](./docs/guide.md) covers each page in detail.

## Installing

Releases are on the
[Releases page](https://github.com/jschmall/rtl-airband-panel/releases),
for 64-bit Intel/AMD (`amd64`) and 64-bit ARM (`arm64`: a Raspberry Pi 3,
4 or 5 running a 64-bit OS). They work on any Linux with systemd: Debian,
Ubuntu, Raspberry Pi OS and others.

```bash
# pick the file for your machine (uname -m: x86_64 = amd64, aarch64 = arm64)
curl -LO https://github.com/jschmall/rtl-airband-panel/releases/download/vX.Y.Z/rtl-airband-panel-vX.Y.Z-linux-amd64.tar.gz
tar xzf rtl-airband-panel-vX.Y.Z-linux-amd64.tar.gz
cd rtl-airband-panel-vX.Y.Z-linux-amd64
sudo ./install.sh
```

Then open <http://localhost:3000> on that machine.

**The installer asks a few questions:**

1. **Which account runs the panel.** It suggests the account your existing
   `rtl_airband` services run as. Instances must run as the same account
   as the panel for Apply live and the Hardware page to reach them.
2. **Whether to install the bundled `rtl_airband`** (the fork), or only
   the panel and keep your own.
3. **If you already have an `rtl_airband`: replace it, or go alongside?**
   - **Alongside** (the default): yours stays as it is, and existing
     instances keep running it. New instances run the fork.
   - **Replace**: your `rtl_airband` now runs the fork, with the original
     kept as `rtl_airband.pre-fork`. Existing instances switch to the fork
     when they next restart. Only a copy under `/usr/local` is replaced,
     never one from your system's packages.

**It also sets up:**
- access to SDR dongles without root (if the kernel's TV drivers already
  grabbed them, reboot once);
- the panel's settings, in `/etc/rtl-airband-panel/panel.env`;
- a narrow `sudo` rule so the panel can start, stop and restart instance
  services;
- the panel's own service, started now and at every boot.

**Options** for scripted installs (see `./install.sh --help`):

| Option | |
| --- | --- |
| `--listen-all` | Reachable from your whole network; generates a login password and prints it |
| `--instances-dir DIR` | Where your instance configs live (default `/etc/rtl-airband-panel/instances`) |
| `--unit-prefix rtl_` | Only let the panel manage services whose names start with `rtl_` |
| `--user NAME` | The account to run as, without asking |
| `--panel-only` | Don't install the bundled `rtl_airband`; use the one you have |
| `--with-rtl-airband` | Install the bundled `rtl_airband` too, without asking |
| `--replace-rtl-airband` | Install it in place of the `rtl_airband` you already have (keeping a `.pre-fork` backup) |
| `--separate-rtl-airband` | Install it alongside the `rtl_airband` you already have (the default) |
| `--yes` | Don't ask anything; take the defaults |
| `--no-start` | Install but don't start the panel yet |

**Upgrading:** download the new release and run `sudo ./install.sh` again.
- It keeps your setup: `panel.env`, the account, instances folder and unit
  prefix stay as they are unless you pass an option to change them.
- A service file you've edited by hand is left alone.
- Running instances keep the old `rtl_airband` until each one is
  restarted.

**Uninstalling:** `sudo ./install.sh --uninstall` removes the programs,
the panel's service and its system files, and puts back an `rtl_airband`
it replaced. It keeps your configs, settings, stats and every instance's
own service.

**Coming from the old Node.js panel?** The installer backs up its service
file, keeps the account it ran as, and copies your `.env` settings into
`panel.env`. See
[Migrating from the Node.js panel](./DEPLOYMENT.md#migrating-from-the-nodejs-panel).

**Building from source** instead: see
[DEVELOPMENT.md](./DEVELOPMENT.md#building-from-source).

## Trying it out safely

To look around without any risk to your running radios, run the panel by
hand against a **copy** of your configs (add `--port 3001` if the
installed panel already uses 3000):

```bash
mkdir -p ~/panel-test
cp /path/to/your/configs/*.conf ~/panel-test/
rtl-airband-panel --instances-dir ~/panel-test
```

Then open <http://localhost:3000>. From another computer, connect with
`ssh -L 3000:localhost:3000 you@that-machine` and open the same address.

Run by hand like this, the panel is in **safe mode**: it never starts,
stops or restarts anything, so statuses read "Unknown". Saving does write
to the files in the folder you gave it, which is why it's a copy.

## Which RTLSDR-Airband do I need?

The release includes a build of
[`jschmall/RTLSDR-Airband`](https://github.com/jschmall/RTLSDR-Airband), a
fork that tracks upstream and adds:

- applying changes without a restart (the control socket)
- live hardware health readings for the Hardware page
- rdio-scanner call uploads
- combining channels from different SDRs into one mix (`mixer_remote`)
- structured JSON logs, and a stats HTTP endpoint

New instances you create in the panel use that build. Instances you
already have keep running whatever `rtl_airband` their service points at,
unless you chose **Replace** when installing.

The panel also works with standard RTLSDR-Airband. It detects which build
each instance runs, and marks fork-only settings. Standard RTLSDR-Airband
ignores most of them, but a few (the `mixer_remote` output type, JSON
logging) stop it from starting, so the panel blocks those.

The bundled `rtl_airband` supports RTL-SDR and Mirics dongles, with
narrowband FM and rdio-scanner uploads. It's built without PulseAudio and
SoapySDR; if you need those, build the fork yourself and point the panel
at it (`RTL_PANEL_RTL_AIRBAND_BIN`).

## More documentation

- [User guide](./docs/guide.md): each page in detail, Apply live, the
  Hardware readings, every setting, backups and troubleshooting.
- [DEPLOYMENT.md](./DEPLOYMENT.md): running as a service, reaching it from
  other devices, passwords, reverse proxies, letting it control systemd.
- [DEVELOPMENT.md](./DEVELOPMENT.md): building from source, testing, and
  how the panel works inside.
- [CONTRIBUTING.md](./CONTRIBUTING.md): how to propose a change.
- [CHANGELOG.md](./CHANGELOG.md): what changed in each version.

## License

[GPL-2.0](./LICENSE).
