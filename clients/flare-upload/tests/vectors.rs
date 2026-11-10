//! The shared test vectors of protocol version 1.
//!
//! `lib/e2ee/vectors/v1.json` comes from the reference program of the
//! project. This crate was written from the specification, so equal outputs
//! mean that two independent implementations agree.
//!
//! Every vector of every procedure that a script client performs is
//! checked, also the `rejects` and `decrypt_rejects` vectors. The
//! procedures that a script client never performs are in `SKIPPED` with the
//! reason. A procedure that is in neither list fails the test.

use std::collections::BTreeMap;

use flare_upload::ed2curve::{ed2curve_private, ed2curve_public};
use flare_upload::file::{
    decrypt_chunk, decrypt_stream, encrypt_chunk, encrypt_to_vec, ContentKeys, Header,
    CONTEXT_CONTENT_CIPHER, CONTEXT_CONTENT_MAC,
};
use flare_upload::keys::{
    AccountPublicKey, EphemeralPrivateKey, FileKey, HeaderHash, LinkSecret, X25519PrivateKey,
    X25519PublicKey,
};
use flare_upload::password::{
    open_sealed_link_secret, password_stanza_unwrap, password_stanza_with, Argon2Parameters,
    PasswordStanzaRandomness, CONTEXT_LINK_SECRET_COPY,
};
use flare_upload::primitives::{
    blake3_derive_key, blake3_hash, blake3_keyed_hash, hex_decode, hex_encode, open, open_once,
    seal, seal_once,
};
use flare_upload::records::{
    decode_record, encode_record, open_sealed_metadata, open_sealed_ocr_text,
    open_sealed_thumbnail, sealed_metadata_with, sealed_ocr_text_with, sealed_thumbnail_with,
    CONTEXT_FILE_METADATA, CONTEXT_OCR_TEXT, CONTEXT_THUMBNAIL,
};
use flare_upload::stanza::{
    account_stanza_unwrap, account_stanza_with, folder_file_stanza_unwrap, folder_file_stanza_with,
    folder_link_secret_stanza_unwrap, folder_link_secret_stanza_with, public_unwrap,
    public_wrap_with, x25519_public_key,
};
use serde_json::Value;

/// Procedures that a script client never performs, and why.
const SKIPPED: &[(&str, &str)] = &[
    (
        "passphrase_keys",
        "the account passphrase stays in the browser; a script client has no passphrase",
    ),
    ("wrapped_root", "a script client never has root_entropy"),
    (
        "sign_in_signature",
        "a script client uses a bearer token, not a sign-in",
    ),
    (
        "unlock_signature",
        "a script client never unlocks account keys",
    ),
    (
        "signed_request",
        "a script client has no account private key to sign with",
    ),
    (
        "sealed_keyring",
        "a script client has no private keys to keep",
    ),
    (
        "folder",
        "only the owner creates folders, with the account private key",
    ),
    (
        "tag",
        "tags are sealed with a key from the account private key",
    ),
];

/// The context of a stanza from a folder to a folder below it. A script
/// client never makes one; the vectors of `folder_stanzas` hold one, and
/// `public_wrap` is the same procedure for each context.
const CONTEXT_PARENT_FOLDER_STANZA: &str = "flare e2ee v1 parent folder stanza";

struct Vector<'a> {
    procedure: &'a str,
    name: &'a str,
    input: &'a Value,
    output: &'a Value,
}

