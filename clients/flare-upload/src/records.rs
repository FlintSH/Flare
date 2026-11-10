//! Sealed records that the server stores next to a file: `sealed_metadata`
//! (section 9.1), `sealed_ocr_text` (section 9.6.1), `sealed_thumbnail`
//! (section 12.1), and the `record_version` byte (section 4.4, rule 12).

use zeroize::Zeroizing;

use crate::error::CryptoError;
use crate::keys::{FileKey, HeaderHash};
use crate::primitives::{blake3_derive_key, open, random_bytes, seal};

pub const RECORD_VERSION: u8 = 0x01;

pub const CONTEXT_FILE_METADATA: &str = "flare e2ee v1 file metadata";
pub const CONTEXT_OCR_TEXT: &str = "flare e2ee v1 ocr text";
pub const CONTEXT_THUMBNAIL: &str = "flare e2ee v1 thumbnail";

/// `0x01 || record`: the form in which a client sends a stanza or a sealed
/// value. The byte is not an input of `seal` or of `public_wrap`.
pub fn encode_record(record: &[u8]) -> Vec<u8> {
    let mut stored_record = Vec::with_capacity(1 + record.len());
    stored_record.push(RECORD_VERSION);
    stored_record.extend_from_slice(record);
    stored_record
}

/// Removes the `record_version` byte. A version that this program does not
/// know stops the procedure (section 1.5.2, rule 3).
pub fn decode_record(stored_record: &[u8]) -> Result<&[u8], CryptoError> {
    match stored_record.split_first() {
        Some((&RECORD_VERSION, record)) => Ok(record),
        Some(_) => Err(CryptoError::UnknownVersion),
        None => Err(CryptoError::InvalidLength),
    }
}

/// The JSON text of `file_metadata`: an object with `name` and `type`.
pub fn file_metadata_json(name: &str, mime_type: &str) -> String {
    serde_json::json!({ "name": name, "type": mime_type }).to_string()
}

fn seal_for_file(
    context: &str,
    file_key: &FileKey,
    nonce: &[u8; 24],
    header_hash: &HeaderHash,
    message: &[u8],
) -> Vec<u8> {
    let key = blake3_derive_key(context, file_key.expose());
    seal(&key, nonce, header_hash.as_bytes(), message)
}

fn open_for_file(
    context: &str,
    file_key: &FileKey,
    header_hash: &HeaderHash,
    sealed_box: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    let key = blake3_derive_key(context, file_key.expose());
    open(&key, header_hash.as_bytes(), sealed_box)
}

/// `sealed_metadata = seal(metadata_key, nonce, header_hash, file_metadata)`.
pub fn sealed_metadata_with(
    file_key: &FileKey,
    nonce: &[u8; 24],
    header_hash: &HeaderHash,
    file_metadata: &[u8],
) -> Vec<u8> {
    seal_for_file(
        CONTEXT_FILE_METADATA,
        file_key,
        nonce,
        header_hash,
        file_metadata,
    )
}

/// `sealed_metadata` of a name and a MIME type, with a random nonce.
pub fn sealed_metadata(
    file_key: &FileKey,
    header_hash: &HeaderHash,
    name: &str,
    mime_type: &str,
) -> Result<Vec<u8>, std::io::Error> {
    Ok(sealed_metadata_with(
        file_key,
        &random_bytes()?,
        header_hash,
        file_metadata_json(name, mime_type).as_bytes(),
    ))
}

pub fn open_sealed_metadata(
    file_key: &FileKey,
    header_hash: &HeaderHash,
    sealed_metadata: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    open_for_file(
        CONTEXT_FILE_METADATA,
        file_key,
        header_hash,
        sealed_metadata,
    )
}

/// `sealed_ocr_text = seal(ocr_text_key, nonce, header_hash, ocr_text)`.
/// The command-line program does no recognition and never sends this record.
pub fn sealed_ocr_text_with(
    file_key: &FileKey,
    nonce: &[u8; 24],
    header_hash: &HeaderHash,
    ocr_text: &[u8],
) -> Vec<u8> {
    seal_for_file(CONTEXT_OCR_TEXT, file_key, nonce, header_hash, ocr_text)
}

pub fn open_sealed_ocr_text(
    file_key: &FileKey,
    header_hash: &HeaderHash,
    sealed_ocr_text: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    open_for_file(CONTEXT_OCR_TEXT, file_key, header_hash, sealed_ocr_text)
}

/// `sealed_thumbnail = seal(thumbnail_key, nonce, header_hash, thumbnail)`.
/// The command-line program makes no thumbnail and never sends this record.
pub fn sealed_thumbnail_with(
    file_key: &FileKey,
    nonce: &[u8; 24],
    header_hash: &HeaderHash,
    thumbnail: &[u8],
) -> Vec<u8> {
    seal_for_file(CONTEXT_THUMBNAIL, file_key, nonce, header_hash, thumbnail)
}

pub fn open_sealed_thumbnail(
    file_key: &FileKey,
    header_hash: &HeaderHash,
    sealed_thumbnail: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    open_for_file(CONTEXT_THUMBNAIL, file_key, header_hash, sealed_thumbnail)
}
