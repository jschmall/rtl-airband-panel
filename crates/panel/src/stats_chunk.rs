//! The packed form of one series' samples within one 5-minute bucket.
//!
//! A chunk is a sequence of self-delimiting frames, so two chunks concatenate
//! into one valid chunk: a flush partway through a bucket just appends in SQL,
//! with no decoding. Each frame is:
//!
//! - the sample count;
//! - timestamps in whole seconds: the first as an offset from the start of
//!   the bucket, the rest as the change in the gap between polls. A steady
//!   poller costs one byte a sample, and time-shifting a chunk only means
//!   moving it to another bucket;
//! - a value mode: `0..=6` means every value is a whole number of `10^-k`, and
//!   they're stored as changes in that number; `FLOAT` means each is stored as
//!   its bits XORed with the previous value's.
//!
//! The fork prints stats with a few fixed decimals, so nearly every frame fits
//! a decimal mode, where an unchanged value costs one byte. `FLOAT` catches the
//! rest. Either way a value comes back with exactly the bits it went in with.

use std::fmt;

/// Part of the storage format: changing it means a new schema version.
pub const BUCKET_MS: i64 = 300_000;

const FLOAT: u8 = 0xFF;
const MAX_DECIMALS: u8 = 6;
/// Beyond this an f64 can't hold every integer, so decimal modes can't promise exactness.
const MAX_SCALED: f64 = (1u64 << 53) as f64;

pub fn bucket_of(ts_ms: i64) -> i64 {
    ts_ms.div_euclid(BUCKET_MS)
}

#[derive(Debug, PartialEq, Eq)]
pub struct CorruptChunk;

impl fmt::Display for CorruptChunk {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("corrupt stats chunk")
    }
}

impl std::error::Error for CorruptChunk {}

fn put_varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 {
        out.push(v as u8 | 0x80);
        v >>= 7;
    }
    out.push(v as u8);
}

fn zigzag(v: i64) -> u64 {
    ((v << 1) ^ (v >> 63)) as u64
}

fn unzigzag(v: u64) -> i64 {
    (v >> 1) as i64 ^ -((v & 1) as i64)
}

struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl Reader<'_> {
    fn done(&self) -> bool {
        self.pos >= self.data.len()
    }

    fn byte(&mut self) -> Result<u8, CorruptChunk> {
        let b = *self.data.get(self.pos).ok_or(CorruptChunk)?;
        self.pos += 1;
        Ok(b)
    }

    fn varint(&mut self) -> Result<u64, CorruptChunk> {
        let mut v = 0u64;
        for shift in (0..64).step_by(7) {
            let b = self.byte()?;
            v |= u64::from(b & 0x7F) << shift;
            if b & 0x80 == 0 {
                return Ok(v);
            }
        }
        Err(CorruptChunk)
    }

    fn signed(&mut self) -> Result<i64, CorruptChunk> {
        Ok(unzigzag(self.varint()?))
    }
}

/// The fewest decimals that represent every value exactly, if any do.
fn decimals_for(points: &[(i64, f64)]) -> Option<u8> {
    (0..=MAX_DECIMALS).find(|k| {
        let scale = 10f64.powi(i32::from(*k));
        points.iter().all(|(_, v)| {
            let scaled = (v * scale).round();
            scaled.abs() < MAX_SCALED && ((scaled as i64) as f64 / scale).to_bits() == v.to_bits()
        })
    })
}

/// Appends one frame holding `points`, all in `bucket`, with `ts` in whole
/// seconds (see `StatsDb::insert_batch`).
pub fn encode_frame(bucket: i64, points: &[(i64, f64)], out: &mut Vec<u8>) {
    put_varint(out, points.len() as u64);
    let (mut prev_secs, mut prev_gap) = (bucket * (BUCKET_MS / 1000), 0);
    for (ts, _) in points {
        let secs = ts.div_euclid(1000);
        let gap = secs - prev_secs;
        put_varint(out, zigzag(gap - prev_gap));
        (prev_secs, prev_gap) = (secs, gap);
    }
    match decimals_for(points) {
        Some(k) => {
            out.push(k);
            let scale = 10f64.powi(i32::from(k));
            let mut prev = 0i64;
            for (_, v) in points {
                let scaled = (v * scale).round() as i64;
                put_varint(out, zigzag(scaled - prev));
                prev = scaled;
            }
        }
        None => {
            out.push(FLOAT);
            let mut prev = 0u64;
            for (_, v) in points {
                let bits = v.to_bits();
                put_varint(out, (bits ^ prev).swap_bytes());
                prev = bits;
            }
        }
    }
}