impl Vector<'_> {
    fn label(&self) -> String {
        format!("{} / {}", self.procedure, self.name)
    }

    fn field<'v>(&self, from: &'v Value, key: &str) -> &'v Value {
        from.get(key)
            .unwrap_or_else(|| panic!("{}: no field {key}", self.label()))
    }

    fn text(&self, key: &str) -> &str {
        self.field(self.input, key)
            .as_str()
            .unwrap_or_else(|| panic!("{}: {key} is not text", self.label()))
    }

    fn bytes(&self, key: &str) -> Vec<u8> {
        hex_decode(self.text(key)).unwrap_or_else(|_| panic!("{}: {key} is not hex", self.label()))
    }

    fn array<const N: usize>(&self, key: &str) -> [u8; N] {
        <[u8; N]>::try_from(self.bytes(key).as_slice())
            .unwrap_or_else(|_| panic!("{}: {key} does not have {N} bytes", self.label()))
    }

    fn integer(&self, key: &str) -> u64 {
        self.field(self.input, key)
            .as_u64()
            .unwrap_or_else(|| panic!("{}: {key} is not an integer", self.label()))
    }

    fn boolean(&self, key: &str) -> bool {
        self.field(self.input, key)
            .as_bool()
            .unwrap_or_else(|| panic!("{}: {key} is not a boolean", self.label()))
    }

    fn expected(&self, key: &str) -> &str {
        self.field(self.output, key)
            .as_str()
            .unwrap_or_else(|| panic!("{}: output {key} is not text", self.label()))
    }

    fn expect(&self, key: &str, actual: &[u8]) {
        assert_eq!(
            hex_encode(actual),
            self.expected(key),
            "{}: {key}",
            self.label()
        );
    }

    fn expects_error(&self) -> bool {
        self.output.get("error").and_then(Value::as_bool) == Some(true)
    }

    fn file_key(&self) -> FileKey {
        FileKey::from_bytes(self.array("file_key"))
    }

    fn header_hash(&self) -> HeaderHash {
        HeaderHash::from_bytes(self.array("header_hash"))
    }

    fn argon2(&self) -> Argon2Parameters {
        Argon2Parameters {
            memory_kib: self.integer("memory_kib") as u32,
            passes: self.integer("passes") as u32,
            lanes: self.integer("lanes") as u32,
        }
    }
}

fn rejected<T, E>(vector: &Vector, result: Result<T, E>) {
    assert!(
        vector.expects_error(),
        "{}: a rejects vector without an error output",
        vector.label()
    );
    assert!(
        result.is_err(),
        "{}: the input was accepted",
        vector.label()
    );
}

fn blake3_derive_key_vector(vector: &Vector) {
    let key = blake3_derive_key(vector.text("context_text"), &vector.bytes("key_material"));
    vector.expect("key", key.as_slice());
}

fn blake3_keyed_hash_vector(vector: &Vector) {
    let hash = blake3_keyed_hash(&vector.array("key"), &vector.bytes("message"));
    vector.expect("hash", &hash);
}

fn seal_vector(vector: &Vector) {
    let key: [u8; 32] = vector.array("key");
    let nonce: [u8; 24] = vector.array("nonce");
    let associated_data = vector.bytes("associated_data");
    let message = vector.bytes("message");
    let sealed_box = seal(&key, &nonce, &associated_data, &message);
    vector.expect("sealed_box", &sealed_box);
    assert_eq!(
        open(&key, &associated_data, &sealed_box)
            .unwrap()
            .as_slice(),
        message.as_slice(),
        "{}",
        vector.label()
    );
    // Each changed byte and each changed input must fail.
    for index in [0, 23, 24, sealed_box.len() - 33, sealed_box.len() - 1] {
        if index >= sealed_box.len() {
            continue;
        }
        let mut changed = sealed_box.clone();
        changed[index] ^= 0x01;
        assert!(
            open(&key, &associated_data, &changed).is_err(),
            "{}",
            vector.label()
        );
    }
    let mut other_data = associated_data.clone();
    other_data.push(0);
    assert!(
        open(&key, &other_data, &sealed_box).is_err(),
        "{}",
        vector.label()
    );
    assert!(open(
        &key,
        &associated_data,
        &sealed_box[..55.min(sealed_box.len() - 1)]
    )
    .is_err());
    // Section 4.2.1: with the nonce that comes from the key, `seal_once`
    // gives the box without its first 24 bytes.
    if vector.name.starts_with("nonce from the key") {
        let once = seal_once(&key, &associated_data, &message);
        assert_eq!(once, sealed_box[24..], "{}", vector.label());
        assert_eq!(
            open_once(&key, &associated_data, &once).unwrap().as_slice(),
            message.as_slice()
        );
    }
}

fn file_keys_vector(vector: &Vector) {
    let file_key: [u8; 32] = vector.array("file_key");
    for (output, context) in [
        ("content_cipher_key", CONTEXT_CONTENT_CIPHER),
        ("content_mac_key", CONTEXT_CONTENT_MAC),
        ("metadata_key", CONTEXT_FILE_METADATA),
        ("ocr_text_key", CONTEXT_OCR_TEXT),
        ("thumbnail_key", CONTEXT_THUMBNAIL),
        ("link_secret_key", CONTEXT_LINK_SECRET_COPY),
    ] {
        vector.expect(output, blake3_derive_key(context, &file_key).as_slice());
    }
}

