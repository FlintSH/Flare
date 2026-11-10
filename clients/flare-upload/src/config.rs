//! The configuration of the program: the file that Flare generates, and the
//! values that the environment or a flag can replace.
//!
//! The file holds a bearer token and the public key of the account. It
//! holds no private key and the program accepts none (section 10.2).

use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::keys::{AccountPublicKey, X25519PublicKey};
use crate::PROTOCOL_VERSION;

pub const CONFIG_FORMAT: &str = "flare-upload-config";
pub const CONFIG_FORMAT_VERSION: u32 = 1;

pub const ENV_CONFIG: &str = "FLARE_UPLOAD_CONFIG";
pub const ENV_TOKEN: &str = "FLARE_UPLOAD_TOKEN";
pub const ENV_ORIGIN: &str = "FLARE_UPLOAD_ORIGIN";
pub const ENV_PASSWORD: &str = "FLARE_UPLOAD_PASSWORD";

/// Why a configuration cannot be used. No message contains the token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConfigError {
    /// The file is missing or cannot be read.
    Unreadable { path: PathBuf, reason: String },
    /// The file is not the JSON document that Flare generates.
    Malformed(String),
    /// A value is missing or not valid.
    Invalid(String),
    /// The configuration is for a protocol version that this program does
    /// not know (section 1.5.2, rule 3).
    UnknownProtocolVersion(u64),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Unreadable { path, reason } => write!(
                f,
                "cannot read the configuration file {}: {reason}. Download one from Flare (Profile, Upload tools) or pass --config",
                path.display()
            ),
            Self::Malformed(reason) => write!(f, "the configuration file is not valid: {reason}"),
            Self::Invalid(reason) => write!(f, "the configuration is not valid: {reason}"),
            Self::UnknownProtocolVersion(version) => write!(
                f,
                "the configuration is for protocol version {version}, which this flare-upload does not know. Update flare-upload"
            ),
        }
    }
}

impl std::error::Error for ConfigError {}

/// A bearer token. It does not print, and it is erased when it is dropped.
#[derive(Clone, Zeroize, ZeroizeOnDrop)]
pub struct Token(String);

impl Token {
    pub fn new(text: &str) -> Result<Self, ConfigError> {
        let text = text.trim();
        // A token goes into a header, so it must be visible ASCII.
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_graphic()) {
            return Err(ConfigError::Invalid(
                "the token is empty or has characters a token cannot have".into(),
            ));
        }
        Ok(Self(text.to_owned()))
    }

    /// The value of the `Authorization` header.
    pub fn authorization(&self) -> String {
        format!("Bearer {}", self.0)
    }

    /// The token text. The caller must not print it.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Token {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Token(secret)")
    }
}

/// The address of a Flare server: `https://host`, with an optional port and
/// base path. `http://` is accepted for the local machine only, because a
/// bearer token must not cross a network without TLS.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Origin {
    /// `scheme://host[:port]`.
    root: String,
    /// The base path: empty, or `/path` without a slash at the end.
    base_path: String,
}

fn is_loopback_host(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.eq_ignore_ascii_case("localhost") || host.to_ascii_lowercase().ends_with(".localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>()
        .map(|address| address.is_loopback())
        .unwrap_or(false)
}

impl Origin {
    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        let invalid = |reason: &str| ConfigError::Invalid(format!("the origin {reason}"));
        let text = text.trim();
        let (scheme, rest) = text
            .split_once("://")
            .ok_or_else(|| invalid("must start with https://"))?;
        let scheme = scheme.to_ascii_lowercase();
        if rest.contains(['?', '#', '@', ' ', '\\']) {
            return Err(invalid(
                "must not have a query, a fragment, a user name or spaces",
            ));
        }
        let (authority, path) = match rest.find('/') {
            Some(index) => rest.split_at(index),
            None => (rest, ""),
        };
        if authority.is_empty() {
            return Err(invalid("has no host"));
        }
        // `[::1]:3000` and `host:3000`: the host is the part before the port.
        let host = if authority.starts_with('[') {
            authority
                .split_once(']')
                .map(|(host, _)| host)
                .ok_or_else(|| invalid("has an IPv6 address without ]"))?
        } else {
            authority
                .rsplit_once(':')
                .map_or(authority, |(host, _)| host)
        };
        match scheme.as_str() {
            "https" => {}
            "http" if is_loopback_host(host) => {}
            "http" => {
                return Err(invalid(
                    "uses http://, which is accepted for localhost only. Use https://",
                ))
            }
            _ => return Err(invalid("must start with https://")),
        }
        let base_path = path.trim_end_matches('/');
        if base_path.contains("//") || base_path.split('/').any(|segment| segment == "..") {
            return Err(invalid("has a base path that is not valid"));
        }
        Ok(Self {
            root: format!("{scheme}://{}", authority.to_ascii_lowercase()),
            base_path: base_path.to_owned(),
        })
    }

    /// The address of an API path such as `/api/files`.
    pub fn url(&self, api_path: &str) -> String {
        format!("{}{}{api_path}", self.root, self.base_path)
    }

    /// `scheme://host[:port]`: where a share link starts.
    pub fn root(&self) -> &str {
        &self.root
    }
}

