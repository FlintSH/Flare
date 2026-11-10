//! The program against a mock Flare server in this process.
//!
//! The server records each request as raw bytes. The tests check what
//! SERVER-CONTRACT.md says, then do what the browser of the owner does:
//! open the account stanza with the private key of the test account and
//! decrypt the body. They also search every recorded byte for values that
//! must never leave the machine: the file name, the content, the file key
//! and the part of the link after `#`.

use std::collections::HashMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use flare_upload::cli::{run, System};
use flare_upload::ed2curve::ed2curve_private;
use flare_upload::file::{decrypt_stream, stored_length, HEADER_LENGTH};
use flare_upload::keys::{FileKey, HeaderHash, X25519PrivateKey};
use flare_upload::link::{parse_fragment, ParsedFragment, ShareSecret};
use flare_upload::password::{open_sealed_link_secret, password_stanza_unwrap, Argon2Parameters};
use flare_upload::primitives::{base64url_decode, base64url_encode, blake3_hash, hex_encode};
use flare_upload::records::{decode_record, open_sealed_metadata};
use flare_upload::stanza::{
    account_stanza_unwrap, folder_file_stanza_unwrap, folder_link_secret_stanza_unwrap,
    x25519_public_key,
};
use serde_json::{json, Value};
use zeroize::Zeroizing;

const TOKEN: &str = "flr_mock-token-0123456789";
const PROFILE_ID: &str = "profile_abc";
const SECRET_NAME: &str = "secret-holiday-photo.png";
/// The address the mock server names in its answers. It is not the origin
/// of the configuration: the link must use the configured origin.
const SERVER_PAGE: &str = "https://other-host.example/birb/e_AAAAAAAAAAAAAAAAAAAAAA";
const PAGE_PATH: &str = "/birb/e_AAAAAAAAAAAAAAAAAAAAAA";

#[derive(Clone)]
struct Recorded {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: Vec<u8>,
    /// The request as it arrived: request line, headers and body.
    raw: Vec<u8>,
}

type Responder = dyn Fn(&Recorded) -> (u16, Value) + Send + Sync;

struct MockServer {
    origin: String,
    requests: Arc<Mutex<Vec<Recorded>>>,
}

fn read_request(reader: &mut BufReader<TcpStream>) -> Option<Recorded> {
    let mut raw = Vec::new();
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).ok()? == 0 {
        return None;
    }
    raw.extend_from_slice(request_line.as_bytes());
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_owned();
    let path = parts.next()?.to_owned();
    let mut headers = HashMap::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).ok()?;
        raw.extend_from_slice(line.as_bytes());
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':')?;
        headers.insert(name.trim().to_ascii_lowercase(), value.trim().to_owned());
    }
    // The program always announces the length. A chunked body would mean
    // that it did not know the size of the ciphertext before it sent it.
    assert!(
        !headers.contains_key("transfer-encoding"),
        "the client must send Content-Length"
    );
    let length: usize = headers
        .get("content-length")
        .map(|value| value.parse().unwrap())
        .unwrap_or(0);
    let mut body = vec![0u8; length];
    reader.read_exact(&mut body).ok()?;
    raw.extend_from_slice(&body);
    Some(Recorded {
        method,
        path,
        headers,
        body,
        raw,
    })
}

impl MockServer {
    fn start(responder: Arc<Responder>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let origin = format!("http://127.0.0.1:{}", listener.local_addr().unwrap().port());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let recorded = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(stream) = stream else { break };
                let responder = responder.clone();
                let recorded = recorded.clone();
                std::thread::spawn(move || {
                    let mut writer = stream.try_clone().unwrap();
                    let mut reader = BufReader::new(stream);
                    while let Some(request) = read_request(&mut reader) {
                        let (status, body) = responder(&request);
                        recorded.lock().unwrap().push(request);
                        let body = body.to_string();
                        let response = format!(
                            "HTTP/1.1 {status} Mock\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                            body.len()
                        );
                        if writer.write_all(response.as_bytes()).is_err() {
                            break;
                        }
                    }
                });
            }
        });
        Self { origin, requests }
    }

    fn requests(&self) -> Vec<Recorded> {
        self.requests.lock().unwrap().clone()
    }

    fn uploads(&self) -> Vec<Recorded> {
        self.requests()
            .into_iter()
            .filter(|request| request.path != "/api/settings")
            .collect()
    }
}

fn settings_answer(versions: Value) -> (u16, Value) {
    (
        200,
        json!({ "success": true, "data": {
            "version": "test",
            "settings": {},
            "encryption": { "protocolVersions": versions, "forbidPlainUploads": false }
        } }),
    )
}