fn header_vector(vector: &Vector) {
    let header = Header::new(vector.array("nonce_prefix"));
    vector.expect("header", header.as_bytes());
    vector.expect("header_hash", header.hash().as_bytes());
    assert_eq!(Header::parse(header.as_bytes()).unwrap(), header);
}

fn file_chunk_vector(vector: &Vector) {
    let file_key = vector.file_key();
    let header = Header::new(vector.array("nonce_prefix"));
    let chunk_index = vector.integer("chunk_index");
    let is_final = vector.boolean("is_final");
    let keys = ContentKeys::derive(&file_key);
    if vector.name.starts_with("decrypt_rejects ") {
        let result = decrypt_chunk(
            &keys,
            &header,
            &header.hash(),
            chunk_index,
            is_final,
            &vector.bytes("stored_chunk"),
        );
        rejected(vector, result);
        return;
    }
    let plaintext = vector.bytes("chunk_plaintext");
    let stored_chunk = encrypt_chunk(&file_key, &header, chunk_index, is_final, &plaintext);
    vector.expect("stored_chunk", &stored_chunk);
    let decrypted = decrypt_chunk(
        &keys,
        &header,
        &header.hash(),
        chunk_index,
        is_final,
        &stored_chunk,
    )
    .unwrap();
    assert_eq!(
        decrypted.as_slice(),
        plaintext.as_slice(),
        "{}",
        vector.label()
    );
    // The tag covers the position and the final flag.
    assert!(decrypt_chunk(
        &keys,
        &header,
        &header.hash(),
        chunk_index + 1,
        is_final,
        &stored_chunk
    )
    .is_err());
    assert!(decrypt_chunk(
        &keys,
        &header,
        &header.hash(),
        chunk_index,
        !is_final,
        &stored_chunk
    )
    .is_err());
}

fn file_vector(vector: &Vector) {
    let file_key = vector.file_key();
    let header = Header::new(vector.array("nonce_prefix"));
    let length = vector.integer("plaintext_length") as usize;
    let plaintext: Vec<u8> = (0..length).map(|offset| (offset % 251) as u8).collect();
    let stored = encrypt_to_vec(&file_key, header, &plaintext).unwrap();
    assert_eq!(
        stored.len() as u64,
        vector
            .field(vector.output, "stored_length")
            .as_u64()
            .unwrap(),
        "{}",
        vector.label()
    );
    assert_eq!(
        Some(stored.len() as u64),
        flare_upload::file::stored_length(length as u64)
    );
    vector.expect("stored_blake3", &blake3_hash(&stored));
    let mut decrypted = Vec::new();
    let total = decrypt_stream(&file_key, stored.as_slice(), &mut decrypted).unwrap();
    assert_eq!(total as usize, length);
    assert_eq!(decrypted, plaintext, "{}", vector.label());
}

type SealRecord = fn(&FileKey, &[u8; 24], &HeaderHash, &[u8]) -> Vec<u8>;
type OpenRecord = fn(
    &FileKey,
    &HeaderHash,
    &[u8],
) -> Result<zeroize::Zeroizing<Vec<u8>>, flare_upload::error::CryptoError>;

fn sealed_record_vector(
    vector: &Vector,
    output: &str,
    message: &[u8],
    seal_with: SealRecord,
    open_with: OpenRecord,
) {
    let file_key = vector.file_key();
    let header_hash = vector.header_hash();
    let sealed = seal_with(&file_key, &vector.array("nonce"), &header_hash, message);
    vector.expect(output, &sealed);
    assert_eq!(
        open_with(&file_key, &header_hash, &sealed)
            .unwrap()
            .as_slice(),
        message,
        "{}",
        vector.label()
    );
    let other_file = HeaderHash::from_bytes([0x5a; 32]);
    assert!(open_with(&file_key, &other_file, &sealed).is_err());
}

