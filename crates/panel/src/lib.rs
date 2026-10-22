//! rtl-airband-panel: web control panel for RTLSDR-Airband instances.

pub mod error;
pub mod http;
pub mod secrets;
pub mod service;
pub mod settings;
pub mod stats;
pub mod stats_db;
pub mod store;

use std::net::SocketAddr;
use std::sync::Arc;
use std::time::Duration;

use airband_supervisor::{ControlSocketClient, MockUnits, SudoSystemctl, UnitManager};
use tokio::sync::{broadcast, watch};

use crate::http::AppState;
use crate::service::{InstanceService, ServiceOptions};
use crate::settings::{Settings, SystemdMode};
use crate::stats::{PollStatusTracker, PollerOptions, StatsService};
use crate::stats_db::StatsDb;
use crate::store::ConfigStore;

pub struct App {
    pub state: AppState,
    pub router: axum::Router,
}

fn non_empty(s: &str) -> Option<String> {
    (!s.is_empty()).then(|| s.to_string())
}

/// Wires settings into the services and router (no background tasks).
pub fn build(settings: &Settings, units: Arc<dyn UnitManager>) -> Result<App, String> {
    let configs = ConfigStore::new(&settings.instances_dir);
    let service = InstanceService::new(
        configs,
        units,
        ControlSocketClient::new(Duration::from_millis(settings.control_socket_timeout_ms)),
        ServiceOptions {
            rtl_airband_bin: settings.rtl_airband_bin.clone(),
            default_service_user: non_empty(&settings.default_service_user),
            default_service_group: non_empty(&settings.default_service_group),
        },
    );
    let db = StatsDb::open(&settings.stats_db_path()).map_err(|e| format!("opening stats DB: {e}"))?;
    let (events, _) = broadcast::channel(256);
    let state = AppState {
        service: Arc::new(service),
        stats: Arc::new(StatsService { db: Arc::new(db), poll_status: Arc::new(PollStatusTracker::default()) }),
        auth: settings.password.clone().map(|p| Arc::new((settings.username.clone(), p))),
        bound_to_loopback: settings.host.is_loopback(),
        allowed_hosts: Arc::new(
            settings.allowed_hosts.iter().map(|h| h.trim().to_ascii_lowercase()).filter(|h| !h.is_empty()).collect(),
        ),
        limiter: Arc::default(),
        events,
        frontend_dir: settings.frontend_dist.clone(),
    };
    Ok(App { router: http::router(state.clone()), state })
}

pub fn unit_manager(settings: &Settings) -> Result<Arc<dyn UnitManager>, String> {
    Ok(match settings.systemd_mode {
        SystemdMode::Mock => Arc::new(MockUnits::default()),
        SystemdMode::Sudo => {
            Arc::new(SudoSystemctl::new(&settings.unit_dir, &settings.sudo_unit_prefix).map_err(|e| e.to_string())?)
        }
    })
}

/// Runs the server and background tasks until SIGINT/SIGTERM.
pub async fn serve(settings: Settings) -> Result<(), String> {
    settings.check_auth_policy()?;
    let app = build(&settings, unit_manager(&settings)?)?;

    match settings.systemd_mode {
        SystemdMode::Mock => tracing::warn!(
            "RTL_PANEL_SYSTEMD_MODE=mock: systemd actions are simulated, not real. Set RTL_PANEL_SYSTEMD_MODE=sudo to control real units."
        ),
        SystemdMode::Sudo if settings.sudo_unit_prefix.is_empty() => tracing::warn!(
            "RTL_PANEL_SYSTEMD_MODE=sudo with no RTL_PANEL_SUDO_UNIT_PREFIX set: sudo will act on any validly-named unit. Set a prefix (and a matching sudoers glob) to scope it to your instances."
        ),
        SystemdMode::Sudo => {}
    }
    if settings.frontend_dist.is_none() && !http::frontend::embedded_available() {
        tracing::warn!("this binary was built without a frontend; serving the API only (or pass --frontend-dist)");
    }
    if settings.password.is_none() && !settings.host.is_loopback() {
        tracing::warn!("serving without authentication on {} (--allow-unauthenticated)", settings.host);
    }

    let (shutdown_tx, shutdown_rx) = watch::channel(false);
    let poller = tokio::spawn(stats::run_poller(
        Arc::new(ConfigStore::new(&settings.instances_dir)),
        app.state.stats.clone(),
        PollerOptions {
            interval: Duration::from_millis(settings.stats_poll_interval_ms.max(1000)),
            retention_days: settings.stats_retention_days,
            prune_interval: Duration::from_millis(settings.stats_prune_interval_ms),
        },
        shutdown_rx,
    ));
    let watcher = tokio::spawn(http::ws::health_watcher(app.state.clone(), Duration::from_secs(5)));

    let addr = SocketAddr::new(settings.host, settings.port);
    let listener = tokio::net::TcpListener::bind(addr).await.map_err(|e| format!("binding {addr}: {e}"))?;
    tracing::info!("listening on http://{addr}");
    axum::serve(listener, app.router.into_make_service_with_connect_info::<SocketAddr>())
        .with_graceful_shutdown(async {
            let ctrl_c = tokio::signal::ctrl_c();
            let mut term =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).expect("SIGTERM handler");
            tokio::select! { _ = ctrl_c => {}, _ = term.recv() => {} }
        })
        .await
        .map_err(|e| e.to_string())?;

    // Stop the poller before the stats DB goes away with the process.
    let _ = shutdown_tx.send(true);
    let _ = poller.await;
    watcher.abort();
    Ok(())
}
