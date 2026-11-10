//! The upload procedure of section 10.2 over HTTP. SERVER-CONTRACT.md
//! describes each request.
//!
//! An encrypted upload sends ciphertext, sealed records and stanzas. It
//! never sends the file key, the link secret, the password, or the name and
//! the type of the file. The share link is made here, after the server
//! answered, and goes to the caller only.

use std::fmt;
use std::io::{self, Cursor, Read};
use std::time::Duration;

use serde_json::{json, Value};
use ureq::tls::{RootCerts, TlsConfig};
use ureq::{Agent, SendBody};
use zeroize::Zeroizing;

use crate::config::{Config, EncryptionConfig, EncryptionMode, Visibility};
use crate::error::CryptoError;
use crate::file::{stored_length, EncryptingReader, Header};
use crate::keys::FileKey;
use crate::link::{share_link, ShareSecret};
use crate::mime::is_image;
use crate::password::password_stanza;
use crate::primitives::{base64url_encode, hex_encode, random_bytes};
use crate::records::{encode_record, sealed_metadata};
use crate::stanza::{account_stanza, folder_file_stanza, folder_link_secret_stanza};
use crate::PROTOCOL_VERSION;

/// A plaintext of at most this size goes in one request. A larger one uses
/// the chunked route. The single-request route of Flare reads at most 10 MB.
pub const SINGLE_REQUEST_MAX_BYTES: u64 = 8 * 1024 * 1024;
/// One part of a chunked upload: 80 stored chunks, a little over the 5 MiB
/// that S3 needs for each part except the last.
pub const PART_BYTES: u64 = 80 * 65568;
/// The server accepts at most this many parts, of at most 64 MiB each.
const MAX_PARTS: u64 = 10_000;
const MAX_PART_BYTES: u64 = 64 * 1024 * 1024;

/// The name and the type of the one file part of an encrypted upload. The
/// real ones are in `sealed_metadata`.
pub const ENCRYPTED_PART_NAME: &str = "encrypted";
pub const ENCRYPTED_PART_TYPE: &str = "application/octet-stream";

/// The error codes of the server that this program acts on.
pub mod codes {
    pub const ACCOUNT_KEY_NOT_CURRENT: &str = "account_key_not_current";
    pub const ACCOUNT_KEYS_MISSING: &str = "account_keys_missing";
    pub const PROFILE_REQUIRES_ENCRYPTED: &str = "profile_requires_encrypted";
    pub const PROFILE_REQUIRES_PLAIN: &str = "profile_requires_plain";
    pub const PLAIN_UPLOADS_FORBIDDEN: &str = "plain_uploads_forbidden";
    pub const TOKEN_PREDATES_ENCRYPTION: &str = "token_predates_encryption";
    pub const PROTOCOL_VERSION_NOT_ACCEPTED: &str = "protocol_version_not_accepted";
}

/// Why an upload failed. No message contains a key, the token or a password.
#[derive(Debug)]
pub enum UploadError {
    /// The file cannot be read.
    File(String),
    /// No answer from the server.
    Network(String),
    /// The server does not accept the protocol version of this program
    /// (section 1.5.3, rule 5).
    ProtocolVersion(String),
    /// The configuration is old: the account key changed (section 8.3.6) or
    /// the token is not valid any more.
    ConfigurationOutdated(String),
    /// The server refused the upload because of a setting: the `encryption`
    /// of the upload profile, or plain uploads are forbidden.
    Policy(String),
    /// Each other refusal of the server.
    Server {
        status: u16,
        message: String,
    },
    /// The answer of the server is not what the contract says.
    UnexpectedAnswer(String),
    Crypto(CryptoError),
}

impl UploadError {
    /// The exit code of the program for this failure.
    pub fn exit_code(&self) -> u8 {
        match self {
            Self::ConfigurationOutdated(_) => 3,
            Self::ProtocolVersion(_) => 4,
            Self::Policy(_) => 5,
            _ => 1,
        }
    }
}

