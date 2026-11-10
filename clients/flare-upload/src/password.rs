//! The password stanza of section 8.2 and Argon2id with the fixed
//! parameters of section 4.3.

use argon2::{Algorithm, Argon2, Params, Version};
use unicode_normalization::UnicodeNormalization;
use zeroize::Zeroizing;

use crate::error::CryptoError;
use crate::keys::{AccountPublicKey, FileKey, HeaderHash, LinkSecret};
use crate::primitives::{blake3_derive_key, open, open_once, random_bytes, seal, seal_once};

pub const CONTEXT_PASSWORD_STANZA: &str = "flare e2ee v1 password stanza";
pub const CONTEXT_LINK_SECRET_COPY: &str = "flare e2ee v1 link secret copy";

/// `password_salt || owner_public_key || wrapped_file_key || sealed_link_secret`.
pub const PASSWORD_STANZA_LENGTH: usize = 32 + 32 + 64 + 88;

/// The Argon2id cost. Protocol version 1 has one set (section 4.3). The
/// test vectors also use a small set so that most of them are fast.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Argon2Parameters {
    pub memory_kib: u32,
    pub passes: u32,
    pub lanes: u32,
}

impl Argon2Parameters {
    /// 64 MiB, 3 passes, 4 lanes. The only set that the program uses.
    pub const PROTOCOL_V1: Self = Self {
        memory_kib: 65536,
        passes: 3,
        lanes: 4,
    };
}

/// NFKC, then UTF-8. Spaces are not removed (section 4.4, rule 5).
pub fn normalize_password(password: &str) -> Zeroizing<String> {
    Zeroizing::new(password.nfkc().collect())
}

/// `Argon2id(password, salt)`: version `0x13`, no secret value, no
/// associated data, 32 bytes of output (section 4.4, rule 6).
pub fn argon2id(
    password: &str,
    salt: &[u8; 32],
    parameters: Argon2Parameters,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let params = Params::new(
        parameters.memory_kib,
        parameters.passes,
        parameters.lanes,
        Some(32),
    )
    .map_err(|_| CryptoError::Argon2)?;
    let normalized = normalize_password(password);
    let mut output = Zeroizing::new([0u8; 32]);
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(normalized.as_bytes(), salt, output.as_mut_slice())
        .map_err(|_| CryptoError::Argon2)?;
    Ok(output)
}

/// The random inputs of the wrap procedure.
pub struct PasswordStanzaRandomness {
    pub password_salt: [u8; 32],
    pub link_secret: LinkSecret,
    pub link_secret_nonce: [u8; 24],
}

impl PasswordStanzaRandomness {
    pub fn random() -> Result<Self, std::io::Error> {
        Ok(Self {
            password_salt: random_bytes()?,
            link_secret: LinkSecret::random()?,
            link_secret_nonce: random_bytes()?,
        })
    }
}

fn password_key(
    stretched_password: &[u8; 32],
    link_secret: &LinkSecret,
    owner_public_key: &[u8; 32],
    header_hash: &HeaderHash,
) -> Zeroizing<[u8; 32]> {
    let mut key_material = Zeroizing::new([0u8; 128]);
    key_material[..32].copy_from_slice(stretched_password);
    key_material[32..64].copy_from_slice(link_secret.expose());
    key_material[64..96].copy_from_slice(owner_public_key);
    key_material[96..].copy_from_slice(header_hash.as_bytes());
    blake3_derive_key(CONTEXT_PASSWORD_STANZA, key_material.as_slice())
}

/// The wrap procedure of section 8.2 with each random value as a parameter.
/// Returns `password_key` and the stanza. The share link carries
/// `randomness.link_secret`.
pub fn password_stanza_with(
    password: &str,
    randomness: &PasswordStanzaRandomness,
    owner_public_key: &AccountPublicKey,
    header_hash: &HeaderHash,
    file_key: &FileKey,
    parameters: Argon2Parameters,
) -> Result<(Zeroizing<[u8; 32]>, Vec<u8>), CryptoError> {
    let stretched_password = argon2id(password, &randomness.password_salt, parameters)?;
    let key = password_key(
        &stretched_password,
        &randomness.link_secret,
        owner_public_key.as_bytes(),
        header_hash,
    );
    let wrapped_file_key = seal_once(&key, header_hash.as_bytes(), file_key.expose());
    let link_secret_key = blake3_derive_key(CONTEXT_LINK_SECRET_COPY, file_key.expose());
    let sealed_link_secret = seal(
        &link_secret_key,
        &randomness.link_secret_nonce,
        header_hash.as_bytes(),
        randomness.link_secret.expose(),
    );
    let mut stanza = Vec::with_capacity(PASSWORD_STANZA_LENGTH);
    stanza.extend_from_slice(&randomness.password_salt);
    stanza.extend_from_slice(owner_public_key.as_bytes());
    stanza.extend_from_slice(&wrapped_file_key);
    stanza.extend_from_slice(&sealed_link_secret);
    Ok((key, stanza))
}

