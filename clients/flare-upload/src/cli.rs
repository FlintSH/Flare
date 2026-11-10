//! The command line: arguments, the sequence of one run, and what goes to
//! standard output and standard error.
//!
//! Standard output gets the links and nothing else, so a tool can read it.
//! The link of an encrypted file contains its key after `#`; that is the
//! one place where this program prints a key. Warnings and errors go to
//! standard error and contain no key, token or password.

use std::ffi::OsString;
use std::fs::File;
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

use serde_json::json;
use zeroize::Zeroizing;

use crate::clipboard;
use crate::config::{
    default_config_path, permission_warning, Config, ConfigError, EncryptionMode, Overrides,
    ENV_CONFIG, ENV_ORIGIN, ENV_PASSWORD, ENV_TOKEN,
};
use crate::kat::run_self_test;
use crate::mime::mime_type_of;
use crate::password::password_weakness;
use crate::upload::{Source, UploadError, Uploaded, Uploader};

pub const EXIT_OK: u8 = 0;
/// An upload failed: the file, the network or the server.
pub const EXIT_FAILED: u8 = 1;
/// The arguments or the configuration are not valid.
pub const EXIT_USAGE: u8 = 2;

/// Standard input is held in memory, so it has a limit.
const STDIN_MAX_BYTES: u64 = 512 * 1024 * 1024;

pub const HELP: &str = "\
flare-upload: encrypt a file on this machine and upload it to Flare

Usage: flare-upload [options] <file>...
       flare-upload --self-test

Each link is printed on its own line. A file name of - reads standard input.

Options:
  -c, --config <path>      Configuration file from Flare (Profile, Upload tools).
                           Default: the flare-upload directory of your user
                           configuration, file config.json
      --origin <url>       Server address, in place of the one in the file
      --token-file <path>  Read the token from this file, in place of the one
                           in the configuration
      --mode <mode>        encrypted or plain. It must agree with the upload
                           profile of the token
      --visibility <v>     public or private
      --expiration <e>     never, hour, day, week or month
      --name <name>        Name of the upload, for one file or standard input
      --password           Protect the link with a password. The program asks
                           for it, or reads FLARE_UPLOAD_PASSWORD
      --copy               Copy the links to the clipboard
      --open               Open the first link in the browser
      --json               Print one JSON object in place of the links
  -q, --quiet              No warnings on standard error
      --self-test          Check the cryptography of this build and exit
  -h, --help               Show this text
  -V, --version            Show the version

Environment:
  FLARE_UPLOAD_CONFIG      Configuration file, if --config is not given
  FLARE_UPLOAD_TOKEN       Token, in place of the one in the file
  FLARE_UPLOAD_ORIGIN      Server address, in place of the one in the file
  FLARE_UPLOAD_PASSWORD    Password for --password

Exit codes:
  0  uploaded
  1  an upload failed
  2  the arguments or the configuration are not valid
  3  the configuration is old: download a new one from Flare
  4  the protocol version is not accepted: update flare-upload
  5  the server refused the upload because of a setting

The program has no private key and takes none. In encrypted mode the server
gets ciphertext only; the link on standard output is the key to the file.
";

/// What the run needs from the machine. The tests replace it.
pub trait System {
    fn env(&self, name: &str) -> Option<String>;
    fn copy(&mut self, text: &str) -> Result<&'static str, String>;
    fn open(&mut self, url: &str) -> Result<(), String>;
    /// Asks for a password two times without echo.
    fn prompt_password(&mut self) -> io::Result<Zeroizing<String>>;
    fn stdin(&mut self) -> Box<dyn Read>;
    fn default_config_path(&self) -> Option<PathBuf>;
}

/// The real machine.
pub struct Machine;

impl System for Machine {
    fn env(&self, name: &str) -> Option<String> {
        std::env::var(name).ok()
    }

