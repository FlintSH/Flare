//! `public_wrap` and `public_unwrap` (section 8.4.1), the account stanza
//! (section 8.1) and the folder stanzas of a file (section 8.4.3).

use x25519_dalek::{x25519, X25519_BASEPOINT_BYTES};
use zeroize::Zeroizing;

use crate::error::CryptoError;
use crate::keys::{
    AccountPublicKey, EphemeralPrivateKey, FileKey, HeaderHash, LinkSecret, X25519PrivateKey,
    X25519PublicKey,
};
use crate::primitives::{blake3_derive_key, constant_time_eq, open_once, seal_once};

pub const CONTEXT_ACCOUNT_STANZA: &str = "flare e2ee v1 account stanza";
pub const CONTEXT_FOLDER_FILE_STANZA: &str = "flare e2ee v1 folder file stanza";
pub const CONTEXT_FOLDER_LINK_SECRET_STANZA: &str = "flare e2ee v1 folder link secret stanza";

/// `ephemeral_public_key || seal_once(...)` of a 32-byte secret.
pub const KEY_STANZA_LENGTH: usize = 96;

/// The public key of an X25519 private key. The function clamps a copy.
pub fn x25519_public_key(private_key: &[u8; 32]) -> [u8; 32] {
    x25519(*private_key, X25519_BASEPOINT_BYTES)
}

/// `X25519(private_key, public_key)`. Rejects the all-zero result.
fn shared_secret(
    private_key: &[u8; 32],
    public_key: &X25519PublicKey,
) -> Result<Zeroizing<[u8; 32]>, CryptoError> {
    let secret = Zeroizing::new(x25519(*private_key, *public_key.as_bytes()));
    if constant_time_eq(secret.as_slice(), &[0u8; 32]) {
        return Err(CryptoError::ZeroSharedSecret);
    }
    Ok(secret)
}

fn stanza_key(
    context: &str,
    shared_secret: &[u8; 32],
    ephemeral_public_key: &[u8; 32],
    recipient_public_key: &[u8; 32],
) -> Zeroizing<[u8; 32]> {
    let mut key_material = Zeroizing::new([0u8; 96]);
    key_material[..32].copy_from_slice(shared_secret);
    key_material[32..64].copy_from_slice(ephemeral_public_key);
    key_material[64..].copy_from_slice(recipient_public_key);
    blake3_derive_key(context, key_material.as_slice())
}

/// `public_wrap(recipient_public_key, context, associated_data, secret)`
/// with the ephemeral private key as a parameter. The type of
/// `recipient_public_key` proves step 1: the key is canonical.
///
/// A caller must not use one ephemeral key for two stanzas.
pub fn public_wrap_with(
    recipient_public_key: &X25519PublicKey,
    ephemeral_private_key: &EphemeralPrivateKey,
    context: &str,
    associated_data: &[u8],
    secret: &[u8],
) -> Result<Vec<u8>, CryptoError> {
    let ephemeral_public_key = x25519_public_key(ephemeral_private_key.expose());
    let shared = shared_secret(ephemeral_private_key.expose(), recipient_public_key)?;
    let key = stanza_key(
        context,
        &shared,
        &ephemeral_public_key,
        recipient_public_key.as_bytes(),
    );
    let mut stanza = Vec::with_capacity(32 + secret.len() + 32);
    stanza.extend_from_slice(&ephemeral_public_key);
    stanza.extend_from_slice(&seal_once(&key, associated_data, secret));
    Ok(stanza)
}

/// `public_wrap` with a new random ephemeral key pair.
pub fn public_wrap(
    recipient_public_key: &X25519PublicKey,
    context: &str,
    associated_data: &[u8],
    secret: &[u8],
) -> Result<Vec<u8>, std::io::Error> {
    let ephemeral_private_key = EphemeralPrivateKey::random()?;
    public_wrap_with(
        recipient_public_key,
        &ephemeral_private_key,
        context,
        associated_data,
        secret,
    )
    .map_err(std::io::Error::other)
}

/// `public_unwrap(recipient_private_key, context, associated_data, stanza)`.
pub fn public_unwrap(
    recipient_private_key: &X25519PrivateKey,
    context: &str,
    associated_data: &[u8],
    stanza: &[u8],
) -> Result<Zeroizing<Vec<u8>>, CryptoError> {
    if stanza.len() < 32 {
        return Err(CryptoError::InvalidLength);
    }
    let (ephemeral_public_key, sealed) = stanza.split_at(32);
    let ephemeral_public_key = X25519PublicKey::from_slice(ephemeral_public_key)?;
    let recipient_public_key = x25519_public_key(recipient_private_key.expose());
    let shared = shared_secret(recipient_private_key.expose(), &ephemeral_public_key)?;
    let key = stanza_key(
        context,
        &shared,
        ephemeral_public_key.as_bytes(),
        &recipient_public_key,
    );
    open_once(&key, associated_data, sealed)
}

fn key_from_unwrap(secret: Zeroizing<Vec<u8>>) -> Result<[u8; 32], CryptoError> {
    <[u8; 32]>::try_from(secret.as_slice()).map_err(|_| CryptoError::InvalidLength)
}