/// The wrap procedure with new random values and the parameters of
/// protocol version 1. Returns the stanza and the `link_secret` for the link.
pub fn password_stanza(
    password: &str,
    owner_public_key: &AccountPublicKey,
    header_hash: &HeaderHash,
    file_key: &FileKey,
) -> Result<(Vec<u8>, LinkSecret), std::io::Error> {
    let randomness = PasswordStanzaRandomness::random()?;
    let (_, stanza) = password_stanza_with(
        password,
        &randomness,
        owner_public_key,
        header_hash,
        file_key,
        Argon2Parameters::PROTOCOL_V1,
    )
    .map_err(std::io::Error::other)?;
    Ok((stanza, randomness.link_secret.clone()))
}

/// The unwrap procedure of section 8.2.
pub fn password_stanza_unwrap(
    password: &str,
    link_secret: &LinkSecret,
    header_hash: &HeaderHash,
    stanza: &[u8],
    parameters: Argon2Parameters,
) -> Result<FileKey, CryptoError> {
    if stanza.len() != PASSWORD_STANZA_LENGTH {
        return Err(CryptoError::InvalidLength);
    }
    let password_salt: [u8; 32] = stanza[..32]
        .try_into()
        .map_err(|_| CryptoError::InvalidLength)?;
    let owner_public_key: [u8; 32] = stanza[32..64]
        .try_into()
        .map_err(|_| CryptoError::InvalidLength)?;
    let stretched_password = argon2id(password, &password_salt, parameters)?;
    let key = password_key(
        &stretched_password,
        link_secret,
        &owner_public_key,
        header_hash,
    );
    let file_key = open_once(&key, header_hash.as_bytes(), &stanza[64..128])?;
    FileKey::from_slice(&file_key)
}

/// The owner has `file_key` and reads `link_secret` back from the stanza.
pub fn open_sealed_link_secret(
    file_key: &FileKey,
    header_hash: &HeaderHash,
    stanza: &[u8],
) -> Result<LinkSecret, CryptoError> {
    if stanza.len() != PASSWORD_STANZA_LENGTH {
        return Err(CryptoError::InvalidLength);
    }
    let link_secret_key = blake3_derive_key(CONTEXT_LINK_SECRET_COPY, file_key.expose());
    let link_secret = open(&link_secret_key, header_hash.as_bytes(), &stanza[128..])?;
    LinkSecret::from_slice(&link_secret)
}

/// A reason to warn about a password, or `None`.
///
/// This is a simple test, not zxcvbn. The browser application enforces the
/// strength rule of section 5.2.1. This program only warns.
pub fn password_weakness(password: &str) -> Option<&'static str> {
    let normalized = normalize_password(password);
    let characters: Vec<char> = normalized.chars().collect();
    if characters.len() < 12 {
        return Some("it has fewer than 12 characters");
    }
    let mut distinct = characters.clone();
    distinct.sort_unstable();
    distinct.dedup();
    if distinct.len() < 6 {
        return Some("it repeats a few characters");
    }
    let digits_only = characters
        .iter()
        .all(|character| character.is_ascii_digit());
    if digits_only {
        return Some("it has digits only");
    }
    let sequential = characters
        .windows(2)
        .all(|pair| (pair[1] as i64 - pair[0] as i64).abs() <= 1);
    if sequential {
        return Some("it is a sequence");
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weakness_warnings() {
        assert!(password_weakness("short").is_some());
        assert!(password_weakness("aaaaaaaaaaaaaaaa").is_some());
        assert!(password_weakness("12345678901234567890").is_some());
        assert!(password_weakness("abcdefghijklmnop").is_some());
        assert!(password_weakness("correct horse battery staple").is_none());
    }

    #[test]
    fn nfkc_keeps_spaces() {
        assert_eq!(normalize_password(" \u{ff41}b ").as_str(), " ab ");
    }
}
