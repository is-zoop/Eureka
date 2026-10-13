pub const TITLEBAR_HEIGHT: f64 = 32.0;

/// Keep the last usable WebView bounds while Windows minimizes the window.
/// Applying a zero-width native resize would trigger the frontend's mobile
/// breakpoint and permanently close its sidebar, even after restoring.
pub fn content_size(width: f64, height: f64, minimized: bool) -> Option<(f64, f64)> {
    if minimized
        || !width.is_finite()
        || !height.is_finite()
        || width <= 0.0
        || height <= TITLEBAR_HEIGHT
    {
        return None;
    }
    Some((width, height - TITLEBAR_HEIGHT))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minimize_restore_keeps_the_last_desktop_viewport() {
        let mut bounds = content_size(1200.0, 800.0, false).unwrap();
        for (width, height, minimized) in [
            (0.0, 0.0, false), // Zero size can precede the minimized flag.
            (0.0, 0.0, true),
            (160.0, 32.0, true),
            (1200.0, 800.0, true),
        ] {
            if let Some(next) = content_size(width, height, minimized) {
                bounds = next;
            }
            assert_eq!(bounds, (1200.0, 768.0));
        }
        bounds = content_size(1200.0, 800.0, false).unwrap();
        assert_eq!(bounds, (1200.0, 768.0));
        assert_eq!(content_size(1440.0, 960.0, false), Some((1440.0, 928.0)));
    }

    #[test]
    fn invalid_bounds_do_not_reach_webview() {
        for (width, height) in [
            (0.0, 800.0),
            (-1.0, 800.0),
            (1200.0, 0.0),
            (1200.0, TITLEBAR_HEIGHT),
            (f64::NAN, 800.0),
            (1200.0, f64::INFINITY),
        ] {
            assert_eq!(content_size(width, height, false), None);
        }
    }
}