impl fmt::Display for UploadError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::File(reason) => write!(f, "cannot read the file: {reason}"),
            Self::Network(reason) => write!(f, "cannot reach the server: {reason}"),
            Self::ProtocolVersion(reason)
            | Self::ConfigurationOutdated(reason)
            | Self::Policy(reason) => f.write_str(reason),
            Self::Server { status, message } => {
                write!(
                    f,
                    "the server refused the upload (HTTP {status}): {message}"
                )
            }
            Self::UnexpectedAnswer(reason) => {
                write!(
                    f,
                    "the server gave an answer this program cannot use: {reason}"
                )
            }
            Self::Crypto(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for UploadError {}

impl From<CryptoError> for UploadError {
    fn from(error: CryptoError) -> Self {
        Self::Crypto(error)
    }
}

/// One line of text from the server, safe to print: no control characters
/// and a limited length.
fn one_line(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .take(300)
        .collect();
    cleaned.trim().to_owned()
}

/// A plaintext to upload: its name, its type and its bytes.
pub struct Source<R: Read> {
    pub name: String,
    pub mime_type: String,
    pub length: u64,
    pub reader: R,
}

/// What the caller prints. `url` of an encrypted file contains the key
/// after `#`: it is the one value that must reach standard output only.
pub struct Uploaded {
    pub url: String,
    pub encrypted: bool,
    pub password_protected: bool,
    /// The identifier of an encrypted file. A plain answer has none.
    pub id: Option<String>,
    /// Bytes that the server stored.
    pub stored_bytes: u64,
}

struct Answer {
    status: u16,
    body: Value,
}

impl Answer {
    fn ok(&self) -> bool {
        (200..300).contains(&self.status)
    }

    /// `apiResponse` wraps the payload in `data`; the completion route does not.
    fn payload(&self) -> &Value {
        match self.body.get("data") {
            Some(data) if data.is_object() => data,
            _ => &self.body,
        }
    }

    fn text(&self, key: &str) -> Option<&str> {
        self.payload().get(key).and_then(Value::as_str)
    }
}

/// The refusal of the server as an error of this program.
fn refusal(answer: &Answer) -> UploadError {
    let message = answer
        .body
        .get("error")
        .and_then(Value::as_str)
        .map(one_line)
        .filter(|message| !message.is_empty())
        .unwrap_or_else(|| "no reason given".to_owned());
    let code = answer
        .body
        .get("code")
        .and_then(Value::as_str)
        .unwrap_or("");
    match code {
        codes::ACCOUNT_KEY_NOT_CURRENT => UploadError::ConfigurationOutdated(
            "the account key in this configuration is no longer the key of the account (the passphrase was changed or the keys were rotated). Download a new configuration from Flare: Profile, Upload tools".into(),
        ),
        codes::ACCOUNT_KEYS_MISSING => UploadError::ConfigurationOutdated(
            "the account has no encryption keys on this server. Sign in to Flare, set a passphrase, and download a new configuration".into(),
        ),
        codes::PROTOCOL_VERSION_NOT_ACCEPTED => UploadError::ProtocolVersion(format!(
            "the server does not accept protocol version {PROTOCOL_VERSION} any more. Update flare-upload"
        )),
        codes::PROFILE_REQUIRES_ENCRYPTED
        | codes::PROFILE_REQUIRES_PLAIN
        | codes::PLAIN_UPLOADS_FORBIDDEN
        | codes::TOKEN_PREDATES_ENCRYPTION => {
            UploadError::Policy(format!("the server refused the upload: {message}"))
        }
        _ if answer.status == 401 => UploadError::ConfigurationOutdated(
            "the server did not accept the token. It was revoked, it expired, or the account keys were rotated. Download a new configuration from Flare: Profile, Upload tools".into(),
        ),
        _ if (300..400).contains(&answer.status) => UploadError::Server {
            status: answer.status,
            message: "the server answered with a redirect. Check the origin in the configuration".into(),
        },
        _ => UploadError::Server {
            status: answer.status,
            message,
        },
    }
}

fn network_error(error: ureq::Error) -> UploadError {
    // The text of a transport error names hosts and causes, not headers.
    UploadError::Network(one_line(&error.to_string()))
}

/// The multipart body as a stream: the fields and the head of the file
/// part, the file, the closing boundary. The length is known before the
/// first byte is sent.
struct Multipart<R: Read> {
    boundary: String,
    head: Vec<u8>,
    file: R,
    file_length: u64,
}

const MULTIPART_TAIL_PREFIX: &str = "\r\n--";
const MULTIPART_TAIL_SUFFIX: &str = "--\r\n";

/// A quoted value of a Content-Disposition parameter, as browsers write it.
fn quoted(value: &str) -> String {
    value
        .replace('"', "%22")
        .replace('\r', "%0D")
        .replace('\n', "%0A")
}

impl<R: Read> Multipart<R> {
    fn new(
        fields: &[(&str, String)],
        file_name: &str,
        file_type: &str,
        file: R,
        file_length: u64,
    ) -> io::Result<Self> {
        let boundary = format!("----flare-upload-{}", hex_encode(&random_bytes::<16>()?));
        let mut head = Vec::new();
        // The fields come first, so the server has them before the file.
        for (name, value) in fields {
            head.extend_from_slice(
                format!(
                    "--{boundary}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{value}\r\n",
                    quoted(name)
                )
                .as_bytes(),
            );
        }
        head.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: {file_type}\r\n\r\n",
                quoted(file_name)
            )
            .as_bytes(),
        );
        Ok(Self {
            boundary,
            head,
            file,
            file_length,
        })
    }

    fn tail(&self) -> Vec<u8> {
        format!(
            "{MULTIPART_TAIL_PREFIX}{}{MULTIPART_TAIL_SUFFIX}",
            self.boundary
        )
        .into_bytes()
    }

    fn content_type(&self) -> String {
        format!("multipart/form-data; boundary={}", self.boundary)
    }

    fn content_length(&self) -> u64 {
        self.head.len() as u64 + self.file_length + self.tail().len() as u64
    }

    fn into_reader(self) -> impl Read {
        let tail = self.tail();
        Cursor::new(self.head)
            .chain(self.file.take(self.file_length))
            .chain(Cursor::new(tail))
    }
}