/// A server that accepts everything, as Flare answers.
fn accepting_server() -> MockServer {
    MockServer::start(Arc::new(|request: &Recorded| {
        let encrypted = json!({
            "encrypted": true, "id": "file_1", "url": SERVER_PAGE, "pageUrl": SERVER_PAGE, "size": request.body.len()
        });
        let plain = json!({
            "url": "https://other-host.example/birb/report.txt",
            "pageUrl": "https://other-host.example/birb/report.txt",
            "name": "report.txt", "size": 12, "type": "text/plain"
        });
        let is_encrypted =
            request.headers.get("x-flare-encrypted").map(String::as_str) == Some("true");
        match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/api/settings") => settings_answer(json!([1])),
            ("POST", "/api/files") if is_encrypted => {
                (200, json!({ "success": true, "data": encrypted }))
            }
            ("POST", "/api/files") => (200, json!({ "success": true, "data": plain })),
            ("POST", "/api/files/chunks") => (
                200,
                json!({ "data": { "uploadId": "upload0123456789abcdef", "fileKey": "uploads/birb/x/e_y" } }),
            ),
            ("PUT", path) if path.starts_with("/api/files/chunks/upload0123456789abcdef/part/") => {
                let number = path.rsplit('/').next().unwrap();
                (200, json!({ "data": { "etag": format!("etag-{number}") } }))
            }
            // The completion route answers without the `data` envelope.
            ("POST", "/api/files/chunks/upload0123456789abcdef/complete") => (200, encrypted),
            _ => (404, json!({ "error": "Not found" })),
        }
    }))
}

struct TestAccount {
    seed: [u8; 32],
    public_key: [u8; 32],
}

impl TestAccount {
    fn new() -> Self {
        let seed = blake3_hash(b"flare-upload mock server account");
        let public_key = ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes();
        Self { seed, public_key }
    }

    fn exchange_private_key(&self) -> X25519PrivateKey {
        X25519PrivateKey::from_bytes(*ed2curve_private(&self.seed))
    }
}

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(name: &str) -> Self {
        let path = std::env::temp_dir().join(format!(
            "flare-upload-test-{name}-{}",
            hex_encode(&flare_upload::primitives::random_bytes::<8>().unwrap())
        ));
        std::fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn write(&self, name: &str, content: &[u8]) -> PathBuf {
        let path = self.0.join(name);
        std::fs::write(&path, content).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        path
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn config_json(origin: &str, account: &TestAccount, extra: Value) -> Vec<u8> {
    let mut config = json!({
        "format": "flare-upload-config",
        "version": 1,
        "origin": origin,
        "token": TOKEN,
        "protocol_version": 1,
        "account_public_key": base64url_encode(&account.public_key),
        "profile_id": PROFILE_ID,
        "encryption": "encrypted",
    });
    for (key, value) in extra.as_object().unwrap() {
        config[key] = value.clone();
    }
    config.to_string().into_bytes()
}

#[derive(Default)]
struct FakeSystem {
    env: HashMap<String, String>,
    copied: Vec<String>,
    opened: Vec<String>,
    stdin: Vec<u8>,
}

impl System for FakeSystem {
    fn env(&self, name: &str) -> Option<String> {
        self.env.get(name).cloned()
    }

    fn copy(&mut self, text: &str) -> Result<&'static str, String> {
        self.copied.push(text.to_owned());
        Ok("fake")
    }

    fn open(&mut self, url: &str) -> Result<(), String> {
        self.opened.push(url.to_owned());
        Ok(())
    }

    fn prompt_password(&mut self) -> std::io::Result<Zeroizing<String>> {
        Err(std::io::Error::other("no terminal in a test"))
    }

    fn stdin(&mut self) -> Box<dyn Read> {
        Box::new(std::io::Cursor::new(self.stdin.clone()))
    }

    fn default_config_path(&self) -> Option<PathBuf> {
        None
    }
}

struct Outcome {
    code: u8,
    stdout: String,
    stderr: String,
}

fn run_cli(arguments: &[&str], system: &mut FakeSystem) -> Outcome {
    let mut out = Vec::new();
    let mut err = Vec::new();
    let code = run(
        arguments.iter().map(OsString::from).collect(),
        system,
        &mut out,
        &mut err,
    );
    Outcome {
        code,
        stdout: String::from_utf8(out).unwrap(),
        stderr: String::from_utf8(err).unwrap(),
    }
}

struct Part {
    name: String,
    filename: Option<String>,
    content_type: Option<String>,
    content: Vec<u8>,
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    find(haystack, needle).is_some()
}

/// Reads a multipart body: the parts in the sequence of the request.
fn multipart(request: &Recorded) -> Vec<Part> {
    let content_type = &request.headers["content-type"];
    let boundary = content_type
        .strip_prefix("multipart/form-data; boundary=")
        .expect("a multipart content type");
    let delimiter = format!("--{boundary}").into_bytes();
    let mut parts = Vec::new();
    let mut rest = &request.body[..];
    assert!(rest.starts_with(&delimiter));
    rest = &rest[delimiter.len()..];
    loop {
        if rest.starts_with(b"--\r\n") {
            assert_eq!(rest.len(), 4, "nothing follows the closing boundary");
            break;
        }
        assert!(rest.starts_with(b"\r\n"));
        rest = &rest[2..];
        let head_end = find(rest, b"\r\n\r\n").unwrap();
        let head = std::str::from_utf8(&rest[..head_end]).unwrap();
        rest = &rest[head_end + 4..];
        let next = find(rest, &[b"\r\n".as_slice(), &delimiter].concat()).unwrap();
        let content = rest[..next].to_vec();
        rest = &rest[next + 2 + delimiter.len()..];
        let attribute = |key: &str| {
            head.split(&format!("{key}=\""))
                .nth(1)
                .map(|text| text.split('"').next().unwrap().to_owned())
        };
        parts.push(Part {
            name: attribute(" name").unwrap(),
            filename: attribute("filename"),
            content_type: head
                .lines()
                .find_map(|line| line.strip_prefix("Content-Type: "))
                .map(str::to_owned),
            content,
        });
    }
    parts
}

fn field<'a>(parts: &'a [Part], name: &str) -> Option<&'a str> {
    parts
        .iter()
        .find(|part| part.name == name && part.filename.is_none())
        .map(|part| std::str::from_utf8(&part.content).unwrap())
}

