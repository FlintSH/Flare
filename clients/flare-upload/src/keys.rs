//! One type for each kind of key, so that the compiler rejects a key in the
//! wrong place. Secret types erase their bytes when they are dropped and do
//! not print them.

use std::fmt;

use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::ed2curve::{ed2curve_public, is_canonical_x25519_public_key};
use crate::error::CryptoError;
use crate::primitives::{base64url_decode_32, base64url_encode, random_bytes};

macro_rules! secret_key {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Zeroize, ZeroizeOnDrop)]
        pub struct $name([u8; 32]);

        impl $name {
            pub fn from_bytes(bytes: [u8; 32]) -> Self {
                Self(bytes)
            }

            pub fn from_slice(bytes: &[u8]) -> Result<Self, CryptoError> {
                <[u8; 32]>::try_from(bytes)
                    .map(Self)
                    .map_err(|_| CryptoError::InvalidLength)
            }

            /// `random(32)`.
            pub fn random() -> Result<Self, std::io::Error> {
                Ok(Self(random_bytes()?))
            }

            /// The secret bytes. The caller must not keep or print them.
            pub fn expose(&self) -> &[u8; 32] {
                &self.0
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(concat!(stringify!($name), "(secret)"))
            }
        }
    };
}

macro_rules! public_bytes {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub struct $name([u8; 32]);

        impl $name {
            pub fn as_bytes(&self) -> &[u8; 32] {
                &self.0
            }

            pub fn to_base64url(&self) -> String {
                base64url_encode(&self.0)
            }
        }
    };
}

secret_key!(
    /// `file_key`: the random key of one file. It is in the share link.
    FileKey
);
secret_key!(
    /// `link_secret`: the secret in the share link of a file with a password.
    LinkSecret
);
secret_key!(
    /// `ephemeral_private_key`: used for one stanza and then erased.
    EphemeralPrivateKey
);
secret_key!(
    /// An X25519 private key of a recipient, as 32 bytes without clamping
    /// (section 4.4, rule 3b). Only the tests and the self-test have one.
    X25519PrivateKey
);

public_bytes!(
    /// `account_public_key`: the Ed25519 public key of an account. The
    /// constructor checks that it has an X25519 form.
    AccountPublicKey
);
public_bytes!(
    /// A canonical X25519 public key: `exchange_public_key`,
    /// `folder_public_key`, `ephemeral_public_key` or a
    /// `recipient_public_key`.
    X25519PublicKey
);
public_bytes!(
    /// `header_hash`: the BLAKE3 hash of the 26 header bytes.
    HeaderHash
);

impl AccountPublicKey {
    /// Rejects a key that `ed2curve_public` rejects (section 4.1).
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self, CryptoError> {
        ed2curve_public(&bytes)?;
        Ok(Self(bytes))
    }

    pub fn from_base64url(text: &str) -> Result<Self, CryptoError> {
        Self::from_bytes(base64url_decode_32(text)?)
    }

    /// `exchange_public_key = ed2curve_public(account_public_key)`.
    pub fn exchange_public_key(&self) -> Result<X25519PublicKey, CryptoError> {
        X25519PublicKey::from_bytes(ed2curve_public(&self.0)?)
    }
}

impl X25519PublicKey {
    /// Rejects each form that is not canonical (section 4.4, rule 3a).
    pub fn from_bytes(bytes: [u8; 32]) -> Result<Self, CryptoError> {
        if !is_canonical_x25519_public_key(&bytes) {
            return Err(CryptoError::NonCanonicalPublicKey);
        }
        Ok(Self(bytes))
    }

    pub fn from_slice(bytes: &[u8]) -> Result<Self, CryptoError> {
        Self::from_bytes(<[u8; 32]>::try_from(bytes).map_err(|_| CryptoError::InvalidLength)?)
    }

    pub fn from_base64url(text: &str) -> Result<Self, CryptoError> {
        Self::from_bytes(base64url_decode_32(text)?)
    }
}

impl HeaderHash {
    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(bytes)
    }
}