    fn copy(&mut self, text: &str) -> Result<&'static str, String> {
        clipboard::copy_to_clipboard(text)
    }

    fn open(&mut self, url: &str) -> Result<(), String> {
        clipboard::open_in_browser(url)
    }

    fn prompt_password(&mut self) -> io::Result<Zeroizing<String>> {
        let first = Zeroizing::new(rpassword::prompt_password("Password for the link: ")?);
        let second = Zeroizing::new(rpassword::prompt_password("Repeat the password: ")?);
        if *first != *second {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "the two passwords are different",
            ));
        }
        Ok(first)
    }

    fn stdin(&mut self) -> Box<dyn Read> {
        Box::new(io::stdin())
    }

    fn default_config_path(&self) -> Option<PathBuf> {
        default_config_path()
    }
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Arguments {
    pub files: Vec<PathBuf>,
    pub config: Option<PathBuf>,
    pub origin: Option<String>,
    pub token_file: Option<PathBuf>,
    pub mode: Option<String>,
    pub visibility: Option<String>,
    pub expiration: Option<String>,
    pub name: Option<String>,
    pub password: bool,
    pub copy: bool,
    pub open: bool,
    pub json: bool,
    pub quiet: bool,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Command {
    Upload(Arguments),
    SelfTest,
    Help,
    Version,
}

fn text(value: OsString, option: &str) -> Result<String, String> {
    value
        .into_string()
        .map_err(|_| format!("the value of {option} is not valid text"))
}

fn value(parser: &mut lexopt::Parser, option: &str) -> Result<OsString, String> {
    parser
        .value()
        .map_err(|_| format!("{option} needs a value"))
}

/// Reads the arguments, without the program name.
pub fn parse_arguments(arguments: Vec<OsString>) -> Result<Command, String> {
    use lexopt::prelude::*;
    let mut parser = lexopt::Parser::from_args(arguments);
    let mut parsed = Arguments::default();
    let mut self_test = false;
    while let Some(argument) = parser.next().map_err(|error| error.to_string())? {
        match argument {
            Short('h') | Long("help") => return Ok(Command::Help),
            Short('V') | Long("version") => return Ok(Command::Version),
            Long("self-test") => self_test = true,
            Short('c') | Long("config") => parsed.config = Some(value(&mut parser, "--config")?.into()),
            Long("origin") => parsed.origin = Some(text(value(&mut parser, "--origin")?, "--origin")?),
            Long("token-file") => parsed.token_file = Some(value(&mut parser, "--token-file")?.into()),
            Long("mode") => parsed.mode = Some(text(value(&mut parser, "--mode")?, "--mode")?),
            Long("visibility") => {
                parsed.visibility = Some(text(value(&mut parser, "--visibility")?, "--visibility")?)
            }
            Long("expiration") => {
                parsed.expiration = Some(text(value(&mut parser, "--expiration")?, "--expiration")?)
            }
            Long("name") => parsed.name = Some(text(value(&mut parser, "--name")?, "--name")?),
            Long("password") => parsed.password = true,
            Long("copy") => parsed.copy = true,
            Long("open") => parsed.open = true,
            Long("json") => parsed.json = true,
            Short('q') | Long("quiet") => parsed.quiet = true,
            // A token in an argument is visible to each user of the machine.
            Long("token") => {
                return Err(format!(
                    "--token is not an option, because other users of this machine can read arguments. Use the configuration file, {ENV_TOKEN} or --token-file"
                ))
            }
            Value(file) => parsed.files.push(file.into()),
            other => return Err(other.unexpected().to_string()),
        }
    }
    if self_test {
        return Ok(Command::SelfTest);
    }
    if parsed.files.is_empty() {
        return Err("no file given. Usage: flare-upload [options] <file>...".into());
    }
    if parsed.name.is_some() && parsed.files.len() != 1 {
        return Err("--name works with one file".into());
    }
    Ok(Command::Upload(parsed))
}

/// The file name that the owner sees: the last part of the path.
fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "upload.bin".to_owned())
}