fn record(text: &str) -> Vec<u8> {
    let stored = base64url_decode(text).unwrap();
    decode_record(&stored).unwrap().to_vec()
}

/// What a reader with the account private key gets from an upload.
struct Opened {
    file_key: FileKey,
    plaintext: Vec<u8>,
    name: String,
    mime_type: String,
}

fn open_upload(
    account: &TestAccount,
    fields: &dyn Fn(&str) -> Option<String>,
    stored: &[u8],
) -> Opened {
    let header = base64url_decode(&fields("header").unwrap()).unwrap();
    assert_eq!(header.len(), HEADER_LENGTH);
    // Section 11.2: the body starts with the header that the request named.
    assert_eq!(&stored[..HEADER_LENGTH], header.as_slice());
    assert_eq!(&stored[..8], b"FLAREE2E");
    let header_hash = HeaderHash::from_bytes(blake3_hash(&header));
    assert_eq!(
        base64url_decode(&fields("stanzaAccountPublicKey").unwrap()).unwrap(),
        account.public_key
    );
    let stanza = record(&fields("accountStanza").unwrap());
    assert_eq!(stanza.len(), 96);
    let file_key =
        account_stanza_unwrap(&account.exchange_private_key(), &header_hash, &stanza).unwrap();
    let mut plaintext = Vec::new();
    decrypt_stream(&file_key, stored, &mut plaintext).unwrap();
    assert_eq!(
        Some(stored.len() as u64),
        stored_length(plaintext.len() as u64)
    );
    let metadata = open_sealed_metadata(
        &file_key,
        &header_hash,
        &record(&fields("sealedMetadata").unwrap()),
    )
    .unwrap();
    let metadata: Value = serde_json::from_slice(&metadata).unwrap();
    Opened {
        file_key,
        plaintext,
        name: metadata["name"].as_str().unwrap().to_owned(),
        mime_type: metadata["type"].as_str().unwrap().to_owned(),
    }
}

fn link_fragment(link: &str) -> &str {
    link.trim_end()
        .split_once('#')
        .expect("a link with a key")
        .1
}

/// No recorded byte holds a value that must stay on the machine.
fn assert_nothing_leaked(server: &MockServer, plaintext: &[u8], link: &str, file_key: &FileKey) {
    let fragment = link_fragment(link);
    for request in server.requests() {
        let label = format!("{} {}", request.method, request.path);
        assert!(
            !contains(&request.raw, SECRET_NAME.as_bytes()),
            "{label}: the file name"
        );
        assert!(
            !contains(&request.raw, b"holiday"),
            "{label}: a part of the file name"
        );
        assert!(
            !contains(&request.raw, b"image/png"),
            "{label}: the file type"
        );
        assert!(
            !contains(&request.raw, fragment.as_bytes()),
            "{label}: the fragment"
        );
        assert!(
            !contains(&request.raw, file_key.expose()),
            "{label}: the file key"
        );
        assert!(
            !contains(&request.raw, base64url_encode(file_key.expose()).as_bytes()),
            "{label}: the file key as text"
        );
        assert!(
            !contains(&request.raw, hex_encode(file_key.expose()).as_bytes()),
            "{label}: the file key as hexadecimal"
        );
        // Ciphertext can hold any byte, so this looks at the request line
        // and the headers: no address in them has a part after `#`.
        let head = &request.raw[..request.raw.len() - request.body.len()];
        assert!(!contains(head, b"#"), "{label}: a fragment mark");
        if plaintext.len() >= 16 {
            assert!(
                !contains(&request.raw, &plaintext[..16]),
                "{label}: plaintext"
            );
        }
    }
}

fn png_like(length: usize) -> Vec<u8> {
    let mut content = b"\x89PNG\r\n\x1a\nflare-upload test image ".to_vec();
    let mut counter = 0u32;
    while content.len() < length {
        content.extend_from_slice(&blake3_hash(&counter.to_le_bytes()));
        counter += 1;
    }
    content.truncate(length);
    content
}