fn public_wrap_vector(vector: &Vector) {
    let context = vector.text("context_text");
    let associated_data = vector.bytes("associated_data");
    if vector.name.starts_with("rejects ") {
        match vector.text("direction_text") {
            "wrap" => rejected(
                vector,
                X25519PublicKey::from_bytes(vector.array("recipient_public_key")),
            ),
            "unwrap" => rejected(
                vector,
                public_unwrap(
                    &X25519PrivateKey::from_bytes(vector.array("recipient_private_key")),
                    context,
                    &associated_data,
                    &vector.bytes("stanza"),
                ),
            ),
            other => panic!("{}: direction {other}", vector.label()),
        }
        return;
    }
    let recipient = X25519PublicKey::from_bytes(vector.array("recipient_public_key")).unwrap();
    let stanza = public_wrap_with(
        &recipient,
        &EphemeralPrivateKey::from_bytes(vector.array("ephemeral_private_key")),
        context,
        &associated_data,
        &vector.bytes("secret"),
    )
    .unwrap();
    vector.expect("stanza", &stanza);
}

fn account_stanza_vector(vector: &Vector) {
    if vector.name.starts_with("rejects ") {
        match vector.text("direction_text") {
            "wrap" => rejected(
                vector,
                AccountPublicKey::from_bytes(vector.array("account_public_key")),
            ),
            "unwrap" => {
                let exchange_private_key = ed2curve_private(&vector.array("account_private_key"));
                rejected(
                    vector,
                    account_stanza_unwrap(
                        &X25519PrivateKey::from_bytes(*exchange_private_key),
                        &vector.header_hash(),
                        &vector.bytes("stanza"),
                    ),
                );
            }
            other => panic!("{}: direction {other}", vector.label()),
        }
        return;
    }
    let account_public_key =
        AccountPublicKey::from_bytes(vector.array("account_public_key")).unwrap();
    let stanza = account_stanza_with(
        &account_public_key,
        &EphemeralPrivateKey::from_bytes(vector.array("ephemeral_private_key")),
        &vector.header_hash(),
        &vector.file_key(),
    )
    .unwrap();
    vector.expect("stanza", &stanza);
    assert_eq!(stanza.len(), 96);
}

fn password_stanza_vector(vector: &Vector) {
    let header_hash = vector.header_hash();
    let link_secret = LinkSecret::from_bytes(vector.array("link_secret"));
    if vector.name.starts_with("rejects ") {
        assert_eq!(
            vector.text("direction_text"),
            "unwrap",
            "{}",
            vector.label()
        );
        rejected(
            vector,
            password_stanza_unwrap(
                vector.text("password_text"),
                &link_secret,
                &header_hash,
                &vector.bytes("stanza"),
                vector.argon2(),
            ),
        );
        return;
    }
    let file_key = vector.file_key();
    let randomness = PasswordStanzaRandomness {
        password_salt: vector.array("password_salt"),
        link_secret: link_secret.clone(),
        link_secret_nonce: vector.array("link_secret_nonce"),
    };
    let owner = AccountPublicKey::from_bytes(vector.array("owner_public_key")).unwrap();
    let (password_key, stanza) = password_stanza_with(
        vector.text("password_text"),
        &randomness,
        &owner,
        &header_hash,
        &file_key,
        vector.argon2(),
    )
    .unwrap();
    vector.expect("password_key", password_key.as_slice());
    vector.expect("stanza", &stanza);
    assert_eq!(stanza.len(), 216);
    let opened = password_stanza_unwrap(
        vector.text("password_text"),
        &link_secret,
        &header_hash,
        &stanza,
        vector.argon2(),
    )
    .unwrap();
    assert_eq!(opened.expose(), file_key.expose(), "{}", vector.label());
    // The owner reads the link secret back with the file key.
    let copy = open_sealed_link_secret(&file_key, &header_hash, &stanza).unwrap();
    assert_eq!(copy.expose(), link_secret.expose());
    // A different link secret must not open the stanza.
    let wrong = LinkSecret::from_bytes([0x11; 32]);
    assert!(password_stanza_unwrap(
        vector.text("password_text"),
        &wrong,
        &header_hash,
        &stanza,
        vector.argon2()
    )
    .is_err());
}

/// The reader of a parent folder stanza must check that the private key it
/// got gives the folder public key of the record (section 8.4.2).
fn parent_folder_stanza_unwrap(
    folder_private_key: &X25519PrivateKey,
    child_folder_public_key: &[u8; 32],
    stanza: &[u8],
) -> Result<[u8; 32], flare_upload::error::CryptoError> {
    use flare_upload::error::CryptoError;
    let secret = public_unwrap(
        folder_private_key,
        CONTEXT_PARENT_FOLDER_STANZA,
        child_folder_public_key,
        stanza,
    )?;
    let child_private_key =
        <[u8; 32]>::try_from(secret.as_slice()).map_err(|_| CryptoError::InvalidLength)?;
    if &x25519_public_key(&child_private_key) != child_folder_public_key {
        return Err(CryptoError::InvalidPublicKey);
    }
    Ok(child_private_key)
}

