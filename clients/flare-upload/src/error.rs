//! Errors of the cryptographic procedures. No message contains key material.

use std::fmt;

/// Why a procedure of the specification rejected its input.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CryptoError {
    /// A value does not have the length that the specification gives.
    InvalidLength,
    /// An Ed25519 public key does not decode, or has no X25519 form.
    InvalidPublicKey,
    /// An X25519 public key is not in its canonical form (section 4.4, rule 3a).
    NonCanonicalPublicKey,
    /// X25519 gave the all-zero shared secret (sections 8.1 and 8.4.1).
    ZeroSharedSecret,
    /// A tag is not correct, or a sealed box is too short.
    Authentication,
    /// The header has a wrong magic value or chunk size.
    InvalidHeader,
    /// A `format_version`, `record_version` or link prefix of a later version.
    UnknownVersion,
    /// The stored chunks do not have a form of section 7.4.
    InvalidLayout,
    /// The Argon2id parameters are not usable.
    Argon2,
    /// A text is not valid base64url or hexadecimal.
    Encoding,
    /// The source gave a different number of bytes than announced.
    LengthMismatch,
}

impl fmt::Display for CryptoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::InvalidLength => "a value has the wrong length",
            Self::InvalidPublicKey => "the public key is not valid",
            Self::NonCanonicalPublicKey => "the X25519 public key is not canonical",
            Self::ZeroSharedSecret => "the key agreement gave the all-zero secret",
            Self::Authentication => "the authentication tag is not correct",
            Self::InvalidHeader => "the file header is not valid",
            Self::UnknownVersion => "the version is not known to this program; update flare-upload",
            Self::InvalidLayout => "the encrypted file does not have a valid layout",
            Self::Argon2 => "the Argon2id operation failed",
            Self::Encoding => "the text is not valid base64url or hexadecimal",
            Self::LengthMismatch => "the file changed while it was read",
        })
    }
}

impl std::error::Error for CryptoError {}
