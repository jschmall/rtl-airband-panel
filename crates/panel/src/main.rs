use panel::settings::Settings;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    let settings = Settings::load();
    let filter = EnvFilter::try_new(&settings.log_level).unwrap_or_else(|_| EnvFilter::new("info"));
    match &settings.log_file {
        Some(path) => {
            let file = std::fs::OpenOptions::new().create(true).append(true).open(path).unwrap_or_else(|e| {
                eprintln!("could not open log file {}: {e}", path.display());
                std::process::exit(1);
            });
            tracing_subscriber::fmt().json().with_env_filter(filter).with_writer(std::sync::Mutex::new(file)).init();
        }
        None => tracing_subscriber::fmt().with_env_filter(filter).init(),
    }
    if let Err(e) = panel::serve(settings).await {
        eprintln!("{e}");
        std::process::exit(1);
    }
}