fn open_source(
    path: &Path,
    name: Option<&str>,
    system: &mut dyn System,
) -> Result<Source<Box<dyn Read>>, UploadError> {
    if path.as_os_str() == "-" {
        let mut content = Vec::new();
        system
            .stdin()
            .take(STDIN_MAX_BYTES + 1)
            .read_to_end(&mut content)
            .map_err(|error| UploadError::File(format!("standard input: {}", error.kind())))?;
        if content.len() as u64 > STDIN_MAX_BYTES {
            return Err(UploadError::File(
                "standard input has more than 512 MiB. Save it to a file and upload the file"
                    .into(),
            ));
        }
        let name = name.unwrap_or("upload.bin").to_owned();
        return Ok(Source {
            mime_type: mime_type_of(&name).to_owned(),
            name,
            length: content.len() as u64,
            reader: Box::new(io::Cursor::new(content)),
        });
    }
    let unreadable =
        |error: io::Error| UploadError::File(format!("{}: {}", path.display(), error.kind()));
    let file = File::open(path).map_err(unreadable)?;
    let metadata = file.metadata().map_err(unreadable)?;
    if !metadata.is_file() {
        return Err(UploadError::File(format!(
            "{} is not a file",
            path.display()
        )));
    }
    let name = name
        .map(str::to_owned)
        .unwrap_or_else(|| display_name(path));
    Ok(Source {
        mime_type: mime_type_of(&name).to_owned(),
        name,
        length: metadata.len(),
        reader: Box::new(file),
    })
}

fn load_config(
    arguments: &Arguments,
    system: &dyn System,
) -> Result<(Config, PathBuf), ConfigError> {
    let env = |name: &str| system.env(name).filter(|value| !value.is_empty());
    let path = arguments
        .config
        .clone()
        .or_else(|| env(ENV_CONFIG).map(PathBuf::from))
        .or_else(|| system.default_config_path())
        .ok_or_else(|| {
            ConfigError::Invalid(
                "cannot find the user configuration directory. Pass --config".into(),
            )
        })?;
    let token =
        match &arguments.token_file {
            Some(token_file) => Some(std::fs::read_to_string(token_file).map_err(|error| {
                ConfigError::Unreadable {
                    path: token_file.clone(),
                    reason: error.kind().to_string(),
                }
            })?),
            None => env(ENV_TOKEN),
        };
    let overrides = Overrides {
        origin: arguments.origin.clone().or_else(|| env(ENV_ORIGIN)),
        token,
        mode: arguments.mode.clone(),
        visibility: arguments.visibility.clone(),
        expiration: arguments.expiration.clone(),
    };
    Ok((Config::load(&path, &overrides)?, path))
}

fn upload_json(path: &Path, uploaded: &Uploaded) -> serde_json::Value {
    json!({
        "file": path.to_string_lossy(),
        "url": uploaded.url,
        "encrypted": uploaded.encrypted,
        "password_protected": uploaded.password_protected,
        "id": uploaded.id,
        "stored_bytes": uploaded.stored_bytes,
        // Work that an encrypted upload leaves to the browser of the owner
        // (docs/e2ee-spec.md, section 9.7).
        "deferred": if uploaded.encrypted {
            json!(["tag_rules", "text_recognition", "thumbnail"])
        } else {
            json!([])
        },
    })
}

