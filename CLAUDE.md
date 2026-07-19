# rtl-airband-panel

## What this is
A web control panel for RTLSDR-Airband instances. Each SDR runs as its
own systemd-managed rtl_airband process with its own .conf file
(one-service-per-instance). The panel reads/writes those config files
through a JSON intermediate model and restarts only the affected
systemd unit — there is no live-reload in RTLSDR-Airband itself.

## Architecture constraints (do not violate)
- RTLSDR-Airband config is parsed once at process startup into
  fixed-size arrays (devices, channels, FFT bins). There is no
  in-process reload path in upstream. Any config change requires a
  restart of that instance's systemd unit — never assume a signal or
  socket-based reload exists.
- FFT bin assignment is a function of a device's centerfreq,
  correction, and sample_rate. Adding/moving a channel can require
  recomputing bin occupancy for the whole device, not just one entry
  — validate this before treating any change as "cheap."
- One systemd unit per SDR instance. A config write must only ever
  restart the one unit it modifies — never a global restart.
- libconfig++ does not preserve comments through parse/serialize.
  Decide per-field whether to regenerate the whole file or do a
  targeted text patch before implementing the write path.

## Priorities, in order
1. Parser/serializer round-trip fidelity against real fixture files
   (backend/parser) — this is the highest-risk component; nothing
   else matters if this silently corrupts a config.
2. Semantic validation (backend/validate) — frequency-in-window,
   bin-separation/collision checks, valid CTCSS/tone values.
3. API layer (backend/api) — config CRUD + systemd restart + health
   check, fails closed on any validation error.
4. Frontend — renders the JSON model, never talks to libconfig
   directly.

## Conventions
- Config fixtures in fixtures/ should be sanitized (no real
  server/mountpoint credentials) before committing.
- Every parser change needs a fixture-based round-trip test before
  it's considered done.