/// The size of one part, so that a file has at most `MAX_PARTS` parts.
fn part_bytes_for(total: u64) -> Result<u64, UploadError> {
    let needed = total.div_ceil(MAX_PARTS).max(PART_BYTES);
    if needed > MAX_PART_BYTES {
        return Err(UploadError::File(
            "the file is too large for the chunked upload of Flare".into(),
        ));
    }
    Ok(needed)
}

/// The path of the page address that the server gave. The share link uses
/// the origin of the configuration and this path only, so the server
/// cannot move the key to a different host.
fn page_path(page_url: &str) -> Result<&str, UploadError> {
    let invalid = || UploadError::UnexpectedAnswer("the page address is not valid".into());
    let rest = page_url
        .split_once("://")
        .map(|(_, rest)| rest)
        .ok_or_else(invalid)?;
    let path = rest
        .find('/')
        .map(|index| &rest[index..])
        .ok_or_else(invalid)?;
    let safe = path.len() > 1
        && path.len() <= 512
        && path.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b'-' | b'_' | b'.' | b'~' | b'%')
        });
    if safe {
        Ok(path)
    } else {
        Err(invalid())
    }
}

/// The connection to one Flare server with one configuration.
pub struct Uploader {
    agent: Agent,
    config: Config,
}

impl Uploader {
    pub fn new(config: Config) -> Self {
        let agent: Agent = Agent::config_builder()
            // The program reads the error body of the server itself.
            .http_status_as_error(false)
            // A redirect could send the token to a different host.
            .max_redirects(0)
            .max_redirects_will_error(false)
            .timeout_connect(Some(Duration::from_secs(20)))
            .timeout_recv_response(Some(Duration::from_secs(300)))
            .user_agent(concat!("flare-upload/", env!("CARGO_PKG_VERSION")))
            .tls_config(
                TlsConfig::builder()
                    // The certificate store of the operating system, so a
                    // private certificate authority of an instance works.
                    .root_certs(RootCerts::PlatformVerifier)
                    .build(),
            )
            .build()
            .into();
        Self { agent, config }
    }

