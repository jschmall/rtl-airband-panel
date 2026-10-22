//! Controls RTLSDR-Airband instances from outside the process: systemd
//! units, the control socket, stats, and journal logs, plus predicting
//! whether a config change can be applied live or needs a restart.
//!
//! rtl_airband is a monolithic executable with global state, so it is never
//! linked in; every interaction goes through one of these interfaces.

pub mod binary;
pub mod command;
pub mod control_socket;
pub mod instance;
pub mod keyed_mutex;
pub mod plan;
pub mod stats;
pub mod systemd;
pub mod unit_file;

pub use control_socket::{Command, CommandResult, ControlSocketClient, ReloadDiffResult};
pub use keyed_mutex::KeyedMutex;
pub use plan::{ApplyMethod, Baseline, ChangePlan, plan_change};
pub use stats::{StatSample, StatsReader, StatsSource, parse_prometheus_text};
pub use systemd::{ActiveState, LogLine, MockUnits, SudoSystemctl, UnitError, UnitManager, UnitStatus};
pub use unit_file::{ExecStart, UnitTemplate, parse_exec_start, render_unit_file};