#[test]
fn small_encrypted_upload_in_one_request() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("small");
    let content = png_like(100_000);
    let file = directory.write(SECRET_NAME, &content);
    let config = directory.write(
        "config.json",
        &config_json(&server.origin, &account, json!({})),
    );
    let mut system = FakeSystem::default();
    let outcome = run_cli(
        &[
            "--config",
            config.to_str().unwrap(),
            "--copy",
            file.to_str().unwrap(),
        ],
        &mut system,
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    assert_eq!(outcome.stderr, "");
    // The link: the origin of the configuration, the path from the server,
    // the key after `#`.
    let link = outcome.stdout.trim_end();
    assert_eq!(outcome.stdout, format!("{link}\n"));
    assert!(
        link.starts_with(&format!("{}{PAGE_PATH}#", server.origin)),
        "{link}"
    );
    assert_eq!(system.copied, [link.to_owned()]);

    let requests = server.requests();
    assert_eq!(requests.len(), 2);
    // The version check carries no token.
    assert_eq!(requests[0].method, "GET");
    assert_eq!(requests[0].path, "/api/settings");
    assert!(!requests[0].headers.contains_key("authorization"));

    let upload = &requests[1];
    assert_eq!(
        (upload.method.as_str(), upload.path.as_str()),
        ("POST", "/api/files")
    );
    assert_eq!(upload.headers["authorization"], format!("Bearer {TOKEN}"));
    assert_eq!(upload.headers["x-flare-encrypted"], "true");
    assert_eq!(upload.headers["x-upload-profile"], PROFILE_ID);
    assert!(!upload.headers.contains_key("x-upload-folder"));
    assert!(upload.headers["user-agent"].starts_with("flare-upload/"));
    assert_eq!(
        upload.headers["content-length"].parse::<usize>().unwrap(),
        upload.body.len()
    );

    let parts = multipart(upload);
    // The file is the last part: the server has each field before the bytes.
    let file_part = parts.last().unwrap();
    assert_eq!(file_part.name, "file");
    assert_eq!(file_part.filename.as_deref(), Some("encrypted"));
    assert_eq!(
        file_part.content_type.as_deref(),
        Some("application/octet-stream")
    );
    let names: Vec<&str> = parts.iter().map(|part| part.name.as_str()).collect();
    assert_eq!(
        names,
        [
            "header",
            "sealedMetadata",
            "accountStanza",
            "stanzaAccountPublicKey",
            "rulesApplied",
            "isImage",
            "file"
        ]
    );
    // The program says what it did not do (section 9.7).
    assert_eq!(field(&parts, "rulesApplied"), Some("false"));
    assert_eq!(field(&parts, "isImage"), Some("true"));
    for absent in [
        "sealedOcrText",
        "sealedThumbnail",
        "ruleTagIds",
        "thumbnail",
        "passwordStanza",
        "folderStanza",
        "name",
        "filename",
        "mimeType",
        "password",
    ] {
        assert!(field(&parts, absent).is_none(), "{absent}");
    }
    // Each record has its version byte.
    for name in ["sealedMetadata", "accountStanza"] {
        assert_eq!(
            base64url_decode(field(&parts, name).unwrap()).unwrap()[0],
            0x01
        );
    }
    assert_eq!(
        file_part.content.len() as u64,
        stored_length(content.len() as u64).unwrap()
    );

    let lookup = |name: &str| field(&parts, name).map(str::to_owned);
    let opened = open_upload(&account, &lookup, &file_part.content);
    assert_eq!(opened.plaintext, content);
    assert_eq!(opened.name, SECRET_NAME);
    assert_eq!(opened.mime_type, "image/png");
    // The key in the link is the key of the file.
    match parse_fragment(link_fragment(link)) {
        ParsedFragment::Secret(ShareSecret::FileKey(key)) => {
            assert_eq!(key.expose(), opened.file_key.expose())
        }
        other => panic!("{other:?}"),
    }
    assert_nothing_leaked(&server, &content, link, &opened.file_key);
}

#[test]
fn large_encrypted_upload_in_parts() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("large");
    // Over the single-request limit and over one part.
    let content = png_like(9 * 1024 * 1024 + 12345);
    let file = directory.write(SECRET_NAME, &content);
    let config = directory.write(
        "config.json",
        &config_json(&server.origin, &account, json!({})),
    );
    let mut system = FakeSystem::default();
    let outcome = run_cli(
        &["-c", config.to_str().unwrap(), file.to_str().unwrap()],
        &mut system,
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    let link = outcome.stdout.trim_end().to_owned();

    let uploads = server.uploads();
    let total = stored_length(content.len() as u64).unwrap();
    let init = &uploads[0];
    assert_eq!(
        (init.method.as_str(), init.path.as_str()),
        ("POST", "/api/files/chunks")
    );
    assert_eq!(init.headers["authorization"], format!("Bearer {TOKEN}"));
    assert_eq!(init.headers["content-type"], "application/json");
    assert_eq!(init.headers["x-upload-profile"], PROFILE_ID);
    let body: Value = serde_json::from_slice(&init.body).unwrap();
    assert_eq!(body["encrypted"], true);
    assert_eq!(body["size"], total);
    assert_eq!(body["rulesApplied"], "false");
    assert_eq!(body["isImage"], "true");
    let mut keys: Vec<&str> = body
        .as_object()
        .unwrap()
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        [
            "accountStanza",
            "encrypted",
            "header",
            "isImage",
            "rulesApplied",
            "sealedMetadata",
            "size",
            "stanzaAccountPublicKey"
        ]
    );

    let parts: Vec<&Recorded> = uploads
        .iter()
        .filter(|request| request.method == "PUT")
        .collect();
    assert_eq!(parts.len(), 2);
    let mut stored = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        assert_eq!(
            part.path,
            format!(
                "/api/files/chunks/upload0123456789abcdef/part/{}",
                index + 1
            )
        );
        assert_eq!(part.headers["authorization"], format!("Bearer {TOKEN}"));
        stored.extend_from_slice(&part.body);
    }
    // Each part except the last is over the 5 MiB that S3 needs.
    assert_eq!(parts[0].body.len(), 80 * 65568);
    assert_eq!(stored.len() as u64, total);

    let complete = uploads.last().unwrap();
    assert_eq!(
        complete.path,
        "/api/files/chunks/upload0123456789abcdef/complete"
    );
    let completion: Value = serde_json::from_slice(&complete.body).unwrap();
    assert_eq!(
        completion,
        json!({ "parts": [
            { "ETag": "etag-1", "PartNumber": 1 },
            { "ETag": "etag-2", "PartNumber": 2 }
        ] })
    );

    let lookup = |name: &str| body[name].as_str().map(str::to_owned);
    let opened = open_upload(&account, &lookup, &stored);
    assert_eq!(opened.plaintext, content);
    assert_eq!(opened.name, SECRET_NAME);
    assert!(link.starts_with(&format!("{}{PAGE_PATH}#", server.origin)));
    assert_nothing_leaked(&server, &content, &link, &opened.file_key);
}