impl fmt::Display for Origin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}{}", self.root, self.base_path)
    }
}

/// Whether the client encrypts (section 11.2). It must agree with the
/// `encryption` setting of the upload profile; the server checks.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EncryptionMode {
    Encrypted,
    Plain,
}

impl EncryptionMode {
    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        match text {
            "encrypted" => Ok(Self::Encrypted),
            "plain" => Ok(Self::Plain),
            other => Err(ConfigError::Invalid(format!(
                "the encryption mode \"{other}\" is not \"encrypted\" or \"plain\""
            ))),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum Visibility {
    #[serde(rename = "PUBLIC")]
    Public,
    #[serde(rename = "PRIVATE")]
    Private,
}

impl Visibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Public => "PUBLIC",
            Self::Private => "PRIVATE",
        }
    }

    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        match text.to_ascii_uppercase().as_str() {
            "PUBLIC" => Ok(Self::Public),
            "PRIVATE" => Ok(Self::Private),
            _ => Err(ConfigError::Invalid(format!(
                "the visibility \"{text}\" is not \"public\" or \"private\""
            ))),
        }
    }
}

/// When the server removes a file, as an upload profile names it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum Expiration {
    #[serde(rename = "DISABLED")]
    Disabled,
    #[serde(rename = "HOUR")]
    Hour,
    #[serde(rename = "DAY")]
    Day,
    #[serde(rename = "WEEK")]
    Week,
    #[serde(rename = "MONTH")]
    Month,
}

impl Expiration {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Disabled => "DISABLED",
            Self::Hour => "HOUR",
            Self::Day => "DAY",
            Self::Week => "WEEK",
            Self::Month => "MONTH",
        }
    }

    pub fn parse(text: &str) -> Result<Self, ConfigError> {
        match text.to_ascii_uppercase().as_str() {
            "DISABLED" | "NEVER" => Ok(Self::Disabled),
            "HOUR" => Ok(Self::Hour),
            "DAY" => Ok(Self::Day),
            "WEEK" => Ok(Self::Week),
            "MONTH" => Ok(Self::Month),
            _ => Err(ConfigError::Invalid(format!(
                "the expiration \"{text}\" is not never, hour, day, week or month"
            ))),
        }
    }
}

/// The JSON document. Fields that this version does not know are ignored,
/// so a file from a later Flare still loads; `protocol_version` says when
/// the program must stop.
#[derive(Deserialize)]
struct ConfigFile {
    format: Option<String>,
    version: Option<u64>,
    origin: Option<String>,
    token: Option<String>,
    protocol_version: Option<u64>,
    account_public_key: Option<String>,
    profile_id: Option<String>,
    encryption: Option<String>,
    folder_id: Option<String>,
    folder_public_key: Option<String>,
    visibility: Option<Visibility>,
    expiration: Option<Expiration>,
}

/// Values from flags and the environment. Each replaces the value of the file.
#[derive(Default, Debug)]
pub struct Overrides {
    pub origin: Option<String>,
    pub token: Option<String>,
    pub mode: Option<String>,
    pub visibility: Option<String>,
    pub expiration: Option<String>,
}

/// What an encrypted upload needs besides the address and the token.
#[derive(Clone, Debug)]
pub struct EncryptionConfig {
    /// The pinned key of the account. It comes from the configuration, never
    /// from the server (section 10.2).
    pub account_public_key: AccountPublicKey,
    /// `folder_public_key`, if the uploads go into a folder (section 9.4.4).
    pub folder_public_key: Option<X25519PublicKey>,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub origin: Origin,
    pub token: Token,
    pub mode: EncryptionMode,
    /// Present in encrypted mode.
    pub encryption: Option<EncryptionConfig>,
    pub profile_id: Option<String>,
    pub folder_id: Option<String>,
    pub visibility: Option<Visibility>,
    pub expiration: Option<Expiration>,
}

