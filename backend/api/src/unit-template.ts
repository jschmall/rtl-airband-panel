export interface UnitTemplateOptions {
  description: string;
  binaryPath: string;
  confPath: string;
}

/**
 * Mirrors RTLSDR-Airband's own reference unit (init.d/rtl_airband.service):
 * foreground + no-waterfall (-F), log to stderr for journald (-e), and
 * Restart=no for the same reason upstream gives — a process exit means
 * either misconfiguration or total device failure, and restarting
 * wouldn't fix either. Explicit restarts go through this API instead.
 */
export function renderUnitFile(options: UnitTemplateOptions): string {
  return `[Unit]
Description=${options.description}
Documentation=https://github.com/rtl-airband/RTLSDR-Airband/wiki
Wants=network.target
After=network.target

[Service]
Type=simple
ExecStart=${options.binaryPath} -F -e -c ${options.confPath}
Restart=no

[Install]
WantedBy=multi-user.target
`;
}
