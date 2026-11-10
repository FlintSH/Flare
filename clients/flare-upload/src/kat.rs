//! Known answers for `flare-upload --self-test`.
//!
//! The values are copies of vectors in `lib/e2ee/vectors/v1.json`. The test
//! suite checks every vector of that file; these few travel inside the
//! program, so a user can check a downloaded binary on the machine that
//! runs it. A wrong build, a broken CPU feature path or too little memory
//! for Argon2id shows here and not as a file that nobody can open.

use crate::ed2curve::{ed2curve_private, ed2curve_public};
use crate::file::{decrypt_stream, encrypt_chunk, encrypt_to_vec, Header};
use crate::keys::{
    AccountPublicKey, EphemeralPrivateKey, FileKey, HeaderHash, LinkSecret, X25519PrivateKey,
    X25519PublicKey,
};
use crate::password::{
    password_stanza_unwrap, password_stanza_with, Argon2Parameters, PasswordStanzaRandomness,
};
use crate::primitives::{blake3_derive_key, blake3_hash, hex_decode, hex_encode, open, seal};
use crate::records::{open_sealed_metadata, sealed_metadata_with};
use crate::stanza::{account_stanza_unwrap, account_stanza_with, public_wrap_with};

const SEQUENCE_KEY: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
const NONCE_PREFIX: &str = "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const HEADER: &str = "464c4152454532450110a0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const HEADER_HASH: &str = "9a513e10dcb8baeadf68cf171e97e7db62d62bbc242a617dd55ce1a719b7d32d";
const EPHEMERAL_PRIVATE_KEY: &str =
    "707172737475767778797a7b7c7d7e7f808182838485868788898a8b8c8d8e8f";

const ACCOUNT_PRIVATE_KEY: &str =
    "ee785d63b369da7764f7eb474bdaae6da8a31e1eadb6b07615ecafbad963c03e";
const ACCOUNT_PUBLIC_KEY: &str = "da2c911a3d4a215cb131290d1fc43fac5eddea940852cf25ca0ce180f8adde1c";
const EXCHANGE_PRIVATE_KEY: &str =
    "087a410d91b9e1971dbd53b3c26a3a0cf1d9d74f1e10087d9c0b98f83d30795d";
const EXCHANGE_PUBLIC_KEY: &str =
    "ad7d6d6d81933c4e73934e15359b3cf0814dedb55d3f3c0ca58f0007020e803b";

const SEAL_NONCE: &str = "404142434445464748494a4b4c4d4e4f5051525354555657";
const SEAL_ASSOCIATED_DATA: &str =
    "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f";
const SEAL_MESSAGE: &str = "c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedf";
const SEALED_BOX: &str = "404142434445464748494a4b4c4d4e4f50515253545556571b4e701994126065035dc902857abf080f94a94ac4560a3e562aff2ea3f61af7ee7a92765e83828dcea26816bbff43c1e4d5bcd57c96276539f0d9570596d9d8";

const CHUNK_PLAINTEXT: &str = "466c617265207465737420766563746f72";
const STORED_CHUNK: &str = "4332ab7fe9a748ecc2c4831a4abce636e5a3f35c7d04d761506145039c5125ecc1bacbf45f6cfbc176c6f3e7e058f60866";

const FILE_PLAINTEXT_LENGTH: usize = 65537;
const FILE_STORED_LENGTH: usize = 65627;
const FILE_STORED_BLAKE3: &str = "777aebdb4a80b0b54948e1d5b77d39ca8129a9c9ceef6604420d9f015d9666ef";

const ACCOUNT_STANZA: &str = "23b7bb8c91ae008711fb12846780bcdf1e065f821bdfec49f57e7c7dcd4c4823811deb838296718622d02ec379e6abe20b54ef902a5160e6d895f2e745f0f01679c2f955ac119ac84db097a51fe206cdcdbf2faa535c6ba5b97c24ae38e86e97";

const METADATA_NONCE: &str = "505152535455565758595a5b5c5d5e5f6061626364656667";
const METADATA_TEXT: &str = "{\"name\":\"holiday-photo.png\",\"type\":\"image/png\"}";
const SEALED_METADATA: &str = "505152535455565758595a5b5c5d5e5f6061626364656667928abc0761eac2ee4c52ea58989f04d52e937ab29584b244dfc2e46c377e0974246f71c23453929338ef3077ebc1b27b6a724599f17f8138cd85cca1eec6470fdd96970ab1b6fa3eac44b8ad1c9c0d";