fn identifier(name: &str, value: Option<String>) -> Result<Option<String>, ConfigError> {
    match value {
        None => Ok(None),
        Some(text) if text.is_empty() => Ok(None),
        Some(text)
            if text.len() <= 128
                && text
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-') =>
        {
            Ok(Some(text))
        }
        Some(_) => Err(ConfigError::Invalid(format!(
            "{name} has characters an identifier cannot have"
        ))),
    }
}

impl Config {
    /// Reads the JSON text of a configuration file and applies the overrides.
    pub fn from_json(text: &str, overrides: &Overrides) -> Result<Self, ConfigError> {
        let file: ConfigFile = serde_json::from_str(text).map_err(|error| {
            // serde_json reports a position and a category, never the content.
            ConfigError::Malformed(format!(
                "line {}, column {}: not the expected JSON",
                error.line(),
                error.column()
            ))
        })?;
        if let Some(format) = &file.format {
            if format != CONFIG_FORMAT {
                return Err(ConfigError::Malformed(format!(
                    "the format is \"{format}\", not \"{CONFIG_FORMAT}\""
                )));
            }
        }
        if let Some(version) = file.version {
            if version != u64::from(CONFIG_FORMAT_VERSION) {
                return Err(ConfigError::Malformed(format!(
                    "the file has version {version}. This flare-upload reads version {CONFIG_FORMAT_VERSION}. Update flare-upload"
                )));
            }
        }
        let origin = overrides
            .origin
            .as_deref()
            .or(file.origin.as_deref())
            .ok_or_else(|| ConfigError::Invalid("the origin is missing".into()))?;
        let origin = Origin::parse(origin)?;
        let token = overrides
            .token
            .as_deref()
            .or(file.token.as_deref())
            .ok_or_else(|| {
                ConfigError::Invalid(format!(
                    "the token is missing. Put it in the file or in {ENV_TOKEN}"
                ))
            })?;
        let token = Token::new(token)?;
        let mode = match overrides.mode.as_deref().or(file.encryption.as_deref()) {
            Some(text) => EncryptionMode::parse(text)?,
            // Encryption is the default (section 11.1).
            None => EncryptionMode::Encrypted,
        };
        let visibility = match &overrides.visibility {
            Some(text) => Some(Visibility::parse(text)?),
            None => file.visibility,
        };
        let expiration = match &overrides.expiration {
            Some(text) => Some(Expiration::parse(text)?),
            None => file.expiration,
        };
        let folder_id = identifier("folder_id", file.folder_id)?;
        let encryption = match mode {
            EncryptionMode::Plain => None,
            EncryptionMode::Encrypted => {
                let version = file
                    .protocol_version
                    .ok_or_else(|| ConfigError::Invalid("protocol_version is missing".into()))?;
                if version != u64::from(PROTOCOL_VERSION) {
                    return Err(ConfigError::UnknownProtocolVersion(version));
                }
                let key = file.account_public_key.as_deref().ok_or_else(|| {
                    ConfigError::Invalid(
                        "account_public_key is missing. An encrypted upload needs the public key of the account"
                            .into(),
                    )
                })?;
                let account_public_key = AccountPublicKey::from_base64url(key).map_err(|_| {
                    ConfigError::Invalid("account_public_key is not a valid public key".into())
                })?;
                let folder_public_key = match file.folder_public_key.as_deref() {
                    None | Some("") => None,
                    Some(key) => Some(X25519PublicKey::from_base64url(key).map_err(|_| {
                        ConfigError::Invalid("folder_public_key is not a valid public key".into())
                    })?),
                };
                if folder_public_key.is_some() {
                    if folder_id.is_none() {
                        return Err(ConfigError::Invalid(
                            "folder_public_key needs folder_id".into(),
                        ));
                    }
                    // A private file must not have a folder stanza (section
                    // 8.4.3), so the program must know the visibility.
                    if visibility.is_none() {
                        return Err(ConfigError::Invalid(
                            "folder_public_key needs visibility".into(),
                        ));
                    }
                }
                Some(EncryptionConfig {
                    account_public_key,
                    folder_public_key,
                })
            }
        };
        Ok(Self {
            origin,
            token,
            mode,
            encryption,
            profile_id: identifier("profile_id", file.profile_id)?,
            folder_id,
            visibility,
            expiration,
        })
    }

    /// Reads a configuration file.
    pub fn load(path: &Path, overrides: &Overrides) -> Result<Self, ConfigError> {
        let text = std::fs::read_to_string(path).map_err(|error| ConfigError::Unreadable {
            path: path.to_owned(),
            reason: error.kind().to_string(),
        })?;
        Self::from_json(&text, overrides)
    }
}