fn run_upload(
    arguments: Arguments,
    system: &mut dyn System,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    let (config, config_path) = match load_config(&arguments, system) {
        Ok(loaded) => loaded,
        Err(error) => {
            let _ = writeln!(err, "flare-upload: {error}");
            return match error {
                ConfigError::UnknownProtocolVersion(_) => 4,
                _ => EXIT_USAGE,
            };
        }
    };
    let warn = |err: &mut dyn Write, message: &str| {
        if !arguments.quiet {
            let _ = writeln!(err, "flare-upload: warning: {message}");
        }
    };
    if let Some(warning) = permission_warning(&config_path) {
        warn(err, &warning);
    }
    let password = if arguments.password {
        if config.mode != EncryptionMode::Encrypted {
            let _ = writeln!(
                err,
                "flare-upload: --password needs encrypted mode. A plain upload has no password stanza"
            );
            return EXIT_USAGE;
        }
        let password = match system.env(ENV_PASSWORD).filter(|value| !value.is_empty()) {
            Some(password) => Zeroizing::new(password),
            None => match system.prompt_password() {
                Ok(password) => password,
                Err(error) => {
                    let _ = writeln!(err, "flare-upload: cannot read the password: {error}");
                    return EXIT_USAGE;
                }
            },
        };
        if password.is_empty() {
            let _ = writeln!(err, "flare-upload: the password is empty");
            return EXIT_USAGE;
        }
        if let Some(weakness) = password_weakness(&password) {
            warn(
                err,
                &format!(
                    "the password is weak: {weakness}. A person who has the link can test passwords on their own machine"
                ),
            );
        }
        Some(password)
    } else {
        None
    };

    let uploader = Uploader::new(config);
    let mut uploads = Vec::new();
    let mut links = Vec::new();
    let mut failure: Option<(PathBuf, UploadError)> = None;
    // The server says which protocol versions it accepts (section 1.5.3,
    // rule 5). A plain upload uses none.
    if uploader.config().mode == EncryptionMode::Encrypted {
        if let Err(error) = uploader.check_protocol_version() {
            failure = Some((PathBuf::new(), error));
        }
    }
    if failure.is_none() {
        for path in &arguments.files {
            let result = open_source(path, arguments.name.as_deref(), system).and_then(|source| {
                uploader.upload(source, password.as_ref().map(|password| password.as_str()))
            });
            match result {
                Ok(uploaded) => {
                    if !arguments.json {
                        // The link, and only the link, goes to standard output.
                        let _ = writeln!(out, "{}", uploaded.url);
                        let _ = out.flush();
                    }
                    links.push(uploaded.url.clone());
                    uploads.push(upload_json(path, &uploaded));
                }
                Err(error) => {
                    failure = Some((path.clone(), error));
                    break;
                }
            }
        }
    }
    if arguments.copy && !links.is_empty() {
        match system.copy(&links.join("\n")) {
            Ok(_) => {}
            Err(reason) => warn(err, &format!("the link was not copied: {reason}")),
        }
    }
    if arguments.open {
        if let Some(link) = links.first() {
            if let Err(reason) = system.open(link) {
                warn(err, &format!("the link was not opened: {reason}"));
            }
        }
    }
    let code = failure
        .as_ref()
        .map_or(EXIT_OK, |(_, error)| error.exit_code());
    if arguments.json {
        let error = failure.as_ref().map(|(path, error)| {
            json!({
                "file": path.to_string_lossy(),
                "message": error.to_string(),
                "exit_code": error.exit_code(),
            })
        });
        let _ = writeln!(
            out,
            "{}",
            json!({ "ok": failure.is_none(), "uploads": uploads, "error": error })
        );
    }
    if let Some((path, error)) = &failure {
        if path.as_os_str().is_empty() {
            let _ = writeln!(err, "flare-upload: {error}");
        } else {
            let _ = writeln!(err, "flare-upload: {}: {error}", path.display());
        }
    }
    code
}

fn run_self_test_command(out: &mut dyn Write, err: &mut dyn Write) -> u8 {
    let mut failed = false;
    for (name, result) in run_self_test() {
        match result {
            Ok(()) => {
                let _ = writeln!(out, "ok      {name}");
            }
            Err(reason) => {
                failed = true;
                let _ = writeln!(out, "FAILED  {name}");
                let _ = writeln!(err, "flare-upload: self-test: {reason}");
            }
        }
    }
    if failed {
        let _ = writeln!(
            err,
            "flare-upload: the self-test failed. Do not use this build"
        );
        EXIT_FAILED
    } else {
        let _ = writeln!(out, "self-test passed");
        EXIT_OK
    }
}