/// Every sample in a chunk, in the order they were written.
pub fn decode(bucket: i64, data: &[u8]) -> Result<Vec<(i64, f64)>, CorruptChunk> {
    let mut r = Reader { data, pos: 0 };
    let mut out = Vec::new();
    while !r.done() {
        let count = usize::try_from(r.varint()?).map_err(|_| CorruptChunk)?;
        // A sample takes at least two bytes, so a bad count can't cause a huge allocation.
        if count > data.len() / 2 {
            return Err(CorruptChunk);
        }
        let start = out.len();
        let (mut prev_secs, mut prev_gap) = (bucket * (BUCKET_MS / 1000), 0i64);
        for _ in 0..count {
            let gap = prev_gap.wrapping_add(r.signed()?);
            let secs = prev_secs.wrapping_add(gap);
            out.push((secs.wrapping_mul(1000), 0.0));
            (prev_secs, prev_gap) = (secs, gap);
        }
        let mode = r.byte()?;
        match mode {
            FLOAT => {
                let mut prev = 0u64;
                for point in &mut out[start..] {
                    prev ^= r.varint()?.swap_bytes();
                    point.1 = f64::from_bits(prev);
                }
            }
            k if k <= MAX_DECIMALS => {
                let scale = 10f64.powi(i32::from(k));
                let mut prev = 0i64;
                for point in &mut out[start..] {
                    prev = prev.wrapping_add(r.signed()?);
                    point.1 = prev as f64 / scale;
                }
            }
            _ => return Err(CorruptChunk),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUCKET: i64 = 5_933_333;

    fn at(i: i64) -> i64 {
        (BUCKET * BUCKET_MS) + i * 15_000
    }

    fn points(values: &[f64]) -> Vec<(i64, f64)> {
        values.iter().enumerate().map(|(i, v)| (at(i as i64), *v)).collect()
    }

    fn round_trip(points: &[(i64, f64)]) -> Vec<u8> {
        let mut data = Vec::new();
        encode_frame(BUCKET, points, &mut data);
        let back = decode(BUCKET, &data).unwrap();
        assert_eq!(back.len(), points.len());
        for ((ts, v), (back_ts, back_v)) in points.iter().zip(&back) {
            assert_eq!(ts, back_ts);
            assert_eq!(v.to_bits(), back_v.to_bits(), "{v} came back as {back_v}");
        }
        data
    }

    #[test]
    fn values_come_back_bit_exact() {
        for values in [
            &[0.0, 0.0, 0.0][..],
            &[-38.512, -39.004, -37.75],
            &[0.012, 0.014, 0.011],
            &[1.5, 2.25, -3.125],
            &[4_000_000_000.0, 4_000_004_000.0],
            &[123.456789, 0.000001],
            &[1234.5678901], // too many decimals for a decimal mode
            &[f64::NAN, 1.0],
            &[f64::INFINITY, f64::NEG_INFINITY, 0.0],
            &[-0.0, 0.0],
            &[f64::MAX, f64::MIN_POSITIVE, 5e-324],
            &[9_007_199_254_740_993.0], // past exact integers in an f64
            &[0.1 + 0.2],
            &[u64::MAX as f64],
        ] {
            round_trip(&points(values));
        }
    }

    #[test]
    fn a_nan_keeps_its_payload() {
        let odd_nan = f64::from_bits(0x7FF8_0000_DEAD_BEEF);
        let data = round_trip(&points(&[1.0, odd_nan, 2.0]));
        assert_eq!(decode(BUCKET, &data).unwrap()[1].1.to_bits(), odd_nan.to_bits());
    }

    #[test]
    fn frames_concatenate() {
        let (first, second) = (points(&[1.0, 2.0]), vec![(at(5), f64::NAN), (at(6), 0.125)]);
        let mut data = Vec::new();
        encode_frame(BUCKET, &first, &mut data);
        encode_frame(BUCKET, &second, &mut data);
        let back = decode(BUCKET, &data).unwrap();
        assert_eq!(back.len(), 4);
        assert_eq!(back[..2], first[..]);
        assert_eq!((back[2].0, back[3]), (second[0].0, second[1]));
        assert!(back[2].1.is_nan());
    }

    #[test]
    fn uneven_and_backward_timestamps_survive() {
        let start = BUCKET * BUCKET_MS;
        round_trip(&[(start + 3_000, 1.0), (start + 18_000, 1.0), (start + 16_000, 1.0), (start + 299_000, 1.0)]);
        // A clock stepped back past the bucket start still round-trips.
        round_trip(&[(start - 60_000, 1.0)]);
    }

    #[test]
    fn a_bucket_of_steady_polls_is_small() {
        // 20 polls, the 5-minute bucket at the default poll interval.
        let stuck = round_trip(&points(&[0.0; 20]));
        assert!(stuck.len() <= 44, "stuck counter took {} bytes", stuck.len());

        let moving: Vec<f64> = (0..20).map(|i| -38.0 + f64::from(i * 37 % 200) / 1000.0).collect();
        let gauge = round_trip(&points(&moving));
        assert!(gauge.len() <= 75, "%.3f gauge took {} bytes", gauge.len());
    }

    #[test]
    fn damaged_chunks_are_errors_not_panics() {
        let mut good = Vec::new();
        encode_frame(BUCKET, &points(&[-38.512, -39.004, f64::NAN]), &mut good);
        for len in 1..good.len() {
            assert_eq!(decode(BUCKET, &good[..len]), Err(CorruptChunk), "truncated to {len}");
        }
        assert_eq!(decode(BUCKET, &[0xFF; 32]), Err(CorruptChunk));
        assert_eq!(decode(BUCKET, &[1, 0, 7, 0]), Err(CorruptChunk), "unknown value mode");
        assert_eq!(decode(BUCKET, &[]), Ok(Vec::new()));
        // Arbitrary bytes never panic, whatever they decode to.
        for seed in 0u32..2000 {
            let bytes: Vec<u8> = (0..24).map(|i| (seed.wrapping_mul(2654435761).rotate_left(i) >> 24) as u8).collect();
            let _ = decode(BUCKET, &bytes);
        }
    }
}