/// The directory of the default configuration file, from the environment
/// of each operating system. `None` if the environment names no home.
pub fn default_config_dir(os: &str, env: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let non_empty = |name: &str| env(name).filter(|value| !value.is_empty());
    let base = match os {
        "windows" => non_empty("APPDATA").map(PathBuf::from),
        "macos" => non_empty("HOME").map(|home| {
            PathBuf::from(home)
                .join("Library")
                .join("Application Support")
        }),
        _ => non_empty("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| non_empty("HOME").map(|home| PathBuf::from(home).join(".config"))),
    }?;
    Some(base.join("flare-upload"))
}

/// The default configuration file of this machine:
///
/// - Linux and BSD: `$XDG_CONFIG_HOME/flare-upload/config.json`, or
///   `~/.config/flare-upload/config.json`
/// - macOS: `~/Library/Application Support/flare-upload/config.json`
/// - Windows: `%APPDATA%\flare-upload\config.json`
pub fn default_config_path() -> Option<PathBuf> {
    default_config_dir(std::env::consts::OS, &|name| std::env::var(name).ok())
        .map(|directory| directory.join("config.json"))
}

/// A reason to warn about the file, or `None`. On Unix a configuration that
/// other users can read gives them the token.
pub fn permission_warning(path: &Path) -> Option<String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path).ok()?.permissions().mode();
        if mode & 0o077 != 0 {
            return Some(format!(
                "{} can be read by other users of this machine. Run: chmod 600 \"{}\"",
                path.display(),
                path.display()
            ));
        }
        None
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The Ed25519 base point: a valid account public key for tests.
    const ACCOUNT_KEY: &str = "WGZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY";
    // The X25519 base point (u = 9).
    const FOLDER_KEY: &str = "CQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

    fn encrypted_json(extra: &str) -> String {
        format!(
            r#"{{"format":"flare-upload-config","version":1,"origin":"https://flare.example","token":"flr_test","protocol_version":1,"account_public_key":"{ACCOUNT_KEY}","profile_id":"prof_1","encryption":"encrypted"{extra}}}"#
        )
    }

    #[test]
    fn reads_an_encrypted_configuration() {
        let config = Config::from_json(&encrypted_json(""), &Overrides::default()).unwrap();
        assert_eq!(config.origin.to_string(), "https://flare.example");
        assert_eq!(
            config.origin.url("/api/files"),
            "https://flare.example/api/files"
        );
        assert_eq!(config.mode, EncryptionMode::Encrypted);
        assert_eq!(config.profile_id.as_deref(), Some("prof_1"));
        assert_eq!(config.token.authorization(), "Bearer flr_test");
        let encryption = config.encryption.unwrap();
        assert_eq!(encryption.account_public_key.to_base64url(), ACCOUNT_KEY);
        assert!(encryption.folder_public_key.is_none());
    }

    #[test]
    fn reads_a_plain_configuration_without_keys() {
        let json = r#"{"origin":"https://flare.example/","token":"flr_plain","encryption":"plain","visibility":"PRIVATE","expiration":"WEEK"}"#;
        let config = Config::from_json(json, &Overrides::default()).unwrap();
        assert_eq!(config.mode, EncryptionMode::Plain);
        assert!(config.encryption.is_none());
        assert_eq!(config.visibility, Some(Visibility::Private));
        assert_eq!(config.expiration, Some(Expiration::Week));
    }

    #[test]
    fn encryption_is_the_default_mode_and_needs_the_key() {
        let json = r#"{"origin":"https://flare.example","token":"flr_x","protocol_version":1}"#;
        let error = Config::from_json(json, &Overrides::default()).unwrap_err();
        assert!(error.to_string().contains("account_public_key is missing"));
    }

    #[test]
    fn refuses_a_protocol_version_it_does_not_know() {
        let json = encrypted_json("").replace("\"protocol_version\":1", "\"protocol_version\":2");
        assert_eq!(
            Config::from_json(&json, &Overrides::default()).unwrap_err(),
            ConfigError::UnknownProtocolVersion(2)
        );
        // A plain upload uses no protocol version.
        let plain = json.replace("\"encrypted\"", "\"plain\"");
        assert!(Config::from_json(&plain, &Overrides::default()).is_ok());
    }

    #[test]
    fn refuses_a_key_that_is_not_valid() {
        // y = 1 has no X25519 form.
        let json =
            encrypted_json("").replace(ACCOUNT_KEY, "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        let error = Config::from_json(&json, &Overrides::default()).unwrap_err();
        assert!(error
            .to_string()
            .contains("account_public_key is not a valid"));
        let short = encrypted_json("").replace(ACCOUNT_KEY, "AAAA");
        assert!(Config::from_json(&short, &Overrides::default()).is_err());
    }

    #[test]
    fn a_folder_key_needs_the_folder_and_the_visibility() {
        let key = format!(r#","folder_public_key":"{FOLDER_KEY}""#);
        assert!(Config::from_json(&encrypted_json(&key), &Overrides::default()).is_err());
        let with_folder = format!(r#"{key},"folder_id":"folder_1""#);
        assert!(Config::from_json(&encrypted_json(&with_folder), &Overrides::default()).is_err());
        let complete = format!(r#"{with_folder},"visibility":"PUBLIC""#);
        let config = Config::from_json(&encrypted_json(&complete), &Overrides::default()).unwrap();
        assert!(config.encryption.unwrap().folder_public_key.is_some());
        assert_eq!(config.folder_id.as_deref(), Some("folder_1"));
    }

    #[test]
    fn overrides_replace_the_file() {
        let overrides = Overrides {
            origin: Some("http://localhost:3190".into()),
            token: Some("flr_env".into()),
            mode: Some("plain".into()),
            visibility: Some("private".into()),
            expiration: Some("day".into()),
        };
        let config = Config::from_json(&encrypted_json(""), &overrides).unwrap();
        assert_eq!(config.origin.to_string(), "http://localhost:3190");
        assert_eq!(config.token.expose(), "flr_env");
        assert_eq!(config.mode, EncryptionMode::Plain);
        assert_eq!(config.visibility, Some(Visibility::Private));
        assert_eq!(config.expiration, Some(Expiration::Day));
    }

    #[test]
    fn origins() {
        for good in [
            "https://flare.example",
            "https://flare.example/",
            "https://Flare.Example:8443/base/",
            "http://localhost:3000",
            "http://127.0.0.1:3190",
            "http://[::1]:3000",
            "http://dev.localhost",
        ] {
            assert!(Origin::parse(good).is_ok(), "{good}");
        }
        for bad in [
            "http://flare.example",
            "http://192.168.1.10:3000",
            "ftp://flare.example",
            "flare.example",
            "https://",
            "https://user@flare.example",
            "https://flare.example/?a=b",
            "https://flare.example/#x",
            "https://flare.example/a/../b",
        ] {
            assert!(Origin::parse(bad).is_err(), "{bad}");
        }
        let origin = Origin::parse("https://Flare.Example:8443/base/").unwrap();
        assert_eq!(origin.root(), "https://flare.example:8443");
        assert_eq!(
            origin.url("/api/files"),
            "https://flare.example:8443/base/api/files"
        );
    }

    #[test]
    fn errors_and_debug_output_do_not_show_the_token() {
        let json = encrypted_json("").replace("flr_test", "flr_secret value");
        let error = Config::from_json(&json, &Overrides::default()).unwrap_err();
        assert!(!error.to_string().contains("flr_secret"));
        let config = Config::from_json(&encrypted_json(""), &Overrides::default()).unwrap();
        assert!(!format!("{config:?}").contains("flr_test"));
        let malformed = Config::from_json("{\"token\": \"flr_leak\", oops", &Overrides::default());
        assert!(!malformed.unwrap_err().to_string().contains("flr_leak"));
    }

    #[test]
    fn default_directories() {
        let env = |pairs: &'static [(&'static str, &'static str)]| {
            move |name: &str| {
                pairs
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| (*value).to_owned())
            }
        };
        assert_eq!(
            default_config_dir("linux", &env(&[("HOME", "/home/a")])),
            Some(PathBuf::from("/home/a/.config/flare-upload"))
        );
        assert_eq!(
            default_config_dir(
                "linux",
                &env(&[("HOME", "/home/a"), ("XDG_CONFIG_HOME", "/x")])
            ),
            Some(PathBuf::from("/x/flare-upload"))
        );
        assert_eq!(
            default_config_dir("macos", &env(&[("HOME", "/Users/a")])),
            Some(PathBuf::from(
                "/Users/a/Library/Application Support/flare-upload"
            ))
        );
        assert_eq!(
            default_config_dir(
                "windows",
                &env(&[("APPDATA", "C:\\Users\\a\\AppData\\Roaming")])
            ),
            Some(PathBuf::from("C:\\Users\\a\\AppData\\Roaming").join("flare-upload"))
        );
        assert_eq!(default_config_dir("linux", &env(&[])), None);
    }
}
