pub const MENU_IDS: [&str; 4] = ["file", "edit", "view", "help"];

pub fn is_command(command: &str) -> bool {
    matches!(
        command,
        "new-task"
            | "undo"
            | "redo"
            | "cut"
            | "copy"
            | "paste"
            | "select-all"
            | "settings"
            | "toggle-sidebar"
            | "toggle-files"
            | "zoom-in"
            | "zoom-out"
            | "zoom-reset"
            | "fullscreen"
    )
}

pub fn next_zoom(current: f64, action: &str) -> f64 {
    match action {
        "zoom-in" => ((current * 10.0).round() + 1.0).min(16.0) / 10.0,
        "zoom-out" => ((current * 10.0).round() - 1.0).max(7.0) / 10.0,
        "zoom-reset" => 1.0,
        _ => current,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn zoom_uses_bounded_steps_and_can_reset() {
        assert_eq!(next_zoom(1.0, "zoom-in"), 1.1);
        assert_eq!(next_zoom(1.0, "zoom-out"), 0.9);
        assert_eq!(next_zoom(1.6, "zoom-in"), 1.6);
        assert_eq!(next_zoom(0.7, "zoom-out"), 0.7);
        assert_eq!(next_zoom(1.5, "zoom-reset"), 1.0);
    }

    #[test]
    fn arbitrary_scripts_and_project_paths_are_not_native_commands() {
        assert!(is_command("paste"));
        assert!(is_command("toggle-files"));
        assert!(!is_command("eval"));
        assert!(!is_command("window.close()"));
        assert!(!is_command("select-project"));
    }
}