    pub fn config(&self) -> &Config {
        &self.config
    }

    fn read_answer(mut response: ureq::http::Response<ureq::Body>) -> Result<Answer, UploadError> {
        let status = response.status().as_u16();
        let text = response
            .body_mut()
            .with_config()
            .limit(1024 * 1024)
            .read_to_string()
            .map_err(network_error)?;
        // An error page of a proxy is not JSON. Its status still says enough.
        let body = serde_json::from_str(&text).unwrap_or(Value::Null);
        Ok(Answer { status, body })
    }

    /// The selection headers. The profile and the folder go in headers,
    /// because the server fixes them before it reads the file.
    fn selection(&self) -> Vec<(&'static str, String)> {
        let mut headers = Vec::new();
        if let Some(profile_id) = &self.config.profile_id {
            headers.push(("X-Upload-Profile", profile_id.clone()));
        }
        if let Some(folder_id) = &self.config.folder_id {
            headers.push(("X-Upload-Folder", folder_id.clone()));
        }
        headers
    }

    fn post_json(&self, path: &str, body: &Value, encrypted: bool) -> Result<Answer, UploadError> {
        let authorization = Zeroizing::new(self.config.token.authorization());
        let mut request = self
            .agent
            .post(self.config.origin.url(path))
            .header("Authorization", authorization.as_str())
            .header("Content-Type", "application/json");
        for (name, value) in self.selection() {
            request = request.header(name, value);
        }
        if encrypted {
            request = request.header("X-Flare-Encrypted", "true");
        }
        Self::read_answer(request.send(body.to_string()).map_err(network_error)?)
    }

    fn post_multipart<R: Read>(
        &self,
        multipart: Multipart<R>,
        encrypted: bool,
    ) -> Result<Answer, UploadError> {
        let authorization = Zeroizing::new(self.config.token.authorization());
        let mut request = self
            .agent
            .post(self.config.origin.url("/api/files"))
            .header("Authorization", authorization.as_str())
            .header("Content-Type", multipart.content_type())
            .header("Content-Length", multipart.content_length().to_string());
        for (name, value) in self.selection() {
            request = request.header(name, value);
        }
        if encrypted {
            request = request.header("X-Flare-Encrypted", "true");
        }
        let mut body = multipart.into_reader();
        Self::read_answer(
            request
                .send(SendBody::from_reader(&mut body))
                .map_err(network_error)?,
        )
    }

