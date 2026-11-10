//! The primitives of section 4: BLAKE3 in three modes, XChaCha20, `seal`,
//! `open`, `seal_once`, `open_once`, and the text encodings of rule 14.

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chacha20::cipher::{KeyIvInit, StreamCipher};
use chacha20::XChaCha20;
use subtle::ConstantTimeEq;
use zeroize::Zeroizing;

use crate::error::CryptoError;

pub const KEY_LENGTH: usize = 32;
pub const NONCE_LENGTH: usize = 24;
pub const TAG_LENGTH: usize = 32;
/// `nonce || tag`: the smallest sealed box (section 4.2).
pub const SEAL_OVERHEAD: usize = NONCE_LENGTH + TAG_LENGTH;

pub const CONTEXT_SEAL_CIPHER: &str = "flare e2ee v1 seal cipher";
pub const CONTEXT_SEAL_MAC: &str = "flare e2ee v1 seal mac";
pub const CONTEXT_ONE_TIME_NONCE: &str = "flare e2ee v1 one-time nonce";

/// `blake3_hash(message)`.
pub fn blake3_hash(message: &[u8]) -> [u8; 32] {
    *blake3::hash(message).as_bytes()
}

/// `blake3_keyed_hash(key, message)`.
pub fn blake3_keyed_hash(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    *blake3::keyed_hash(key, message).as_bytes()
}

/// `blake3_derive_key(context, key_material)`. The result is a secret, so
/// it is erased when it is dropped.
pub fn blake3_derive_key(context: &str, key_material: &[u8]) -> Zeroizing<[u8; 32]> {
    Zeroizing::new(blake3::derive_key(context, key_material))
}

/// `XChaCha20(key, nonce, data)` in place. The block counter starts at 0
/// (section 4.4, rule 4).
pub fn xchacha20(key: &[u8; 32], nonce: &[u8; 24], data: &mut [u8]) {
    let mut cipher = XChaCha20::new(key.into(), nonce.into());
    cipher.apply_keystream(data);
}

/// Compares two byte strings in constant time for equal lengths.
pub fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && bool::from(left.ct_eq(right))
}

fn seal_tag(
    mac_key: &[u8; 32],
    associated_data: &[u8],
    nonce: &[u8; 24],
    ciphertext: &[u8],
) -> [u8; 32] {
    let mut hasher = blake3::Hasher::new_keyed(mac_key);
    hasher.update(&(associated_data.len() as u64).to_le_bytes());
    hasher.update(associated_data);
    hasher.update(nonce);
    hasher.update(ciphertext);
    *hasher.finalize().as_bytes()
}

/// `seal(key, nonce, associated_data, message)`: `nonce || ciphertext || tag`.
pub fn seal(key: &[u8; 32], nonce: &[u8; 24], associated_data: &[u8], message: &[u8]) -> Vec<u8> {
    let cipher_key = blake3_derive_key(CONTEXT_SEAL_CIPHER, key);
    let mac_key = blake3_derive_key(CONTEXT_SEAL_MAC, key);
    let mut sealed_box = Vec::with_capacity(SEAL_OVERHEAD + message.len());
    sealed_box.extend_from_slice(nonce);
    sealed_box.extend_from_slice(message);
    xchacha20(&cipher_key, nonce, &mut sealed_box[NONCE_LENGTH..]);
    let tag = seal_tag(
        &mac_key,
        associated_data,
        nonce,
        &sealed_box[NONCE_LENGTH..],
    );
    sealed_box.extend_from_slice(&tag);
    sealed_box
}

