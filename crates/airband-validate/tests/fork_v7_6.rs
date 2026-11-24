//! Fork v7.6.0: a channel uses the FFT bin nearest its carrier.

use airband_validate::validate_config;

/// Paths of the channels reported as colliding, at the default 5 kHz bins around 100 MHz.
fn collisions(source: &str) -> Vec<String> {
    let config = airband_config::parse_config_file(source).unwrap();
    validate_config(&config).errors.into_iter().filter(|i| i.code == "fft-bin-collision").map(|i| i.path).collect()
}

fn device(freqs: &[&str]) -> String {
    let channels: Vec<String> =
        freqs.iter().map(|f| format!("{{ freq = {f}; outputs: ({{ type = \"pulse\"; }}); }}")).collect();
    format!(
        "multiple_demod_threads = true; multiple_output_threads = true; stats_filepath = \"/tmp/stats.txt\"; \
         localtime = true; devices: ({{ type = \"rtlsdr\"; serial = \"1\"; gain = 29; centerfreq = 100.0; channels: ({}); }});",
        channels.join(",")
    )
}

#[test]
fn a_channel_exactly_on_a_bin_collides_with_its_neighbors() {
    // Same input as the superseded golden, which put 100.5 one bin low and missed the first pair.
    let source =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus/bin-collision.conf")).unwrap();
    assert_eq!(collisions(&source), ["$.devices[0].channels[1]", "$.devices[0].channels[2]"]);
}

#[test]
fn a_smaller_fft_size_widens_the_bins() {
    // Superseded golden input: 100.5 and 100.503 with 10 kHz bins.
    let source =
        std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/corpus/bin-collision-fft-size.conf"))
            .unwrap();
    assert_eq!(collisions(&source), ["$.devices[0].channels[1]"]);
}

#[test]
fn channels_either_side_of_a_bin_boundary_do_not_collide() {
    // 100.2 and 100.8 bins above centerfreq; both were bin 100 before.
    assert_eq!(collisions(&device(&["100.501", "100.504"])), Vec::<String>::new());
}

#[test]
fn channels_nearest_the_same_bin_collide() {
    // 100.8 and 101.2 bins; bins 100 and 101 before.
    assert_eq!(collisions(&device(&["100.504", "100.506"])), ["$.devices[0].channels[1]"]);
}

#[test]
fn channels_either_side_of_centerfreq_collide_in_bin_zero() {
    assert_eq!(collisions(&device(&["99.999", "100.001"])), ["$.devices[0].channels[1]"]);
}
