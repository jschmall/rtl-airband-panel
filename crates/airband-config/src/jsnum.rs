//! Number formatting/rounding that reproduces JavaScript's `Number`
//! semantics exactly, so the Rust serializer emits byte-identical text to
//! the original TypeScript implementation (backend/parser).

/// Equivalent of JavaScript's `String(n)` / `Number.prototype.toString()`.
pub fn to_js_string(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if x == 0.0 {
        return "0".to_string();
    }

    // Rust's LowerExp without a precision emits the shortest digit string
    // that round-trips, which is exactly the digit string ECMAScript's
    // Number::toString specifies; only the layout differs.
    let formatted = format!("{:e}", x.abs());
    let (mantissa, exp) = formatted.split_once('e').expect("LowerExp always has an exponent");
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let exp: i32 = exp.parse().expect("LowerExp exponent is an integer");
    let k = digits.len() as i32;
    let n = exp + 1;

    let mut out = String::new();
    if x < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        out.extend(std::iter::repeat_n('0', (n - k) as usize));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        out.extend(std::iter::repeat_n('0', (-n) as usize));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        out.push('e');
        out.push(if n > 0 { '+' } else { '-' });
        out.push_str(&(n - 1).abs().to_string());
    }
    out
}

/// Equivalent of JavaScript's `Math.round` (ties round toward +infinity,
/// unlike `f64::round`, which rounds ties away from zero).
pub fn js_round(x: f64) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let floor = x.floor();
    if x - floor >= 0.5 { floor + 1.0 } else { floor }
}

/// Equivalent of JavaScript's `Number.isInteger`.
pub fn is_integer(x: f64) -> bool {
    x.is_finite() && x.fract() == 0.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_like_javascript() {
        let cases: &[(f64, &str)] = &[
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (-1.5, "-1.5"),
            (151_780_000.0, "151780000"),
            (136.5, "136.5"),
            (0.1, "0.1"),
            (0.000001, "0.000001"),
            (0.0000001, "1e-7"),
            (1.5e-10, "1.5e-10"),
            (1e21, "1e+21"),
            (123456789012345680000.0, "123456789012345680000"),
            (1.2345e25, "1.2345e+25"),
            (100.25, "100.25"),
            (f64::NAN, "NaN"),
            (f64::INFINITY, "Infinity"),
        ];
        for (x, want) in cases {
            assert_eq!(to_js_string(*x), *want, "formatting {x:?}");
        }
    }

    #[test]
    fn rounds_like_javascript() {
        assert_eq!(js_round(2.5), 3.0);
        assert_eq!(js_round(-2.5), -2.0);
        assert_eq!(js_round(-2.6), -3.0);
        assert_eq!(js_round(151.78 * 1e6), 151_780_000.0);
    }
}