/// `open(key, associated_data, sealed_box)`. The output is erased on drop.
pub fn open(
    key: &[u8; 32],
    associated_data: &[u8],
    sealed_box: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if sealed_box.len() < SEAL_OVERHEAD {
        return Err(CryptoError::Authentication);
    }
    let (nonce, rest) = sealed_box.split_at(NONCE_LENGTH);
    let (ciphertext, tag) = rest.split_at(rest.len() - TAG_LENGTH);
    let nonce: &[u8; 24] = nonce.try_into().map_err(|_| CryptoError::InvalidLength)?;
    let cipher_key = blake3_derive_key(CONTEXT_SEAL_CIPHER, key);
    let mac_key = blake3_derive_key(CONTEXT_SEAL_MAC, key);
    let expected_tag = seal_tag(&mac_key, associated_data, nonce, ciphertext);
    if !constant_time_eq(&expected_tag, tag) {
        return Err(CryptoError::Authentication);
    }
    let mut message = Zeroizing::new(ciphertext.to_vec());
    xchacha20(&cipher_key, nonce, &mut message);
    Ok(message)
}

fn one_time_nonce(key: &[u8; 32]) -> [u8; 24] {
    let derived = blake3_derive_key(CONTEXT_ONE_TIME_NONCE, key);
    let mut nonce = [0u8; 24];
    nonce.copy_from_slice(&derived[..NONCE_LENGTH]);
    nonce
}

/// `seal_once(key, associated_data, message)`: `ciphertext || tag`. The
/// caller must never use it two times with one key (section 4.2.1).
pub fn seal_once(key: &[u8; 32], associated_data: &[u8], message: &[u8]) -> Vec<u8> {
    let nonce = one_time_nonce(key);
    let mut sealed_box = seal(key, &nonce, associated_data, message);
    sealed_box.drain(..NONCE_LENGTH);
    sealed_box
}

/// `open_once(key, associated_data, sealed_once_box)`.
pub fn open_once(
    key: &[u8; 32],
    associated_data: &[u8],
    sealed_once_box: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if sealed_once_box.len() < TAG_LENGTH {
        return Err(CryptoError::Authentication);
    }
    let mut sealed_box = Vec::with_capacity(NONCE_LENGTH + sealed_once_box.len());
    sealed_box.extend_from_slice(&one_time_nonce(key));
    sealed_box.extend_from_slice(sealed_once_box);
    open(key, associated_data, &sealed_box)
}

/// `random(n)` from the operating system.
pub fn random_bytes<const N: usize>() -> Result<[u8; N], std::io::Error> {
    let mut bytes = [0u8; N];
    getrandom::fill(&mut bytes)
        .map_err(|_| std::io::Error::other("the operating system gave no random bytes"))?;
    Ok(bytes)
}

/// `base64url(a)` without padding.
pub fn base64url_encode(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Decodes base64url without padding. Padding and other alphabets are rejected.
pub fn base64url_decode(text: &str) -> Result<Vec<u8>, CryptoError> {
    URL_SAFE_NO_PAD
        .decode(text.as_bytes())
        .map_err(|_| CryptoError::Encoding)
}

/// Decodes exactly 32 bytes of base64url.
pub fn base64url_decode_32(text: &str) -> Result<[u8; 32], CryptoError> {
    let bytes = Zeroizing::new(base64url_decode(text)?);
    <[u8; 32]>::try_from(bytes.as_slice()).map_err(|_| CryptoError::InvalidLength)
}

/// Lower case hexadecimal, as the test vectors use.
pub fn hex_encode(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        text.push(DIGITS[(byte >> 4) as usize] as char);
        text.push(DIGITS[(byte & 15) as usize] as char);
    }
    text
}

/// Decodes hexadecimal of either case.
pub fn hex_decode(text: &str) -> Result<Vec<u8>, CryptoError> {
    let digits = text.as_bytes();
    if !digits.len().is_multiple_of(2) {
        return Err(CryptoError::Encoding);
    }
    let value = |digit: u8| match digit {
        b'0'..=b'9' => Ok(digit - b'0'),
        b'a'..=b'f' => Ok(digit - b'a' + 10),
        b'A'..=b'F' => Ok(digit - b'A' + 10),
        _ => Err(CryptoError::Encoding),
    };
    digits
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| Ok(value(pair[0])? << 4 | value(pair[1])?))
        .collect()
}