const PASSWORD: &str = "open sesame 42";
const PASSWORD_SALT: &str = "909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeaf";
const LINK_SECRET: &str = "64828c29d814b576b3346898b28d6fecae92b64a5dd9eaa324e5c0a37e275ca4";
const OWNER_PUBLIC_KEY: &str = "abddd562607c1de8b5bcb8043ac59eeab8940de9015b82298e08534ae51dc2b9";
const LINK_SECRET_NONCE: &str = "b0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c7";
const PASSWORD_KEY: &str = "7a60afded75fa8c26b704a6fa5830f5813fbc4e6c75f52f57b302dfbb305a27a";
const PASSWORD_STANZA: &str = "909192939495969798999a9b9c9d9e9fa0a1a2a3a4a5a6a7a8a9aaabacadaeafabddd562607c1de8b5bcb8043ac59eeab8940de9015b82298e08534ae51dc2b92ba7c76c874b6183e19390a222769bad48c443d2a529c6fc5af2cfa6c9cfabed2edc683d662aa91545be24f05962be17a16c75acff77f8bcc1b855996068799fb0b1b2b3b4b5b6b7b8b9babbbcbdbebfc0c1c2c3c4c5c6c77318d71f397bd70cf9e20f70a8e29f493dc4a1beaa2e6a96821689dc2666f72b8920ec2722ea394425f910675e370bc450ef860c390cd0b71fc149cc757f5fd3";

/// A recipient key with the highest bit set: not canonical (rule 3a).
const NON_CANONICAL_PUBLIC_KEY: &str =
    "33716d89597d6dd955345516a8524a281b2f3db9de4bab78aa915bdf13dac0da";

fn bytes(hex: &str) -> Vec<u8> {
    hex_decode(hex).unwrap_or_default()
}

fn array<const N: usize>(hex: &str) -> Result<[u8; N], String> {
    <[u8; N]>::try_from(bytes(hex).as_slice()).map_err(|_| "an embedded value is damaged".into())
}

fn expect(name: &str, actual: &[u8], expected_hex: &str) -> Result<(), String> {
    if hex_encode(actual) == expected_hex {
        Ok(())
    } else {
        Err(format!("{name}: the result is not the known answer"))
    }
}

