export interface UnitTemplateOptions {
  description: string;
  binaryPath: string;
  confPath: string;
  /**
   * Adds -j to ExecStart, requesting single-line JSON log output instead of
   * plain text. Fork-only (requires RTLSDR-Airband built from
   * jschmall/RTLSDR-Airband); a vanilla-upstream binary doesn't recognize -j
   * and would refuse to start, so this must stay opt-in and default to
   * false/undefined — see InstanceOptionsStore.
   */
  jsonLogging?: boolean;
  /**
   * Account the systemd unit runs the process as. Left unset by default —
   * this must stay opt-in, not defaulted to any particular username, since
   * the panel has no way to know what account an operator's deployment
   * uses (see InstanceOptionsStore). Required in practice once the
   * instance's config sets `control_socket_path` (dynamic_reload fork):
   * the control socket's SO_PEERCRED check demands an exact UID match
   * against the daemon's own `getuid()`, so a unit left to run as root
   * (the default when User= is unset) locks out any non-root
   * control-socket client, including this panel's own `reload_diff`
   * calls — discovered and documented in the fork's own CLAUDE.md.
   */
  serviceUser?: string;
  /** Paired with serviceUser — see its comment. Meaningless without serviceUser also set. */
  serviceGroup?: string;
}

/**
 * Mirrors RTLSDR-Airband's own reference unit (init.d/rtl_airband.service):
 * foreground + no-waterfall (-F), log to stderr for journald (-e), and
 * Restart=no for the same reason upstream gives — a process exit means
 * either misconfiguration or total device failure, and restarting
 * wouldn't fix either. Explicit restarts go through this API instead.
 */
export function renderUnitFile(options: UnitTemplateOptions): string {
  const flags = ["-F", "-e", ...(options.jsonLogging ? ["-j"] : [])];
  const userGroupLines = [
    ...(options.serviceUser ? [`User=${options.serviceUser}`] : []),
    ...(options.serviceGroup ? [`Group=${options.serviceGroup}`] : []),
  ]
    .map((line) => `${line}\n`)
    .join("");
  return `[Unit]
Description=${options.description}
Documentation=https://github.com/rtl-airband/RTLSDR-Airband/wiki
Wants=network.target
After=network.target

[Service]
Type=simple
${userGroupLines}ExecStart=${options.binaryPath} ${flags.join(" ")} -c ${options.confPath}
Restart=no

[Install]
WantedBy=multi-user.target
`;
}
