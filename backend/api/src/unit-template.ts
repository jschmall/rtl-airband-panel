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
  return `[Unit]
Description=${options.description}
Documentation=https://github.com/rtl-airband/RTLSDR-Airband/wiki
Wants=network.target
After=network.target

[Service]
Type=simple
ExecStart=${options.binaryPath} ${flags.join(" ")} -c ${options.confPath}
Restart=no

[Install]
WantedBy=multi-user.target
`;
}