#[test]
fn password_link_and_folder_stanza() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("password");
    let content = png_like(5000);
    let file = directory.write(SECRET_NAME, &content);
    let folder_private_key = blake3_hash(b"folder private key");
    let folder_public_key = x25519_public_key(&folder_private_key);
    let config = directory.write(
        "config.json",
        &config_json(
            &server.origin,
            &account,
            json!({
                "folder_id": "folder_1",
                "folder_public_key": base64url_encode(&folder_public_key),
                "visibility": "PUBLIC",
            }),
        ),
    );
    let password = "correct horse battery staple";
    let mut system = FakeSystem::default();
    system
        .env
        .insert("FLARE_UPLOAD_PASSWORD".into(), password.into());
    let outcome = run_cli(
        &[
            "--config",
            config.to_str().unwrap(),
            "--password",
            "--json",
            file.to_str().unwrap(),
        ],
        &mut system,
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    assert!(!outcome.stderr.contains(password));
    let output: Value = serde_json::from_str(&outcome.stdout).unwrap();
    assert_eq!(output["ok"], true);
    let upload = &output["uploads"][0];
    assert_eq!(upload["encrypted"], true);
    assert_eq!(upload["password_protected"], true);
    assert_eq!(upload["id"], "file_1");
    assert_eq!(
        upload["deferred"],
        json!(["tag_rules", "text_recognition", "thumbnail"])
    );
    let link = upload["url"].as_str().unwrap();
    // Section 10.3: the prefix `p.` and the link secret.
    let fragment = link_fragment(link);
    assert!(fragment.starts_with("p."), "{fragment}");
    let ParsedFragment::Secret(ShareSecret::LinkSecret(link_secret)) = parse_fragment(fragment)
    else {
        panic!("not a link secret")
    };

    let request = &server.uploads()[0];
    assert_eq!(request.headers["x-upload-folder"], "folder_1");
    let parts = multipart(request);
    assert_eq!(field(&parts, "visibility"), Some("PUBLIC"));
    let lookup = |name: &str| field(&parts, name).map(str::to_owned);
    let stored = &parts.last().unwrap().content;
    let opened = open_upload(&account, &lookup, stored);
    assert_eq!(opened.plaintext, content);
    let header_hash = HeaderHash::from_bytes(blake3_hash(
        &base64url_decode(field(&parts, "header").unwrap()).unwrap(),
    ));

    // The password and the link secret together open the password stanza.
    let password_stanza = record(field(&parts, "passwordStanza").unwrap());
    assert_eq!(password_stanza.len(), 216);
    assert_eq!(&password_stanza[32..64], account.public_key.as_slice());
    let from_password = password_stanza_unwrap(
        password,
        &link_secret,
        &header_hash,
        &password_stanza,
        Argon2Parameters::PROTOCOL_V1,
    )
    .unwrap();
    assert_eq!(from_password.expose(), opened.file_key.expose());
    assert!(password_stanza_unwrap(
        "a different password",
        &link_secret,
        &header_hash,
        &password_stanza,
        Argon2Parameters::PROTOCOL_V1
    )
    .is_err());
    let copy = open_sealed_link_secret(&opened.file_key, &header_hash, &password_stanza).unwrap();
    assert_eq!(copy.expose(), link_secret.expose());

    // With a password, the folder gets the link secret and not the file key
    // (section 8.4.3).
    assert_eq!(
        base64url_decode(field(&parts, "folderPublicKey").unwrap()).unwrap(),
        folder_public_key
    );
    let folder_stanza = record(field(&parts, "folderStanza").unwrap());
    let folder_key = X25519PrivateKey::from_bytes(folder_private_key);
    let from_folder =
        folder_link_secret_stanza_unwrap(&folder_key, &header_hash, &folder_stanza).unwrap();
    assert_eq!(from_folder.expose(), link_secret.expose());
    assert!(folder_file_stanza_unwrap(&folder_key, &header_hash, &folder_stanza).is_err());

    // Neither the password nor the link secret went to the server.
    for request in server.requests() {
        assert!(!contains(&request.raw, password.as_bytes()));
        assert!(!contains(&request.raw, link_secret.expose()));
        assert!(!contains(
            &request.raw,
            base64url_encode(link_secret.expose()).as_bytes()
        ));
    }
    assert_nothing_leaked(&server, &content, link, &opened.file_key);
}