type Check = (&'static str, fn() -> Result<(), String>);

fn check_blake3() -> Result<(), String> {
    let key = blake3_derive_key("flare e2ee v1 account seed", &bytes(SEQUENCE_KEY));
    expect("blake3_derive_key", key.as_slice(), ACCOUNT_PRIVATE_KEY)
}

fn check_seal() -> Result<(), String> {
    let key = array::<32>(SEQUENCE_KEY)?;
    let sealed_box = seal(
        &key,
        &array(SEAL_NONCE)?,
        &bytes(SEAL_ASSOCIATED_DATA),
        &bytes(SEAL_MESSAGE),
    );
    expect("seal", &sealed_box, SEALED_BOX)?;
    let message = open(&key, &bytes(SEAL_ASSOCIATED_DATA), &sealed_box)
        .map_err(|_| "open: a correct box did not open")?;
    expect("open", &message, SEAL_MESSAGE)?;
    let mut changed = sealed_box;
    changed[30] ^= 1;
    if open(&key, &bytes(SEAL_ASSOCIATED_DATA), &changed).is_ok() {
        return Err("open: a changed box opened".into());
    }
    Ok(())
}

fn check_header() -> Result<(), String> {
    let header = Header::new(array(NONCE_PREFIX)?);
    expect("header", header.as_bytes(), HEADER)?;
    expect("header_hash", header.hash().as_bytes(), HEADER_HASH)
}

fn check_file() -> Result<(), String> {
    let file_key = FileKey::from_bytes(array(SEQUENCE_KEY)?);
    let header = Header::new(array(NONCE_PREFIX)?);
    let chunk = encrypt_chunk(&file_key, &header, 0, true, &bytes(CHUNK_PLAINTEXT));
    expect("file_chunk", &chunk, STORED_CHUNK)?;
    let plaintext: Vec<u8> = (0..FILE_PLAINTEXT_LENGTH)
        .map(|offset| (offset % 251) as u8)
        .collect();
    let stored =
        encrypt_to_vec(&file_key, header, &plaintext).map_err(|_| "file: the encryption failed")?;
    if stored.len() != FILE_STORED_LENGTH {
        return Err("file: the stored length is not the known answer".into());
    }
    expect("file", &blake3_hash(&stored), FILE_STORED_BLAKE3)?;
    let mut decrypted = Vec::new();
    decrypt_stream(&file_key, stored.as_slice(), &mut decrypted)
        .map_err(|_| "file: a correct file did not decrypt")?;
    if decrypted != plaintext {
        return Err("file: the decrypted bytes are not the plaintext".into());
    }
    // A truncated file must not pass (section 7.4, step 5).
    let truncated = &stored[..26 + 65568];
    if decrypt_stream(&file_key, truncated, std::io::sink()).is_ok() {
        return Err("file: a truncated file decrypted".into());
    }
    Ok(())
}

fn check_key_conversion() -> Result<(), String> {
    let exchange_public_key = ed2curve_public(&array(ACCOUNT_PUBLIC_KEY)?)
        .map_err(|_| "ed2curve_public: a valid key was rejected")?;
    expect("ed2curve_public", &exchange_public_key, EXCHANGE_PUBLIC_KEY)?;
    let exchange_private_key = ed2curve_private(&array(ACCOUNT_PRIVATE_KEY)?);
    expect(
        "ed2curve_private",
        exchange_private_key.as_slice(),
        EXCHANGE_PRIVATE_KEY,
    )
}

fn check_account_stanza() -> Result<(), String> {
    let account_public_key = AccountPublicKey::from_bytes(array(ACCOUNT_PUBLIC_KEY)?)
        .map_err(|_| "account_stanza: a valid key was rejected")?;
    let header_hash = HeaderHash::from_bytes(array(HEADER_HASH)?);
    let file_key = FileKey::from_bytes(array(SEQUENCE_KEY)?);
    let stanza = account_stanza_with(
        &account_public_key,
        &EphemeralPrivateKey::from_bytes(array(EPHEMERAL_PRIVATE_KEY)?),
        &header_hash,
        &file_key,
    )
    .map_err(|_| "account_stanza: the wrap failed")?;
    expect("account_stanza", &stanza, ACCOUNT_STANZA)?;
    let opened = account_stanza_unwrap(
        &X25519PrivateKey::from_bytes(array(EXCHANGE_PRIVATE_KEY)?),
        &header_hash,
        &stanza,
    )
    .map_err(|_| "account_stanza: a correct stanza did not open")?;
    expect("account_stanza unwrap", opened.expose(), SEQUENCE_KEY)
}

fn check_canonical_keys() -> Result<(), String> {
    let bad = array::<32>(NON_CANONICAL_PUBLIC_KEY)?;
    if X25519PublicKey::from_bytes(bad).is_ok() {
        return Err("public_wrap: a public key that is not canonical was accepted".into());
    }
    let mut good = bad;
    good[31] &= 0x7f;
    let recipient = X25519PublicKey::from_bytes(good)
        .map_err(|_| "public_wrap: a canonical key was rejected")?;
    public_wrap_with(
        &recipient,
        &EphemeralPrivateKey::from_bytes(array(EPHEMERAL_PRIVATE_KEY)?),
        "flare e2ee v1 folder file stanza",
        &bytes(HEADER_HASH),
        &bytes(SEQUENCE_KEY),
    )
    .map(|_| ())
    .map_err(|_| "public_wrap: the wrap failed".into())
}

fn check_sealed_metadata() -> Result<(), String> {
    let file_key = FileKey::from_bytes(array(SEQUENCE_KEY)?);
    let header_hash = HeaderHash::from_bytes(array(HEADER_HASH)?);
    let sealed = sealed_metadata_with(
        &file_key,
        &array(METADATA_NONCE)?,
        &header_hash,
        METADATA_TEXT.as_bytes(),
    );
    expect("sealed_metadata", &sealed, SEALED_METADATA)?;
    let opened = open_sealed_metadata(&file_key, &header_hash, &sealed)
        .map_err(|_| "sealed_metadata: a correct record did not open")?;
    if opened.as_slice() != METADATA_TEXT.as_bytes() {
        return Err("sealed_metadata: the opened text is not the input".into());
    }
    Ok(())
}

/// Argon2id with the real parameters: 64 MiB, 3 passes, 4 lanes.
fn check_password_stanza() -> Result<(), String> {
    let file_key = FileKey::from_bytes(array(SEQUENCE_KEY)?);
    let header_hash = HeaderHash::from_bytes(array(HEADER_HASH)?);
    let randomness = PasswordStanzaRandomness {
        password_salt: array(PASSWORD_SALT)?,
        link_secret: LinkSecret::from_bytes(array(LINK_SECRET)?),
        link_secret_nonce: array(LINK_SECRET_NONCE)?,
    };
    let owner = AccountPublicKey::from_bytes(array(OWNER_PUBLIC_KEY)?)
        .map_err(|_| "password_stanza: a valid key was rejected")?;
    let (password_key, stanza) = password_stanza_with(
        PASSWORD,
        &randomness,
        &owner,
        &header_hash,
        &file_key,
        Argon2Parameters::PROTOCOL_V1,
    )
    .map_err(|_| "password_stanza: Argon2id failed. It needs 64 MiB of memory")?;
    expect("password_key", password_key.as_slice(), PASSWORD_KEY)?;
    expect("password_stanza", &stanza, PASSWORD_STANZA)?;
    let opened = password_stanza_unwrap(
        PASSWORD,
        &randomness.link_secret,
        &header_hash,
        &stanza,
        Argon2Parameters::PROTOCOL_V1,
    )
    .map_err(|_| "password_stanza: a correct stanza did not open")?;
    expect("password_stanza unwrap", opened.expose(), SEQUENCE_KEY)
}

const CHECKS: &[Check] = &[
    ("BLAKE3 key derivation", check_blake3),
    ("seal and open", check_seal),
    ("file header", check_header),
    ("file encryption", check_file),
    ("key conversion", check_key_conversion),
    ("account stanza", check_account_stanza),
    ("canonical public keys", check_canonical_keys),
    ("sealed metadata", check_sealed_metadata),
    ("password stanza with Argon2id", check_password_stanza),
];

/// Runs each check. The result names each check and its failure, if any.
pub fn run_self_test() -> Vec<(&'static str, Result<(), String>)> {
    CHECKS
        .iter()
        .map(|(name, check)| (*name, check()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_self_test_passes() {
        for (name, result) in run_self_test() {
            assert_eq!(result, Ok(()), "{name}");
        }
    }
}