fn folder_stanzas_vector(vector: &Vector) {
    if vector.name.starts_with("rejects ") {
        let kind = vector.text("stanza_kind_text");
        match vector.text("direction_text") {
            "wrap" => rejected(
                vector,
                X25519PublicKey::from_bytes(vector.array("folder_public_key")),
            ),
            "unwrap" => {
                let folder_private_key =
                    X25519PrivateKey::from_bytes(vector.array("folder_private_key"));
                let stanza = vector.bytes("stanza");
                match kind {
                    "file" => rejected(
                        vector,
                        folder_file_stanza_unwrap(
                            &folder_private_key,
                            &vector.header_hash(),
                            &stanza,
                        ),
                    ),
                    "link_secret" => rejected(
                        vector,
                        folder_link_secret_stanza_unwrap(
                            &folder_private_key,
                            &vector.header_hash(),
                            &stanza,
                        ),
                    ),
                    "parent" => rejected(
                        vector,
                        parent_folder_stanza_unwrap(
                            &folder_private_key,
                            &vector.array("child_folder_public_key"),
                            &stanza,
                        ),
                    ),
                    other => panic!("{}: kind {other}", vector.label()),
                }
            }
            other => panic!("{}: direction {other}", vector.label()),
        }
        return;
    }
    let folder_public_key = X25519PublicKey::from_bytes(vector.array("folder_public_key")).unwrap();
    let header_hash = vector.header_hash();
    let file_stanza = folder_file_stanza_with(
        &folder_public_key,
        &EphemeralPrivateKey::from_bytes(vector.array("file_ephemeral_private_key")),
        &header_hash,
        &vector.file_key(),
    )
    .unwrap();
    vector.expect("folder_file_stanza", &file_stanza);
    let link_secret_stanza = folder_link_secret_stanza_with(
        &folder_public_key,
        &EphemeralPrivateKey::from_bytes(vector.array("link_secret_ephemeral_private_key")),
        &header_hash,
        &LinkSecret::from_bytes(vector.array("link_secret")),
    )
    .unwrap();
    vector.expect("folder_link_secret_stanza", &link_secret_stanza);
    let child_folder_public_key: [u8; 32] = vector.array("child_folder_public_key");
    let parent_stanza = public_wrap_with(
        &folder_public_key,
        &EphemeralPrivateKey::from_bytes(vector.array("parent_ephemeral_private_key")),
        CONTEXT_PARENT_FOLDER_STANZA,
        &child_folder_public_key,
        &vector.bytes("child_folder_private_key"),
    )
    .unwrap();
    vector.expect("parent_folder_stanza", &parent_stanza);
}

fn encode_record_vector(vector: &Vector) {
    let record = vector.bytes("record");
    let stored_record = encode_record(&record);
    vector.expect("stored_record", &stored_record);
    assert_eq!(decode_record(&stored_record).unwrap(), record.as_slice());
    let mut later_version = stored_record.clone();
    later_version[0] = 0x02;
    assert!(decode_record(&later_version).is_err());
}

/// The part of `account_keys` that a script client performs: the
/// conversion of the account public key (section 4.1). The conversion of
/// the private key is in the library for the tests only. The mnemonic and
/// the Ed25519 key generation are not performed; ed25519-dalek, a test
/// dependency, checks that the vector is consistent.
fn account_keys_vector(vector: &Vector) {
    let account_private_key = hex_decode(vector.expected("account_private_key")).unwrap();
    let account_public_key = hex_decode(vector.expected("account_public_key")).unwrap();
    let seed = <[u8; 32]>::try_from(account_private_key.as_slice()).unwrap();
    let public = <[u8; 32]>::try_from(account_public_key.as_slice()).unwrap();
    assert_eq!(
        ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes(),
        public,
        "{}",
        vector.label()
    );
    vector.expect("exchange_public_key", &ed2curve_public(&public).unwrap());
    vector.expect("exchange_private_key", ed2curve_private(&seed).as_slice());
    // The two conversions agree: the X25519 public key of the converted
    // private key is the converted public key.
    assert_eq!(
        x25519_public_key(&ed2curve_private(&seed)),
        ed2curve_public(&public).unwrap()
    );
}