#[test]
fn folder_stanza_of_a_public_file_and_none_for_a_private_file() {
    let account = TestAccount::new();
    let folder_private_key = blake3_hash(b"folder private key");
    let folder_public_key = x25519_public_key(&folder_private_key);
    for (visibility, expects_stanza) in [("PUBLIC", true), ("PRIVATE", false)] {
        let server = accepting_server();
        let directory = TestDirectory::new("folder");
        let content = png_like(300);
        let file = directory.write(SECRET_NAME, &content);
        let config = directory.write(
            "config.json",
            &config_json(
                &server.origin,
                &account,
                json!({
                    "folder_id": "folder_1",
                    "folder_public_key": base64url_encode(&folder_public_key),
                    "visibility": visibility,
                }),
            ),
        );
        let outcome = run_cli(
            &["--config", config.to_str().unwrap(), file.to_str().unwrap()],
            &mut FakeSystem::default(),
        );
        assert_eq!(outcome.code, 0, "{}", outcome.stderr);
        let request = &server.uploads()[0];
        let parts = multipart(request);
        assert_eq!(
            field(&parts, "folderStanza").is_some(),
            expects_stanza,
            "{visibility}"
        );
        assert_eq!(field(&parts, "folderPublicKey").is_some(), expects_stanza);
        if expects_stanza {
            let lookup = |name: &str| field(&parts, name).map(str::to_owned);
            let opened = open_upload(&account, &lookup, &parts.last().unwrap().content);
            let header_hash = HeaderHash::from_bytes(blake3_hash(
                &base64url_decode(field(&parts, "header").unwrap()).unwrap(),
            ));
            let from_folder = folder_file_stanza_unwrap(
                &X25519PrivateKey::from_bytes(folder_private_key),
                &header_hash,
                &record(field(&parts, "folderStanza").unwrap()),
            )
            .unwrap();
            assert_eq!(from_folder.expose(), opened.file_key.expose());
        }
    }
}

#[test]
fn standard_input_with_a_name() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("stdin");
    let config = directory.write(
        "config.json",
        &config_json(&server.origin, &account, json!({})),
    );
    let mut system = FakeSystem {
        stdin: b"notes from a pipe".to_vec(),
        ..FakeSystem::default()
    };
    let outcome = run_cli(
        &[
            "--config",
            config.to_str().unwrap(),
            "--name",
            "notes.txt",
            "--open",
            "-",
        ],
        &mut system,
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    assert_eq!(system.opened, [outcome.stdout.trim_end().to_owned()]);
    let parts = multipart(&server.uploads()[0]);
    assert_eq!(field(&parts, "isImage"), Some("false"));
    let lookup = |name: &str| field(&parts, name).map(str::to_owned);
    let opened = open_upload(&account, &lookup, &parts.last().unwrap().content);
    assert_eq!(opened.plaintext, b"notes from a pipe");
    assert_eq!(opened.name, "notes.txt");
    assert_eq!(opened.mime_type, "text/plain");
}