/// One run of the program. Returns the exit code.
pub fn run(
    arguments: Vec<OsString>,
    system: &mut dyn System,
    out: &mut dyn Write,
    err: &mut dyn Write,
) -> u8 {
    match parse_arguments(arguments) {
        Ok(Command::Help) => {
            let _ = out.write_all(HELP.as_bytes());
            EXIT_OK
        }
        Ok(Command::Version) => {
            let _ = writeln!(
                out,
                "flare-upload {} (protocol version {})",
                env!("CARGO_PKG_VERSION"),
                crate::PROTOCOL_VERSION
            );
            EXIT_OK
        }
        Ok(Command::SelfTest) => run_self_test_command(out, err),
        Ok(Command::Upload(arguments)) => run_upload(arguments, system, out, err),
        Err(message) => {
            let _ = writeln!(err, "flare-upload: {message}");
            let _ = writeln!(err, "Try: flare-upload --help");
            EXIT_USAGE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(arguments: &[&str]) -> Result<Command, String> {
        parse_arguments(arguments.iter().map(OsString::from).collect())
    }

    #[test]
    fn files_and_flags() {
        let Command::Upload(arguments) = parse(&[
            "--copy",
            "-c",
            "work.json",
            "a.png",
            "--password",
            "--json",
            "--mode=plain",
            "b.png",
        ])
        .unwrap() else {
            panic!("not an upload")
        };
        assert_eq!(
            arguments.files,
            [PathBuf::from("a.png"), PathBuf::from("b.png")]
        );
        assert_eq!(arguments.config, Some(PathBuf::from("work.json")));
        assert_eq!(arguments.mode.as_deref(), Some("plain"));
        assert!(arguments.copy && arguments.password && arguments.json);
        assert!(!arguments.open && !arguments.quiet);
    }

    #[test]
    fn standard_input_and_names_with_dashes() {
        let Command::Upload(arguments) = parse(&["--name", "shot.png", "-"]).unwrap() else {
            panic!("not an upload")
        };
        assert_eq!(arguments.files, [PathBuf::from("-")]);
        assert_eq!(arguments.name.as_deref(), Some("shot.png"));
        let Command::Upload(arguments) = parse(&["--", "--odd-name.png"]).unwrap() else {
            panic!("not an upload")
        };
        assert_eq!(arguments.files, [PathBuf::from("--odd-name.png")]);
    }

    #[test]
    fn other_commands() {
        assert_eq!(parse(&["--help"]), Ok(Command::Help));
        assert_eq!(parse(&["-V"]), Ok(Command::Version));
        assert_eq!(parse(&["--self-test"]), Ok(Command::SelfTest));
    }

    #[test]
    fn refused_arguments() {
        assert!(parse(&[]).unwrap_err().contains("no file"));
        assert!(parse(&["--name", "x", "a", "b"])
            .unwrap_err()
            .contains("one file"));
        assert!(parse(&["--config"]).unwrap_err().contains("needs a value"));
        assert!(parse(&["--frobnicate", "a"]).is_err());
        // No token and no private key on the command line.
        let token = parse(&["--token", "flr_secret", "a.png"]).unwrap_err();
        assert!(token.contains("--token is not an option"));
        assert!(!token.contains("flr_secret"));
        assert!(parse(&["--private-key", "x", "a.png"]).is_err());
        assert!(parse(&["--account-private-key=x", "a.png"]).is_err());
    }

    #[test]
    fn the_help_names_no_private_key_option() {
        assert!(!HELP.contains("--private"));
        assert!(HELP.contains("has no private key"));
        for option in [
            "--config",
            "--origin",
            "--token-file",
            "--mode",
            "--visibility",
            "--expiration",
            "--name",
            "--password",
            "--copy",
            "--open",
            "--json",
            "--quiet",
            "--self-test",
        ] {
            assert!(HELP.contains(option), "{option}");
        }
    }

    #[test]
    fn display_names() {
        assert_eq!(display_name(Path::new("/tmp/shot.png")), "shot.png");
        assert_eq!(display_name(Path::new("shot.png")), "shot.png");
        assert_eq!(display_name(Path::new("/")), "upload.bin");
    }
}
