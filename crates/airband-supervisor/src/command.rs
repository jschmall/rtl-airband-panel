//! Runs external commands with an explicit argv (never a shell string).

use std::process::Stdio;

use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

#[derive(Debug, Error)]
pub enum CommandError {
    #[error("Command failed (exit {exit_code:?}): {command} {}\n{stderr}", args.join(" "))]
    Failed { command: String, args: Vec<String>, exit_code: Option<i32>, stderr: String },
    #[error("could not run {command}: {source}")]
    Spawn { command: String, source: std::io::Error },
}

pub async fn run_command(command: &str, args: &[String], input: Option<&str>) -> Result<String, CommandError> {
    let mut child = Command::new(command)
        .args(args)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|source| CommandError::Spawn { command: command.to_string(), source })?;
    if let (Some(text), Some(mut stdin)) = (input, child.stdin.take()) {
        stdin
            .write_all(text.as_bytes())
            .await
            .map_err(|source| CommandError::Spawn { command: command.to_string(), source })?;
    }
    let out = child
        .wait_with_output()
        .await
        .map_err(|source| CommandError::Spawn { command: command.to_string(), source })?;
    if !out.status.success() {
        return Err(CommandError::Failed {
            command: command.to_string(),
            args: args.to_vec(),
            exit_code: out.status.code(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        });
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