#[test]
fn plain_mode_uploads_as_the_older_configurations_did() {
    let server = accepting_server();
    let directory = TestDirectory::new("plain");
    let file = directory.write("report.txt", b"plain report");
    // A plain configuration needs no key and no protocol version.
    let config = directory.write(
        "config.json",
        json!({ "origin": server.origin, "token": TOKEN, "profile_id": PROFILE_ID, "encryption": "plain" })
            .to_string()
            .as_bytes(),
    );
    let outcome = run_cli(
        &["--config", config.to_str().unwrap(), file.to_str().unwrap()],
        &mut FakeSystem::default(),
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    // The address of the server, as it gave it. A plain link has no key.
    assert_eq!(
        outcome.stdout,
        "https://other-host.example/birb/report.txt\n"
    );
    let requests = server.requests();
    // A plain upload uses no protocol version, so it asks for none.
    assert_eq!(requests.len(), 1);
    let upload = &requests[0];
    assert_eq!(upload.headers["authorization"], format!("Bearer {TOKEN}"));
    assert!(!upload.headers.contains_key("x-flare-encrypted"));
    assert_eq!(upload.headers["x-upload-profile"], PROFILE_ID);
    let parts = multipart(upload);
    assert_eq!(parts.len(), 1);
    assert_eq!(parts[0].filename.as_deref(), Some("report.txt"));
    assert_eq!(parts[0].content_type.as_deref(), Some("text/plain"));
    assert_eq!(parts[0].content, b"plain report");
    // --password has no meaning for a plain upload.
    let refused = run_cli(
        &[
            "--config",
            config.to_str().unwrap(),
            "--password",
            file.to_str().unwrap(),
        ],
        &mut FakeSystem::default(),
    );
    assert_eq!(refused.code, 2);
    assert!(refused.stderr.contains("--password needs encrypted mode"));
}

fn refusing_server(status: u16, body: Value) -> MockServer {
    MockServer::start(Arc::new(move |request: &Recorded| {
        if request.path == "/api/settings" {
            settings_answer(json!([1]))
        } else {
            (status, body.clone())
        }
    }))
}

fn upload_against(server: &MockServer, extra_arguments: &[&str]) -> Outcome {
    let account = TestAccount::new();
    let directory = TestDirectory::new("refused");
    let file = directory.write(SECRET_NAME, &png_like(2000));
    let config = directory.write(
        "config.json",
        &config_json(&server.origin, &account, json!({})),
    );
    let mut arguments = vec!["--config", config.to_str().unwrap()];
    arguments.extend_from_slice(extra_arguments);
    arguments.push(file.to_str().unwrap());
    run_cli(&arguments, &mut FakeSystem::default())
}

#[test]
fn a_rotated_account_key_asks_for_a_new_configuration() {
    // Section 8.3.6: the server rejects a stanza for the old key.
    let server = refusing_server(
        409,
        json!({
            "error": "The upload was encrypted for a different account key.",
            "code": "account_key_not_current"
        }),
    );
    let outcome = upload_against(&server, &[]);
    assert_eq!(outcome.code, 3);
    assert_eq!(outcome.stdout, "");
    let lines: Vec<&str> = outcome.stderr.lines().collect();
    assert_eq!(lines.len(), 1, "{}", outcome.stderr);
    assert!(lines[0].contains("no longer the key of the account"));
    assert!(lines[0].contains("Download a new configuration"));
}

#[test]
fn a_revoked_token_asks_for_a_new_configuration() {
    let server = refusing_server(401, json!({ "error": "Unauthorized" }));
    let outcome = upload_against(&server, &[]);
    assert_eq!(outcome.code, 3);
    assert!(outcome.stderr.contains("did not accept the token"));
    assert!(!outcome.stderr.contains(TOKEN));
}

#[test]
fn a_setting_of_the_server_refuses_the_upload() {
    for code in [
        "profile_requires_plain",
        "plain_uploads_forbidden",
        "token_predates_encryption",
    ] {
        let server = refusing_server(
            403,
            json!({ "error": "This upload profile takes plain uploads.", "code": code }),
        );
        let outcome = upload_against(&server, &["--json"]);
        assert_eq!(outcome.code, 5, "{code}");
        assert!(outcome
            .stderr
            .contains("This upload profile takes plain uploads."));
        let output: Value = serde_json::from_str(&outcome.stdout).unwrap();
        assert_eq!(output["ok"], false);
        assert_eq!(output["uploads"], json!([]));
        assert_eq!(output["error"]["exit_code"], 5);
    }
}

#[test]
fn the_text_of_the_server_cannot_forge_terminal_output() {
    let server = refusing_server(
        400,
        json!({ "error": "bad\r\nflare-upload: uploaded https://evil.example/#key\u{1b}[2J" }),
    );
    let outcome = upload_against(&server, &[]);
    assert_eq!(outcome.code, 1);
    assert_eq!(outcome.stderr.lines().count(), 1);
    assert!(!outcome.stderr.contains('\u{1b}'));
}

#[test]
fn a_server_that_retired_the_protocol_version_gets_no_upload() {
    // Section 1.5.3, rule 5.
    let server = MockServer::start(Arc::new(|request: &Recorded| {
        if request.path == "/api/settings" {
            settings_answer(json!([2, 3]))
        } else {
            (500, json!({ "error": "must not be called" }))
        }
    }));
    let outcome = upload_against(&server, &[]);
    assert_eq!(outcome.code, 4);
    assert!(outcome.stderr.contains("Update flare-upload"));
    assert_eq!(server.uploads().len(), 0);

    // A server that names no versions is not a server for this program.
    let old = MockServer::start(Arc::new(|_: &Recorded| {
        (
            200,
            json!({ "success": true, "data": { "version": "old", "settings": {} } }),
        )
    }));
    let outcome = upload_against(&old, &[]);
    assert_eq!(outcome.code, 4);
    assert_eq!(old.uploads().len(), 0);
}

#[test]
fn a_server_that_answers_with_a_plain_file_is_not_trusted() {
    // The server must store an encrypted upload as an encrypted file.
    let server = refusing_server(
        200,
        json!({ "success": true, "data": { "url": SERVER_PAGE, "pageUrl": SERVER_PAGE, "name": "x", "size": 1, "type": "image/png" } }),
    );
    let outcome = upload_against(&server, &[]);
    assert_eq!(outcome.code, 1);
    assert_eq!(outcome.stdout, "");
    assert!(outcome
        .stderr
        .contains("did not store the file as an encrypted file"));
}

#[test]
fn a_page_address_with_a_fragment_or_a_query_gets_no_key() {
    for page in [
        "https://other-host.example/birb/e_x?next=https://evil.example",
        "https://other-host.example/birb/e_x#already",
        "javascript:alert(1)",
    ] {
        let server = refusing_server(
            200,
            json!({ "success": true, "data": { "encrypted": true, "id": "f", "url": page, "pageUrl": page, "size": 1 } }),
        );
        let outcome = upload_against(&server, &[]);
        assert_eq!(outcome.code, 1, "{page}");
        assert_eq!(outcome.stdout, "", "{page}");
    }
}

#[test]
fn configuration_errors_stop_before_any_request() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("config");
    let file = directory.write(SECRET_NAME, &png_like(100));

    // A protocol version that this program does not know (section 1.5.2).
    let later = directory.write(
        "later.json",
        &config_json(&server.origin, &account, json!({ "protocol_version": 2 })),
    );
    let outcome = run_cli(
        &["--config", later.to_str().unwrap(), file.to_str().unwrap()],
        &mut FakeSystem::default(),
    );
    assert_eq!(outcome.code, 4);
    assert!(outcome.stderr.contains("protocol version 2"));

    // http:// to a host that is not this machine.
    let remote = directory.write(
        "remote.json",
        &config_json("http://flare.example", &account, json!({})),
    );
    let outcome = run_cli(
        &["--config", remote.to_str().unwrap(), file.to_str().unwrap()],
        &mut FakeSystem::default(),
    );
    assert_eq!(outcome.code, 2);
    assert!(outcome.stderr.contains("accepted for localhost only"));

    // No configuration file.
    let missing = directory.0.join("missing.json");
    let outcome = run_cli(
        &[
            "--config",
            missing.to_str().unwrap(),
            file.to_str().unwrap(),
        ],
        &mut FakeSystem::default(),
    );
    assert_eq!(outcome.code, 2);
    assert!(outcome
        .stderr
        .contains("cannot read the configuration file"));

    assert_eq!(server.requests().len(), 0);
}

