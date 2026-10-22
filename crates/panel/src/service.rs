//! Instance operations behind the "fail closed on any validation error"
//! rule: validation always completes before any file is written or any unit
//! is touched. Port of backend/api's instance-service.ts, with live apply
//! reworked around `airband_supervisor::plan_change`:
//!
//! - every save reports what applying it would do (`plan`);
//! - pending-restart is cleared after a live apply only when reload_diff
//!   skipped nothing *and* the plan found nothing restart-only (reload_diff
//!   silently ignores some changes, see plan.rs);
//! - each instance's started/applied config text is recorded so the next
//!   plan compares against what the process actually has.

use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use airband_config::domain::Channel;
use airband_config::{RtlAirbandConfig, jsnum, parse_config};
use airband_supervisor::instance::{unit_name, validate_instance_name};
use airband_supervisor::systemd::{ActiveState, LogLine, UnitManager, UnitStatus};
use airband_supervisor::{
    Baseline, ChangePlan, ControlSocketClient, KeyedMutex, ReloadDiffResult, UnitTemplate, plan_change,
    render_unit_file,
};
use airband_validate::{ValidationIssue, ValidationResult, validate_config};
use serde::Serialize;
use serde_json::Value;
use tokio::sync::mpsc;

use crate::error::ApiError;
use crate::secrets::{redact_secrets, restore_secrets};
use crate::store::{
    BaselineStore, ConfigStore, InstanceOptions, InstanceOptionsPatch, InstanceOptionsStore, PendingRestartStore,
};