/// The account stanza (section 8.1) with a given ephemeral private key.
pub fn account_stanza_with(
    account_public_key: &AccountPublicKey,
    ephemeral_private_key: &EphemeralPrivateKey,
    header_hash: &HeaderHash,
    file_key: &FileKey,
) -> Result<Vec<u8>, CryptoError> {
    public_wrap_with(
        &account_public_key.exchange_public_key()?,
        ephemeral_private_key,
        CONTEXT_ACCOUNT_STANZA,
        header_hash.as_bytes(),
        file_key.expose(),
    )
}

/// The account stanza with a new random ephemeral key pair.
pub fn account_stanza(
    account_public_key: &AccountPublicKey,
    header_hash: &HeaderHash,
    file_key: &FileKey,
) -> Result<Vec<u8>, std::io::Error> {
    account_stanza_with(
        account_public_key,
        &EphemeralPrivateKey::random()?,
        header_hash,
        file_key,
    )
    .map_err(std::io::Error::other)
}

/// Opens an account stanza with `exchange_private_key`.
pub fn account_stanza_unwrap(
    exchange_private_key: &X25519PrivateKey,
    header_hash: &HeaderHash,
    stanza: &[u8],
) -> Result<FileKey, CryptoError> {
    if stanza.len() != KEY_STANZA_LENGTH {
        return Err(CryptoError::InvalidLength);
    }
    let secret = public_unwrap(
        exchange_private_key,
        CONTEXT_ACCOUNT_STANZA,
        header_hash.as_bytes(),
        stanza,
    )?;
    Ok(FileKey::from_bytes(key_from_unwrap(secret)?))
}

/// `folder_file_stanza` (section 8.4.3) with a given ephemeral private key.
pub fn folder_file_stanza_with(
    folder_public_key: &X25519PublicKey,
    ephemeral_private_key: &EphemeralPrivateKey,
    header_hash: &HeaderHash,
    file_key: &FileKey,
) -> Result<Vec<u8>, CryptoError> {
    public_wrap_with(
        folder_public_key,
        ephemeral_private_key,
        CONTEXT_FOLDER_FILE_STANZA,
        header_hash.as_bytes(),
        file_key.expose(),
    )
}

/// `folder_file_stanza` with a new random ephemeral key pair.
pub fn folder_file_stanza(
    folder_public_key: &X25519PublicKey,
    header_hash: &HeaderHash,
    file_key: &FileKey,
) -> Result<Vec<u8>, std::io::Error> {
    folder_file_stanza_with(
        folder_public_key,
        &EphemeralPrivateKey::random()?,
        header_hash,
        file_key,
    )
    .map_err(std::io::Error::other)
}

pub fn folder_file_stanza_unwrap(
    folder_private_key: &X25519PrivateKey,
    header_hash: &HeaderHash,
    stanza: &[u8],
) -> Result<FileKey, CryptoError> {
    if stanza.len() != KEY_STANZA_LENGTH {
        return Err(CryptoError::InvalidLength);
    }
    let secret = public_unwrap(
        folder_private_key,
        CONTEXT_FOLDER_FILE_STANZA,
        header_hash.as_bytes(),
        stanza,
    )?;
    Ok(FileKey::from_bytes(key_from_unwrap(secret)?))
}

/// `folder_link_secret_stanza` (section 8.4.3) with a given ephemeral
/// private key. A file with a password stanza gets this stanza and no
/// folder stanza for `file_key`.
pub fn folder_link_secret_stanza_with(
    folder_public_key: &X25519PublicKey,
    ephemeral_private_key: &EphemeralPrivateKey,
    header_hash: &HeaderHash,
    link_secret: &LinkSecret,
) -> Result<Vec<u8>, CryptoError> {
    public_wrap_with(
        folder_public_key,
        ephemeral_private_key,
        CONTEXT_FOLDER_LINK_SECRET_STANZA,
        header_hash.as_bytes(),
        link_secret.expose(),
    )
}

/// `folder_link_secret_stanza` with a new random ephemeral key pair.
pub fn folder_link_secret_stanza(
    folder_public_key: &X25519PublicKey,
    header_hash: &HeaderHash,
    link_secret: &LinkSecret,
) -> Result<Vec<u8>, std::io::Error> {
    folder_link_secret_stanza_with(
        folder_public_key,
        &EphemeralPrivateKey::random()?,
        header_hash,
        link_secret,
    )
    .map_err(std::io::Error::other)
}

pub fn folder_link_secret_stanza_unwrap(
    folder_private_key: &X25519PrivateKey,
    header_hash: &HeaderHash,
    stanza: &[u8],
) -> Result<LinkSecret, CryptoError> {
    if stanza.len() != KEY_STANZA_LENGTH {
        return Err(CryptoError::InvalidLength);
    }
    let secret = public_unwrap(
        folder_private_key,
        CONTEXT_FOLDER_LINK_SECRET_STANZA,
        header_hash.as_bytes(),
        stanza,
    )?;
    Ok(LinkSecret::from_bytes(key_from_unwrap(secret)?))
}