    /// Sends a stream with the chunked routes: start, parts, completion.
    fn send_in_parts(
        &self,
        init: &Value,
        encrypted: bool,
        mut stream: impl Read,
        total: u64,
    ) -> Result<Answer, UploadError> {
        let started = self.post_json("/api/files/chunks", init, encrypted)?;
        if !started.ok() {
            return Err(refusal(&started));
        }
        let upload_id = started
            .text("uploadId")
            .filter(|id| !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_alphanumeric()))
            .ok_or_else(|| UploadError::UnexpectedAnswer("no upload identifier".into()))?
            .to_owned();
        let part_bytes = part_bytes_for(total)?;
        let authorization = Zeroizing::new(self.config.token.authorization());
        let mut parts = Vec::new();
        let mut sent = 0u64;
        let mut number = 0u64;
        while sent < total {
            number += 1;
            let length = part_bytes.min(total - sent);
            let mut part = (&mut stream).take(length);
            let response = self
                .agent
                .put(
                    self.config
                        .origin
                        .url(&format!("/api/files/chunks/{upload_id}/part/{number}")),
                )
                .header("Authorization", authorization.as_str())
                .header("Content-Type", ENCRYPTED_PART_TYPE)
                .header("Content-Length", length.to_string())
                .send(SendBody::from_reader(&mut part))
                .map_err(network_error)?;
            let answer = Self::read_answer(response)?;
            if !answer.ok() {
                return Err(refusal(&answer));
            }
            let etag = answer
                .text("etag")
                .ok_or_else(|| UploadError::UnexpectedAnswer("no part tag".into()))?;
            parts.push(json!({ "ETag": etag, "PartNumber": number }));
            sent += length;
        }
        let completed = self.post_json(
            &format!("/api/files/chunks/{upload_id}/complete"),
            &json!({ "parts": parts }),
            false,
        )?;
        if !completed.ok() {
            return Err(refusal(&completed));
        }
        Ok(completed)
    }

    /// The options that both kinds of upload can send. A token that is
    /// bound to an upload profile cannot change them; the server refuses a
    /// value that is different from the profile.
    fn visible_options(&self) -> Vec<(&'static str, String)> {
        let mut options = Vec::new();
        if let Some(visibility) = self.config.visibility {
            options.push(("visibility", visibility.as_str().to_owned()));
        }
        if let Some(expiration) = self.config.expiration {
            options.push(("expiration", expiration.as_str().to_owned()));
        }
        options
    }

    /// Section 1.5.3, rule 5: the server says which protocol versions it
    /// accepts. The request carries no token.
    pub fn check_protocol_version(&self) -> Result<(), UploadError> {
        let response = self
            .agent
            .get(self.config.origin.url("/api/settings"))
            .header("Accept", "application/json")
            .call()
            .map_err(network_error)?;
        let answer = Self::read_answer(response)?;
        if !answer.ok() {
            return Err(refusal(&answer));
        }
        let versions = answer
            .payload()
            .get("encryption")
            .and_then(|encryption| encryption.get("protocolVersions"))
            .and_then(Value::as_array)
            .ok_or_else(|| {
                UploadError::ProtocolVersion(
                    "the server does not say which protocol versions it accepts. It is not a Flare server with end-to-end encryption, or the origin is wrong".into(),
                )
            })?;
        if versions
            .iter()
            .any(|version| version.as_u64() == Some(u64::from(PROTOCOL_VERSION)))
        {
            Ok(())
        } else {
            Err(UploadError::ProtocolVersion(format!(
                "the server does not accept protocol version {PROTOCOL_VERSION} any more. Update flare-upload"
            )))
        }
    }

    /// Uploads one file as the configuration says.
    pub fn upload<R: Read>(
        &self,
        source: Source<R>,
        password: Option<&str>,
    ) -> Result<Uploaded, UploadError> {
        match (&self.config.mode, &self.config.encryption) {
            (EncryptionMode::Encrypted, Some(encryption)) => {
                self.upload_encrypted(source, encryption, password)
            }
            (EncryptionMode::Encrypted, None) => {
                Err(UploadError::Crypto(CryptoError::InvalidPublicKey))
            }
            (EncryptionMode::Plain, _) => self.upload_plain(source),
        }
    }

    /// Steps 1 to 9 of section 10.1 for a client without a private key.
    fn upload_encrypted<R: Read>(
        &self,
        source: Source<R>,
        encryption: &EncryptionConfig,
        password: Option<&str>,
    ) -> Result<Uploaded, UploadError> {
        let random = |error: io::Error| UploadError::File(error.to_string());
        let file_key = FileKey::random().map_err(random)?;
        let header = Header::new(random_bytes().map_err(random)?);
        let header_hash = header.hash();
        let mut fields: Vec<(&str, String)> = vec![
            ("header", base64url_encode(header.as_bytes())),
            (
                "sealedMetadata",
                base64url_encode(&encode_record(
                    &sealed_metadata(&file_key, &header_hash, &source.name, &source.mime_type)
                        .map_err(random)?,
                )),
            ),
            (
                "accountStanza",
                base64url_encode(&encode_record(
                    &account_stanza(&encryption.account_public_key, &header_hash, &file_key)
                        .map_err(random)?,
                )),
            ),
            (
                "stanzaAccountPublicKey",
                encryption.account_public_key.to_base64url(),
            ),
        ];
        let mut secret = ShareSecret::FileKey(file_key.clone());
        if let Some(password) = password {
            let (stanza, link_secret) = password_stanza(
                password,
                &encryption.account_public_key,
                &header_hash,
                &file_key,
            )
            .map_err(random)?;
            fields.push(("passwordStanza", base64url_encode(&encode_record(&stanza))));
            secret = ShareSecret::LinkSecret(link_secret);
        }
        // A folder stanza only for a public file (section 8.4.3). With a
        // password, the folder gets the link secret, not the file key.
        if let (Some(folder_public_key), Some(Visibility::Public)) =
            (&encryption.folder_public_key, self.config.visibility)
        {
            let stanza = match &secret {
                ShareSecret::FileKey(file_key) => {
                    folder_file_stanza(folder_public_key, &header_hash, file_key)
                }
                ShareSecret::LinkSecret(link_secret) => {
                    folder_link_secret_stanza(folder_public_key, &header_hash, link_secret)
                }
            }
            .map_err(random)?;
            fields.push(("folderStanza", base64url_encode(&encode_record(&stanza))));
            fields.push(("folderPublicKey", folder_public_key.to_base64url()));
        }
        // What this program did not do (section 9.7): no tag rules, no text
        // recognition, no thumbnail. The browser of the owner does them later.
        fields.push(("rulesApplied", "false".to_owned()));
        fields.push((
            "isImage",
            if is_image(&source.mime_type) {
                "true"
            } else {
                "false"
            }
            .to_owned(),
        ));
        fields.extend(self.visible_options());

        let total = stored_length(source.length)
            .ok_or_else(|| UploadError::File("the file is too large".into()))?;
        let stream = EncryptingReader::new(source.reader, &file_key, header, source.length);
        let answer = if source.length <= SINGLE_REQUEST_MAX_BYTES {
            let multipart = Multipart::new(
                &fields,
                ENCRYPTED_PART_NAME,
                ENCRYPTED_PART_TYPE,
                stream,
                total,
            )
            .map_err(random)?;
            let answer = self.post_multipart(multipart, true)?;
            if !answer.ok() {
                return Err(refusal(&answer));
            }
            answer
        } else {
            let mut init = serde_json::Map::new();
            init.insert("encrypted".into(), Value::Bool(true));
            init.insert("size".into(), json!(total));
            for (name, value) in &fields {
                init.insert((*name).to_owned(), Value::String(value.clone()));
            }
            self.send_in_parts(&Value::Object(init), true, stream, total)?
        };
        if answer.payload().get("encrypted").and_then(Value::as_bool) != Some(true) {
            return Err(UploadError::UnexpectedAnswer(
                "the server did not store the file as an encrypted file".into(),
            ));
        }
        let page_url = answer
            .text("pageUrl")
            .ok_or_else(|| UploadError::UnexpectedAnswer("no page address".into()))?;
        let page = format!("{}{}", self.config.origin.root(), page_path(page_url)?);
        Ok(Uploaded {
            url: share_link(&page, &secret),
            encrypted: true,
            password_protected: matches!(secret, ShareSecret::LinkSecret(_)),
            id: answer.text("id").map(str::to_owned),
            stored_bytes: total,
        })
    }

    /// A plain upload, as the screenshot tool configurations of Flare
    /// always did. The server can read the file (section 11).
    fn upload_plain<R: Read>(&self, source: Source<R>) -> Result<Uploaded, UploadError> {
        let options = self.visible_options();
        let answer = if source.length <= SINGLE_REQUEST_MAX_BYTES {
            let multipart = Multipart::new(
                &options,
                &source.name,
                &source.mime_type,
                source.reader,
                source.length,
            )
            .map_err(|error| UploadError::File(error.to_string()))?;
            let answer = self.post_multipart(multipart, false)?;
            if !answer.ok() {
                return Err(refusal(&answer));
            }
            answer
        } else {
            let mut init = serde_json::Map::new();
            init.insert("filename".into(), Value::String(source.name.clone()));
            init.insert("mimeType".into(), Value::String(source.mime_type.clone()));
            init.insert("size".into(), json!(source.length));
            for (name, value) in &options {
                init.insert((*name).to_owned(), Value::String(value.clone()));
            }
            self.send_in_parts(&Value::Object(init), false, source.reader, source.length)?
        };
        let url = answer
            .text("url")
            .or_else(|| answer.text("pageUrl"))
            .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
            .ok_or_else(|| UploadError::UnexpectedAnswer("no address".into()))?;
        Ok(Uploaded {
            url: one_line(url),
            encrypted: false,
            password_protected: false,
            id: None,
            stored_bytes: source.length,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_length_is_exact() {
        let fields = [
            ("header", "abc".to_owned()),
            ("visibility", "PUBLIC".to_owned()),
        ];
        let content = b"0123456789".to_vec();
        let multipart = Multipart::new(
            &fields,
            "encrypted",
            ENCRYPTED_PART_TYPE,
            Cursor::new(content.clone()),
            content.len() as u64,
        )
        .unwrap();
        let announced = multipart.content_length();
        let boundary = multipart.boundary.clone();
        let mut body = Vec::new();
        multipart.into_reader().read_to_end(&mut body).unwrap();
        assert_eq!(body.len() as u64, announced);
        let text = String::from_utf8(body).unwrap();
        assert!(text.starts_with(&format!("--{boundary}\r\n")));
        assert!(text.ends_with(&format!("\r\n--{boundary}--\r\n")));
        assert!(text.contains("name=\"header\"\r\n\r\nabc\r\n"));
        assert!(text.contains("name=\"file\"; filename=\"encrypted\"\r\nContent-Type: application/octet-stream\r\n\r\n0123456789\r\n"));
    }

    #[test]
    fn file_names_cannot_break_the_header() {
        assert_eq!(quoted("a\"b\r\nc.png"), "a%22b%0D%0Ac.png");
    }

    #[test]
    fn part_sizes() {
        assert_eq!(part_bytes_for(1).unwrap(), PART_BYTES);
        assert_eq!(part_bytes_for(PART_BYTES * MAX_PARTS).unwrap(), PART_BYTES);
        assert!(part_bytes_for(PART_BYTES * MAX_PARTS + 1).unwrap() > PART_BYTES);
        assert!(part_bytes_for(MAX_PART_BYTES * MAX_PARTS + 1).is_err());
    }

    #[test]
    fn page_paths() {
        assert_eq!(
            page_path("https://flare.example/birb/e_AAAAAAAAAAAAAAAAAAAAAA").unwrap(),
            "/birb/e_AAAAAAAAAAAAAAAAAAAAAA"
        );
        assert_eq!(
            page_path("http://localhost:3190/base/u/e_x").unwrap(),
            "/base/u/e_x"
        );
        for bad in [
            "https://flare.example",
            "https://flare.example/",
            "flare.example/u/e_x",
            "https://flare.example/u/e_x#key",
            "https://flare.example/u/e_x?download=1",
            "https://flare.example/u/e x",
        ] {
            assert!(page_path(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn server_text_is_one_safe_line() {
        assert_eq!(one_line("  a\nb\u{1b}[31m  "), "a b [31m");
        assert_eq!(one_line(&"x".repeat(1000)).len(), 300);
    }

    #[test]
    fn refusals_map_to_exit_codes() {
        let answer = |status: u16, body: Value| Answer { status, body };
        let rotated = refusal(&answer(
            409,
            json!({ "error": "different key", "code": codes::ACCOUNT_KEY_NOT_CURRENT }),
        ));
        assert_eq!(rotated.exit_code(), 3);
        assert!(rotated.to_string().contains("Download a new configuration"));
        assert_eq!(
            refusal(&answer(401, json!({ "error": "Unauthorized" }))).exit_code(),
            3
        );
        assert_eq!(
            refusal(&answer(
                400,
                json!({ "error": "x", "code": codes::PROTOCOL_VERSION_NOT_ACCEPTED })
            ))
            .exit_code(),
            4
        );
        for code in [
            codes::PROFILE_REQUIRES_ENCRYPTED,
            codes::PROFILE_REQUIRES_PLAIN,
            codes::PLAIN_UPLOADS_FORBIDDEN,
            codes::TOKEN_PREDATES_ENCRYPTION,
        ] {
            let error = refusal(&answer(403, json!({ "error": "why", "code": code })));
            assert_eq!(error.exit_code(), 5, "{code}");
            assert!(error.to_string().contains("why"));
        }
        assert_eq!(refusal(&answer(413, Value::Null)).exit_code(), 1);
    }
}