const LIVE_APPLY_COOLDOWN: Duration = Duration::from_millis(1000);
const MIN_LOG_LINES: u32 = 10;
const MAX_LOG_LINES: u32 = 2000;
const DEFAULT_LOG_LINES: u32 = 200;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceSummary {
    pub name: String,
    pub conf_path: String,
    pub unit: String,
    /// The .conf on disk is ahead of what the running process has loaded.
    pub pending_restart: bool,
    pub json_logging: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub service_group: Option<String>,
    pub status: UnitStatus,
    /// Labels, MHz frequencies, modulations, device types/serials, for global search.
    pub search_fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct WriteResult {
    pub warnings: Vec<ValidationIssue>,
    pub status: UnitStatus,
    pub version: String,
    /// What applying this save to the running process does (absent when the
    /// save also restarted it).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plan: Option<PlanReport>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanReport {
    pub method: airband_supervisor::ApplyMethod,
    #[serde(flatten)]
    pub plan: ChangePlan,
    /// False when the panel has no record of what the running process loaded
    /// (it was started outside the panel), so the current file was assumed.
    pub baseline_known: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum LiveApplyOutcome {
    Attempted {
        attempted: bool,
        applied: Vec<String>,
        #[serde(rename = "skippedRequiresRestart")]
        skipped_requires_restart: Vec<String>,
    },
    NotAttempted {
        attempted: bool,
        reason: &'static str,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyLiveResult {
    pub warnings: Vec<ValidationIssue>,
    pub status: UnitStatus,
    pub version: String,
    pub live_apply: LiveApplyOutcome,
    pub plan: PlanReport,
}

#[derive(Debug, Clone, Serialize)]
pub struct OptionsResult {
    pub status: UnitStatus,
    pub options: InstanceOptions,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "lowercase")]
pub enum ImportOutcome {
    Created,
    Skipped,
    Failed { error: String },
}

pub struct ServiceOptions {
    pub rtl_airband_bin: String,
    pub default_service_user: Option<String>,
    pub default_service_group: Option<String>,
}

pub struct InstanceService {
    pub configs: ConfigStore,
    units: Arc<dyn UnitManager>,
    pending: PendingRestartStore,
    options_store: InstanceOptionsStore,
    baselines: BaselineStore,
    control: ControlSocketClient,
    opts: ServiceOptions,
    mutex: KeyedMutex,
    last_live_apply: Mutex<HashMap<String, Instant>>,
}

fn unknown_status(unit: &str) -> UnitStatus {
    UnitStatus {
        unit: unit.to_string(),
        active_state: ActiveState::Unknown,
        sub_state: "unknown".into(),
        active_enter_timestamp: None,
    }
}

fn freq_mhz(hz: f64) -> String {
    jsnum::to_js_string(hz / 1_000_000.0)
}

fn search_fields(config: &RtlAirbandConfig) -> Vec<String> {
    let mut fields = Vec::new();
    for device in &config.devices {
        fields.push(device.device_type.clone());
        if let Some(s) = device.serial.as_ref().filter(|s| !s.is_empty()) {
            fields.push(s.clone());
        }
        for channel in &device.channels {
            match channel {
                Channel::Scan(c) => {
                    fields.extend(c.labels.iter().flatten().filter(|l| !l.is_empty()).cloned());
                    fields.extend(c.freqs.iter().map(|f| freq_mhz(*f)));
                    fields.extend(c.modulation.iter().filter(|m| !m.is_empty()).cloned());
                    fields.extend(c.modulations.iter().flatten().filter(|m| !m.is_empty()).cloned());
                }
                Channel::Multichannel(c) => {
                    fields.extend(c.label.iter().filter(|l| !l.is_empty()).cloned());
                    fields.push(freq_mhz(c.freq));
                    fields.extend(c.modulation.iter().filter(|m| !m.is_empty()).cloned());
                }
            }
        }
    }
    fields
}

/// Like JS `Number(text)` clamped into [10, 2000], defaulting to 200.
pub fn clamp_log_lines(raw: Option<&str>) -> u32 {
    let Some(raw) = raw else { return DEFAULT_LOG_LINES };
    let trimmed = raw.trim();
    let n = if trimmed.is_empty() { 0.0 } else { trimmed.parse::<f64>().unwrap_or(f64::NAN) };
    if !n.is_finite() {
        return DEFAULT_LOG_LINES;
    }
    (n.trunc() as i64).clamp(MIN_LOG_LINES as i64, MAX_LOG_LINES as i64) as u32
}

/// Decodes a request body as a config. `existing` (the on-disk config, if
/// any) supplies secrets the client sent back as the redaction sentinel.
pub fn decode_config(mut body: Value, existing: Option<&RtlAirbandConfig>) -> Result<RtlAirbandConfig, ApiError> {
    if !body.is_object() {
        return Err(ApiError::BadRequest("Expected an object (at $)".into()));
    }
    restore_secrets(&mut body, existing);
    serde_json::from_value(body).map_err(|e| ApiError::BadRequest(format!("{e} (at $)")))
}

impl InstanceService {
    pub fn new(
        configs: ConfigStore,
        units: Arc<dyn UnitManager>,
        control: ControlSocketClient,
        opts: ServiceOptions,
    ) -> InstanceService {
        let dir = configs.dir().to_path_buf();
        InstanceService {
            pending: PendingRestartStore::new(&dir),
            options_store: InstanceOptionsStore::new(&dir),
            baselines: BaselineStore::new(&dir),
            configs,
            units,
            control,
            opts,
            mutex: KeyedMutex::default(),
            last_live_apply: Mutex::new(HashMap::new()),
        }
    }

    async fn require_exists(&self, name: &str) -> Result<(), ApiError> {
        validate_instance_name(name)?;
        if !self.configs.exists(name).await {
            return Err(ApiError::NotFound(name.to_string()));
        }
        Ok(())
    }

    async fn status(&self, unit: &str) -> Result<UnitStatus, ApiError> {
        Ok(self.units.status(unit).await?)
    }

    fn unit_template(&self, name: &str, options: &InstanceOptions) -> UnitTemplate {
        UnitTemplate {
            description: format!("RTLSDR-Airband instance: {name}"),
            binary_path: self.opts.rtl_airband_bin.clone(),
            conf_path: self.configs.conf_path(name).display().to_string(),
            json_logging: options.json_logging,
            service_user: options.service_user.clone().or_else(|| self.opts.default_service_user.clone()),
            service_group: options.service_group.clone().or_else(|| self.opts.default_service_group.clone()),
        }
    }

    /// The process (re)started with whatever is on disk now.
    async fn record_started(&self, name: &str) -> Result<(), ApiError> {
        let text = self.configs.read_raw(name).await?;
        self.baselines.set_started(name, &text).await?;
        Ok(())
    }

    pub async fn list_instances(&self) -> Result<Vec<InstanceSummary>, ApiError> {
        let infos = self.configs.list().await?;
        let units: Vec<String> = infos.iter().map(|i| unit_name(&i.name)).collect();
        let statuses = self.units.status_many(&units).await?;
        let mut out = Vec::with_capacity(infos.len());
        for (info, unit) in infos.into_iter().zip(units) {
            let options = self.options_store.get(&info.name).await?;
            let search = match self.configs.read(&info.name).await {
                Ok(c) => search_fields(&c.config),
                Err(_) => Vec::new(),
            };
            out.push(InstanceSummary {
                pending_restart: self.pending.has(&info.name).await?,
                json_logging: options.json_logging,
                service_user: options.service_user,
                service_group: options.service_group,
                status: statuses.get(&unit).cloned().unwrap_or_else(|| unknown_status(&unit)),
                search_fields: search,
                name: info.name,
                conf_path: info.conf_path,
                unit,
            });
        }
        Ok(out)
    }

    /// Redacted config plus its version (ETag).
    pub async fn get_config(&self, name: &str) -> Result<(RtlAirbandConfig, String), ApiError> {
        self.require_exists(name).await?;
        let c = self.read_config(name).await?;
        Ok((redact_secrets(&c.config), c.version))
    }

    async fn read_config(&self, name: &str) -> Result<crate::store::CachedConfig, ApiError> {
        self.configs.read(name).await.map_err(|e| match e {
            crate::store::StoreError::Parse(p) => ApiError::Internal(format!("'{name}' could not be parsed: {p}")),
            other => other.into(),
        })
    }

    pub async fn get_secrets(&self, name: &str) -> Result<RtlAirbandConfig, ApiError> {
        self.require_exists(name).await?;
        Ok((*self.read_config(name).await?.config).clone())
    }

    pub async fn health(&self, name: &str) -> Result<UnitStatus, ApiError> {
        validate_instance_name(name)?;
        self.status(&unit_name(name)).await
    }

    pub async fn all_health(&self) -> Result<BTreeMap<String, UnitStatus>, ApiError> {
        let infos = self.configs.list().await?;
        let units: Vec<String> = infos.iter().map(|i| unit_name(&i.name)).collect();
        let statuses = self.units.status_many(&units).await?;
        Ok(infos
            .into_iter()
            .zip(units)
            .map(|(i, u)| (i.name, statuses.get(&u).cloned().unwrap_or_else(|| unknown_status(&u))))
            .collect())
    }

    pub async fn logs(&self, name: &str, lines: u32) -> Result<Vec<LogLine>, ApiError> {
        validate_instance_name(name)?;
        Ok(self.units.logs(&unit_name(name), lines).await?)
    }

    pub async fn follow_logs(&self, name: &str, lines: u32) -> Result<mpsc::Receiver<LogLine>, ApiError> {
        validate_instance_name(name)?;
        Ok(self.units.follow_logs(&unit_name(name), lines).await?)
    }

    /// Same validation a save runs, with no side effects.
    pub async fn validate_only(&self, name: &str, body: Value) -> Result<ValidationResult, ApiError> {
        self.require_exists(name).await?;
        let existing = self.read_config(name).await?;
        let config = decode_config(body, Some(&existing.config))?;
        Ok(validate_config(&config))
    }

    /// Predicts what applying `body` to the running process would do, without writing.
    pub async fn plan(&self, name: &str, body: Value) -> Result<PlanReport, ApiError> {
        self.require_exists(name).await?;
        let existing = self.read_config(name).await?;
        let config = decode_config(body, Some(&existing.config))?;
        let text = airband_config::serialize_config_file(&config);
        self.plan_against_baseline(name, &existing.raw, &text).await
    }

    async fn plan_against_baseline(
        &self,
        name: &str,
        current_raw: &str,
        next_text: &str,
    ) -> Result<PlanReport, ApiError> {
        let (baseline, baseline_known) = match self.baselines.get(name).await {
            Some(b) => (b, true),
            None => {
                (crate::store::Baseline { started: current_raw.to_string(), applied: current_raw.to_string() }, false)
            }
        };
        let parse = |t: &str| {
            parse_config(t).map_err(|e| ApiError::Internal(format!("baseline for '{name}' could not be parsed: {e}")))
        };
        let (started, applied, next) = (parse(&baseline.started)?, parse(&baseline.applied)?, parse(next_text)?);
        let plan = plan_change(&Baseline { started: &started, applied: &applied }, &next);
        Ok(PlanReport { method: plan.method(), plan, baseline_known })
    }

    /// Shared validate -> write -> mark-pending sequence (caller holds the instance lock).
    async fn validate_and_write(
        &self,
        name: &str,
        body: Value,
        if_match: Option<&str>,
    ) -> Result<(Vec<ValidationIssue>, String, String, String, RtlAirbandConfig), ApiError> {
        self.require_exists(name).await?;
        let existing = self.read_config(name).await?;
        if if_match.is_some_and(|v| v != existing.version) {
            return Err(ApiError::Conflict(name.to_string()));
        }
        let config = decode_config(body, Some(&existing.config))?;
        let result = validate_config(&config);
        if !result.errors.is_empty() {
            return Err(ApiError::Validation(result.errors));
        }
        let (version, text) = self.configs.write(name, &config).await?;
        // Pending from the moment the file lands, whatever happens next.
        self.pending.mark(name).await?;
        Ok((result.warnings, version, text, (*existing.raw).clone(), config))
    }

    pub async fn update_config(
        &self,
        name: &str,
        body: Value,
        restart: bool,
        if_match: Option<&str>,
    ) -> Result<WriteResult, ApiError> {
        let _guard = self.mutex.lock(name).await;
        let (warnings, version, text, previous_raw, _) = self.validate_and_write(name, body, if_match).await?;
        let unit = unit_name(name);
        let plan = if restart {
            self.units.restart(&unit).await?;
            self.pending.clear(name).await?;
            self.baselines.set_started(name, &text).await?;
            None
        } else {
            Some(self.plan_against_baseline(name, &previous_raw, &text).await?)
        };
        Ok(WriteResult { warnings, status: self.status(&unit).await?, version, plan })
    }

    pub async fn apply_live(
        &self,
        name: &str,
        body: Value,
        if_match: Option<&str>,
    ) -> Result<ApplyLiveResult, ApiError> {
        let _guard = self.mutex.lock(name).await;
        let (warnings, version, text, previous_raw, config) = self.validate_and_write(name, body, if_match).await?;
        let unit = unit_name(name);
        let plan = self.plan_against_baseline(name, &previous_raw, &text).await?;

        let not_attempted = |reason, detail| LiveApplyOutcome::NotAttempted { attempted: false, reason, detail };
        let Some(socket) = config.control_socket_path.clone() else {
            return Ok(ApplyLiveResult {
                warnings,
                status: self.status(&unit).await?,
                version,
                live_apply: not_attempted("no-control-socket", None),
                plan,
            });
        };

        let elapsed = self.last_live_apply.lock().unwrap().get(name).map(Instant::elapsed);
        if let Some(elapsed) = elapsed.filter(|e| *e < LIVE_APPLY_COOLDOWN) {
            let wait = (LIVE_APPLY_COOLDOWN - elapsed).as_millis();
            return Ok(ApplyLiveResult {
                warnings,
                status: self.status(&unit).await?,
                version,
                live_apply: not_attempted("cooldown", Some(format!("wait {wait}ms"))),
                plan,
            });
        }
        self.last_live_apply.lock().unwrap().insert(name.to_string(), Instant::now());

        let live_apply = match self.control.reload_diff(std::path::Path::new(&socket)).await {
            ReloadDiffResult::Applied { applied, skipped_requires_restart } => {
                if skipped_requires_restart.is_empty() && plan.plan.restart.is_empty() {
                    self.pending.clear(name).await?;
                    self.baselines.set_applied(name, &text).await?;
                }
                LiveApplyOutcome::Attempted { attempted: true, applied, skipped_requires_restart }
            }
            ReloadDiffResult::Unreachable { reason } => not_attempted("unreachable", Some(reason)),
            ReloadDiffResult::ProtocolError { message } => not_attempted("protocol-error", Some(message)),
        };
        Ok(ApplyLiveResult { warnings, status: self.status(&unit).await?, version, live_apply, plan })
    }

    pub async fn update_options(
        &self,
        name: &str,
        patch: InstanceOptionsPatch,
        restart: bool,
    ) -> Result<OptionsResult, ApiError> {
        let _guard = self.mutex.lock(name).await;
        self.require_exists(name).await?;
        let merged = self.options_store.set(name, patch).await?;
        let unit = unit_name(name);
        self.units.install_unit_file(&unit, &render_unit_file(&self.unit_template(name, &merged))).await?;
        self.units.daemon_reload().await?;
        self.pending.mark(name).await?;
        if restart {
            self.units.restart(&unit).await?;
            self.pending.clear(name).await?;
            self.record_started(name).await?;
        }
        Ok(OptionsResult { status: self.status(&unit).await?, options: merged })
    }

    pub async fn restart_instance(&self, name: &str) -> Result<UnitStatus, ApiError> {
        let _guard = self.mutex.lock(name).await;
        self.require_exists(name).await?;
        let unit = unit_name(name);
        self.units.restart(&unit).await?;
        self.pending.clear(name).await?;
        self.record_started(name).await?;
        self.status(&unit).await
    }

    pub async fn restart_all_pending(&self) -> Result<BTreeMap<String, Value>, ApiError> {
        let mut results = BTreeMap::new();
        for summary in self.list_instances().await? {
            if !summary.pending_restart {
                continue;
            }
            let outcome = match self.restart_instance(&summary.name).await {
                Ok(status) => serde_json::json!({ "status": status }),
                Err(e) => serde_json::json!({ "error": e.to_string() }),
            };
            results.insert(summary.name, outcome);
        }
        Ok(results)
    }

    /// Unredacted, for backups and host migration.
    pub async fn export_all(&self) -> Result<Value, ApiError> {
        let mut instances = serde_json::Map::new();
        for info in self.configs.list().await? {
            let config = self.read_config(&info.name).await?;
            instances.insert(info.name, serde_json::to_value(&*config.config).expect("config serializes"));
        }
        Ok(serde_json::json!({ "instances": instances }))
    }

    /// Creates every instance in the bundle that doesn't exist yet; existing names are skipped.
    pub async fn import_all(&self, bundle: Value) -> Result<Vec<(String, ImportOutcome)>, ApiError> {
        let Some(instances) = bundle.get("instances").and_then(Value::as_object) else {
            return Err(ApiError::BadRequest("Expected 'instances' to be an object (at $)".into()));
        };
        let mut results = Vec::new();
        for (name, config) in instances {
            let outcome = match self.create_instance(name, config.clone()).await {
                Ok(_) => ImportOutcome::Created,
                Err(ApiError::AlreadyExists(_)) => ImportOutcome::Skipped,
                Err(e) => ImportOutcome::Failed { error: e.to_string() },
            };
            results.push((name.clone(), outcome));
        }
        Ok(results)
    }

    /// Writes the conf file, installs, enables and starts a new unit; rolls back on failure.
    pub async fn create_instance(&self, name: &str, body: Value) -> Result<WriteResult, ApiError> {
        validate_instance_name(name)?;
        let _guard = self.mutex.lock(name).await;
        if self.configs.exists(name).await {
            return Err(ApiError::AlreadyExists(name.to_string()));
        }
        let config = decode_config(body, None)?;
        let result = validate_config(&config);
        if !result.errors.is_empty() {
            return Err(ApiError::Validation(result.errors));
        }
        let (version, text) = self.configs.write(name, &config).await?;
        let unit = unit_name(name);
        let contents = render_unit_file(&self.unit_template(name, &InstanceOptions::default()));
        let steps = async {
            self.units.install_unit_file(&unit, &contents).await?;
            self.units.daemon_reload().await?;
            self.units.enable(&unit).await?;
            self.units.start(&unit).await
        };
        if let Err(e) = steps.await {
            let _ = self.configs.remove(name).await;
            let _ = self.units.remove_unit_file(&unit).await;
            let _ = self.units.daemon_reload().await;
            return Err(e.into());
        }
        self.baselines.set_started(name, &text).await?;
        Ok(WriteResult { warnings: result.warnings, status: self.status(&unit).await?, version, plan: None })
    }

    /// Brings the new name up before tearing the old one down, so a failure
    /// never leaves the instance running under neither name.
    pub async fn rename_instance(&self, old: &str, new: &str) -> Result<WriteResult, ApiError> {
        validate_instance_name(new)?;
        let mut keys = vec![old.to_string(), new.to_string()];
        keys.sort();
        keys.dedup();
        let _g1 = self.mutex.lock(&keys[0]).await;
        let _g2 = match keys.get(1) {
            Some(k) => Some(self.mutex.lock(k).await),
            None => None,
        };
        self.require_exists(old).await?;
        if new == old {
            let c = self.read_config(old).await?;
            return Ok(WriteResult {
                warnings: vec![],
                status: self.status(&unit_name(old)).await?,
                version: c.version,
                plan: None,
            });
        }
        if self.configs.exists(new).await {
            return Err(ApiError::AlreadyExists(new.to_string()));
        }
        let config = self.read_config(old).await?;
        let (old_unit, new_unit) = (unit_name(old), unit_name(new));
        let options = self.options_store.get(old).await?;
        let contents = render_unit_file(&self.unit_template(new, &options));

        self.units.stop(&old_unit).await?;
        let steps = async {
            let (version, _) = self.configs.write(new, &config.config).await.map_err(ApiError::from)?;
            self.units.install_unit_file(&new_unit, &contents).await?;
            self.units.daemon_reload().await?;
            self.units.enable(&new_unit).await?;
            self.units.start(&new_unit).await?;
            Ok::<_, ApiError>(version)
        };
        let version = match steps.await {
            Ok(v) => v,
            Err(e) => {
                let _ = self.configs.remove(new).await;
                let _ = self.units.remove_unit_file(&new_unit).await;
                let _ = self.units.daemon_reload().await;
                let _ = self.units.start(&old_unit).await;
                return Err(e);
            }
        };
        self.units.disable(&old_unit).await?;
        self.units.remove_unit_file(&old_unit).await?;
        self.units.daemon_reload().await?;
        self.configs.remove(old).await?;
        self.pending.clear(old).await?;
        self.options_store.rename(old, new).await?;
        self.baselines.remove(old).await;
        self.record_started(new).await?;
        Ok(WriteResult { warnings: vec![], status: self.status(&new_unit).await?, version, plan: None })
    }

    pub async fn delete_instance(&self, name: &str) -> Result<(), ApiError> {
        let _guard = self.mutex.lock(name).await;
        self.require_exists(name).await?;
        let unit = unit_name(name);
        self.units.stop(&unit).await?;
        self.units.disable(&unit).await?;
        self.units.remove_unit_file(&unit).await?;
        self.units.daemon_reload().await?;
        self.configs.remove(name).await?;
        self.pending.clear(name).await?;
        self.options_store.remove(name).await?;
        self.baselines.remove(name).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn log_line_clamping_matches_js_number() {
        assert_eq!(clamp_log_lines(None), 200);
        assert_eq!(clamp_log_lines(Some("abc")), 200);
        assert_eq!(clamp_log_lines(Some("")), 10);
        assert_eq!(clamp_log_lines(Some("5")), 10);
        assert_eq!(clamp_log_lines(Some("500.9")), 500);
        assert_eq!(clamp_log_lines(Some("99999")), 2000);
        assert_eq!(clamp_log_lines(Some("1e3")), 1000);
    }
}
