use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct WindowPreferences {
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
    pub theme: String,
}

impl Default for WindowPreferences {
    fn default() -> Self {
        Self {
            width: 1440.0,
            height: 960.0,
            maximized: false,
            theme: "auto".into(),
        }
    }
}

impl WindowPreferences {
    pub fn read(path: &Path) -> Self {
        fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Self>(&bytes).ok())
            .map(Self::validated)
            .unwrap_or_default()
    }

    pub fn validated(mut self) -> Self {
        let defaults = Self::default();
        if !self.width.is_finite() || self.width < 960.0 || self.width > 16384.0 {
            self.width = defaults.width;
        }
        if !self.height.is_finite() || self.height < 640.0 || self.height > 16384.0 {
            self.height = defaults.height;
        }
        if !matches!(self.theme.as_str(), "auto" | "light" | "dark") {
            self.theme = "auto".into();
        }
        self
    }

    pub fn record_size(&mut self, width: f64, height: f64, maximized: bool, minimized: bool) {
        if minimized {
            return;
        }
        self.maximized = maximized;
        if !maximized
            && width.is_finite()
            && height.is_finite()
            && width >= 960.0
            && height >= 640.0
        {
            self.width = width;
            self.height = height;
        }
    }

    pub fn write(&self, path: &Path) -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, serde_json::to_vec_pretty(self)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maximizing_and_minimizing_preserve_the_normal_size() {
        let mut preferences = WindowPreferences::default();
        preferences.record_size(1100.0, 760.0, false, false);
        preferences.record_size(1920.0, 1080.0, true, false);
        assert_eq!((preferences.width, preferences.height), (1100.0, 760.0));
        assert!(preferences.maximized);
        preferences.record_size(0.0, 0.0, false, true);
        assert!(preferences.maximized);
        preferences.record_size(1100.0, 760.0, false, false);
        assert!(!preferences.maximized);
    }

    #[test]
    fn damaged_preferences_fall_back_to_usable_values() {
        let preferences = WindowPreferences {
            width: f64::NAN,
            height: -1.0,
            theme: "invalid".into(),
            ..WindowPreferences::default()
        }
        .validated();
        assert_eq!((preferences.width, preferences.height), (1440.0, 960.0));
        assert_eq!(preferences.theme, "auto");
    }

    #[test]
    fn previous_partial_preferences_and_json_round_trip_remain_readable() {
        let preferences: WindowPreferences =
            serde_json::from_str(r#"{"width":1200,"height":800,"maximized":true}"#).unwrap();
        let restored: WindowPreferences =
            serde_json::from_slice(&serde_json::to_vec(&preferences).unwrap()).unwrap();
        assert_eq!((restored.width, restored.height), (1200.0, 800.0));
        assert!(restored.maximized);
        assert_eq!(restored.theme, "auto");
    }
}
