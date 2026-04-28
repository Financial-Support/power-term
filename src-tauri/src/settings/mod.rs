use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default)]
pub struct Settings {
    pub shell: Option<String>,
    pub font_family: String,
    pub font_size: u16,
    pub theme: String,
    pub cursor_blink: bool,
    pub scrollback_lines: u32,
    pub ssh_connect_timeout_secs: u32,
    pub ssh_keepalive_interval_secs: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            shell: None,
            font_family: "SF Mono".to_string(),
            font_size: 14,
            theme: "auto".to_string(),
            cursor_blink: true,
            scrollback_lines: 10_000,
            ssh_connect_timeout_secs: 10,
            ssh_keepalive_interval_secs: 30,
        }
    }
}

#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct SettingsPatch {
    pub shell: Option<Option<String>>,
    pub font_family: Option<String>,
    pub font_size: Option<u16>,
    pub theme: Option<String>,
    pub cursor_blink: Option<bool>,
    pub scrollback_lines: Option<u32>,
    pub ssh_connect_timeout_secs: Option<u32>,
    pub ssh_keepalive_interval_secs: Option<u32>,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("toml encode: {0}")]
    TomlEnc(#[from] toml::ser::Error),
    #[error("config dir not found")]
    NoConfigDir,
}

pub struct SettingsStore {
    path: PathBuf,
    current: parking_lot::Mutex<Settings>,
}

impl SettingsStore {
    pub fn load_from(path: PathBuf) -> Result<Self, SettingsError> {
        let current = read_or_default(&path);
        Ok(Self { path, current: parking_lot::Mutex::new(current) })
    }

    pub fn load_default_path() -> Result<Self, SettingsError> {
        let dir = dirs::config_dir().ok_or(SettingsError::NoConfigDir)?.join("power-term");
        std::fs::create_dir_all(&dir)?;
        Self::load_from(dir.join("config.toml"))
    }

    pub fn get(&self) -> Settings {
        self.current.lock().clone()
    }

    pub fn apply(&self, patch: SettingsPatch) -> Result<Settings, SettingsError> {
        let mut s = self.current.lock();
        if let Some(v) = patch.shell { s.shell = v; }
        if let Some(v) = patch.font_family { s.font_family = v; }
        if let Some(v) = patch.font_size { s.font_size = v; }
        if let Some(v) = patch.theme { s.theme = v; }
        if let Some(v) = patch.cursor_blink { s.cursor_blink = v; }
        if let Some(v) = patch.scrollback_lines { s.scrollback_lines = v; }
        if let Some(v) = patch.ssh_connect_timeout_secs { s.ssh_connect_timeout_secs = v; }
        if let Some(v) = patch.ssh_keepalive_interval_secs { s.ssh_keepalive_interval_secs = v; }
        atomic_write(&self.path, &s)?;
        Ok(s.clone())
    }
}

/// Loads settings from `path`, falling back to defaults if missing or corrupt.
///
/// Recovery contract: if `path` exists but cannot be parsed, the file is renamed
/// to `path.with_extension("toml.bak")`. Only the most recent corrupt file is
/// retained — a previous `.bak` will be silently overwritten. This is by design
/// for a single-user desktop config: the latest bad state is the only one likely
/// to be useful for debugging.
fn read_or_default(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(text) => match toml::from_str::<Settings>(&text) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "settings parse failed; backing up and resetting");
                if let Err(e) = std::fs::rename(path, path.with_extension("toml.bak")) {
                    tracing::warn!(error = %e, "failed to back up corrupt settings file");
                }
                let s = Settings::default();
                if let Err(e) = atomic_write(path, &s) {
                    tracing::warn!(error = %e, "failed to write default settings after recovery");
                }
                s
            }
        },
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let s = Settings::default();
            if let Err(e) = atomic_write(path, &s) {
                tracing::warn!(error = %e, "failed to write initial default settings");
            }
            s
        }
        Err(e) => {
            tracing::error!(error = %e, "settings read failed; using defaults");
            Settings::default()
        }
    }
}

fn atomic_write(path: &Path, settings: &Settings) -> Result<(), SettingsError> {
    let text = toml::to_string_pretty(settings)?;
    let tmp = path.with_extension("toml.tmp");
    std::fs::write(&tmp, text)?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn defaults_when_missing_creates_file() {
        let dir = tmp();
        let path = dir.path().join("config.toml");
        let store = SettingsStore::load_from(path.clone()).unwrap();
        let s = store.get();
        assert_eq!(s, Settings::default());
        assert!(path.exists());
    }

    #[test]
    fn round_trip_apply_persists() {
        let dir = tmp();
        let path = dir.path().join("config.toml");
        let store = SettingsStore::load_from(path.clone()).unwrap();
        let updated = store.apply(SettingsPatch { font_size: Some(18), ..Default::default() }).unwrap();
        assert_eq!(updated.font_size, 18);

        let store2 = SettingsStore::load_from(path).unwrap();
        assert_eq!(store2.get().font_size, 18);
    }

    #[test]
    fn corrupt_file_is_backed_up_and_reset() {
        let dir = tmp();
        let path = dir.path().join("config.toml");
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(b"this is not toml = = = ").unwrap();
        drop(f);

        let store = SettingsStore::load_from(path.clone()).unwrap();
        assert_eq!(store.get(), Settings::default());
        assert!(path.with_extension("toml.bak").exists());
    }
}