#[test]
fn the_token_can_come_from_the_environment_or_a_file() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("token");
    let file = directory.write(SECRET_NAME, &png_like(100));
    let mut config: Value =
        serde_json::from_slice(&config_json(&server.origin, &account, json!({}))).unwrap();
    config.as_object_mut().unwrap().remove("token");
    let config = directory.write("config.json", config.to_string().as_bytes());

    let outcome = run_cli(
        &["--config", config.to_str().unwrap(), file.to_str().unwrap()],
        &mut FakeSystem::default(),
    );
    assert_eq!(outcome.code, 2);
    assert!(outcome.stderr.contains("the token is missing"));

    let mut system = FakeSystem::default();
    system
        .env
        .insert("FLARE_UPLOAD_TOKEN".into(), "flr_from-env".into());
    let outcome = run_cli(
        &["--config", config.to_str().unwrap(), file.to_str().unwrap()],
        &mut system,
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    assert_eq!(
        server.uploads()[0].headers["authorization"],
        "Bearer flr_from-env"
    );

    let token_file = directory.write("token", b"flr_from-file\n");
    let outcome = run_cli(
        &[
            "--config",
            config.to_str().unwrap(),
            "--token-file",
            token_file.to_str().unwrap(),
            file.to_str().unwrap(),
        ],
        &mut FakeSystem::default(),
    );
    assert_eq!(outcome.code, 0, "{}", outcome.stderr);
    assert_eq!(
        server.uploads()[1].headers["authorization"],
        "Bearer flr_from-file"
    );
}

/// The built program, as a screenshot tool starts it.
#[test]
fn the_binary_prints_the_link_and_nothing_else() {
    let server = accepting_server();
    let account = TestAccount::new();
    let directory = TestDirectory::new("binary");
    let content = png_like(70_000);
    let file = directory.write(SECRET_NAME, &content);
    let config = directory.write(
        "config.json",
        &config_json(&server.origin, &account, json!({})),
    );
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_flare-upload"))
        .env_clear()
        .env("FLARE_UPLOAD_CONFIG", &config)
        .arg(&file)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1);
    assert!(
        output.stderr.is_empty(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let link = stdout.trim_end();
    let parts = multipart(&server.uploads()[0]);
    let lookup = |name: &str| field(&parts, name).map(str::to_owned);
    let opened = open_upload(&account, &lookup, &parts.last().unwrap().content);
    assert_eq!(opened.plaintext, content);
    assert_eq!(
        link,
        format!(
            "{}{PAGE_PATH}#{}",
            server.origin,
            base64url_encode(opened.file_key.expose())
        )
    );
    assert_nothing_leaked(&server, &content, link, &opened.file_key);

    // The self-test of the same binary.
    let self_test = std::process::Command::new(env!("CARGO_BIN_EXE_flare-upload"))
        .arg("--self-test")
        .output()
        .unwrap();
    assert!(self_test.status.success());
    assert!(String::from_utf8_lossy(&self_test.stdout).ends_with("self-test passed\n"));

    // A failure exits with its code and prints no link.
    let refused = std::process::Command::new(env!("CARGO_BIN_EXE_flare-upload"))
        .env_clear()
        .env("FLARE_UPLOAD_CONFIG", &config)
        .arg(directory.0.join("no-such-file.png"))
        .output()
        .unwrap();
    assert_eq!(refused.status.code(), Some(1));
    assert!(refused.stdout.is_empty());
}