#[test]
fn every_vector_of_every_implemented_procedure() {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../lib/e2ee/vectors/v1.json"
    );
    let text = std::fs::read_to_string(path).expect("lib/e2ee/vectors/v1.json");
    let document: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(document["protocol_version"], 1);
    assert_eq!(u64::from(flare_upload::PROTOCOL_VERSION), 1);
    let vectors = document["vectors"].as_array().unwrap();
    let mut checked: BTreeMap<&str, usize> = BTreeMap::new();
    let mut skipped: BTreeMap<&str, usize> = BTreeMap::new();
    for entry in vectors {
        let vector = Vector {
            procedure: entry["procedure"].as_str().unwrap(),
            name: entry["name"].as_str().unwrap(),
            input: &entry["input"],
            output: &entry["output"],
        };
        match vector.procedure {
            "blake3_derive_key" => blake3_derive_key_vector(&vector),
            "blake3_keyed_hash" => blake3_keyed_hash_vector(&vector),
            "seal" => seal_vector(&vector),
            "account_keys" => account_keys_vector(&vector),
            "file_keys" => file_keys_vector(&vector),
            "header" => header_vector(&vector),
            "file_chunk" => file_chunk_vector(&vector),
            "file" => file_vector(&vector),
            "sealed_metadata" => sealed_record_vector(
                &vector,
                "sealed_metadata",
                vector.text("file_metadata_text").as_bytes(),
                sealed_metadata_with,
                open_sealed_metadata,
            ),
            // `ocr_text` is UTF-8 text, not hexadecimal (SCHEMA.md).
            "sealed_ocr_text" => sealed_record_vector(
                &vector,
                "sealed_ocr_text",
                vector.text("ocr_text").as_bytes(),
                sealed_ocr_text_with,
                open_sealed_ocr_text,
            ),
            "sealed_thumbnail" => sealed_record_vector(
                &vector,
                "sealed_thumbnail",
                &vector.bytes("thumbnail"),
                sealed_thumbnail_with,
                open_sealed_thumbnail,
            ),
            "public_wrap" => public_wrap_vector(&vector),
            "account_stanza" => account_stanza_vector(&vector),
            "password_stanza" => password_stanza_vector(&vector),
            "folder_stanzas" => folder_stanzas_vector(&vector),
            "encode_record" => encode_record_vector(&vector),
            other => {
                assert!(
                    SKIPPED.iter().any(|(procedure, _)| *procedure == other),
                    "the procedure {other} is not implemented and not in the skipped list"
                );
                *skipped.entry(vector.procedure).or_default() += 1;
                continue;
            }
        }
        *checked.entry(vector.procedure).or_default() += 1;
    }
    let total_checked: usize = checked.values().sum();
    let total_skipped: usize = skipped.values().sum();
    println!(
        "checked {total_checked} vectors of {} procedures:",
        checked.len()
    );
    for (procedure, count) in &checked {
        println!("  {procedure}: {count}");
    }
    println!(
        "skipped {total_skipped} vectors of {} procedures:",
        skipped.len()
    );
    for (procedure, count) in &skipped {
        let reason = SKIPPED
            .iter()
            .find(|(name, _)| name == procedure)
            .map(|(_, reason)| *reason)
            .unwrap_or_default();
        println!("  {procedure}: {count} ({reason})");
    }
    assert_eq!(total_checked + total_skipped, vectors.len());
    // The counts are fixed, so a vector that stops being checked is noticed.
    for procedure in [
        "blake3_derive_key",
        "blake3_keyed_hash",
        "seal",
        "account_keys",
        "file_keys",
        "header",
        "file_chunk",
        "file",
        "sealed_metadata",
        "sealed_ocr_text",
        "sealed_thumbnail",
        "public_wrap",
        "account_stanza",
        "password_stanza",
        "folder_stanzas",
        "encode_record",
    ] {
        assert!(
            checked.get(procedure).copied().unwrap_or(0) >= 2,
            "{procedure}"
        );
    }
    assert_eq!(
        vectors.len(),
        137,
        "the vector file changed: review this test"
    );
    assert_eq!(total_checked, 100);
    assert_eq!(total_skipped, 37);
}
