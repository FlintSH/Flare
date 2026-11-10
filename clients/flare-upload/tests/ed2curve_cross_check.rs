//! `ed2curve_public` against curve25519-dalek.
//!
//! The library converts an account public key with its own field
//! arithmetic, written from section 4.4, rule 3. This test compares it
//! with the Edwards decompression and the Montgomery map of
//! curve25519-dalek, for valid keys and for byte strings that are not keys.

use curve25519_dalek::edwards::CompressedEdwardsY;
use flare_upload::ed2curve::{ed2curve_private, ed2curve_public, is_canonical_x25519_public_key};
use flare_upload::primitives::blake3_hash;
use flare_upload::stanza::x25519_public_key;

/// 2^255 - 19, little-endian.
fn prime() -> [u8; 32] {
    let mut bytes = [0xffu8; 32];
    bytes[0] = 0xed;
    bytes[31] = 0x7f;
    bytes
}

fn y_below_prime(encoded: &[u8; 32]) -> bool {
    let mut y = *encoded;
    y[31] &= 0x7f;
    let prime = prime();
    for index in (0..32).rev() {
        if y[index] != prime[index] {
            return y[index] < prime[index];
        }
    }
    false
}

fn dalek(encoded: &[u8; 32]) -> Option<[u8; 32]> {
    CompressedEdwardsY(*encoded)
        .decompress()
        .map(|point| point.to_montgomery().to_bytes())
}

#[test]
fn valid_public_keys_convert_as_in_curve25519_dalek() {
    for counter in 0u32..2000 {
        let seed = blake3_hash(&counter.to_le_bytes());
        let public_key = ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes();
        let converted = ed2curve_public(&public_key).expect("a valid key");
        assert_eq!(Some(converted), dalek(&public_key), "seed {counter}");
        assert!(is_canonical_x25519_public_key(&converted));
        // The X25519 key pair of the converted keys is one key pair.
        assert_eq!(x25519_public_key(&ed2curve_private(&seed)), converted);
    }
}

#[test]
fn byte_strings_that_are_not_keys() {
    let mut accepted = 0;
    let mut rejected = 0;
    for counter in 0u32..4000 {
        let mut encoded = blake3_hash(&[b"not a key".as_slice(), &counter.to_le_bytes()].concat());
        // Half of the candidates get the sign bit, half do not.
        if counter % 2 == 0 {
            encoded[31] &= 0x7f;
        }
        match ed2curve_public(&encoded) {
            Ok(converted) => {
                accepted += 1;
                assert_eq!(Some(converted), dalek(&encoded), "candidate {counter}");
            }
            Err(_) => {
                rejected += 1;
                // The library rejects what curve25519-dalek rejects (a `y`
                // that has no `x`), and one more class: a `y` that is not
                // less than the prime, which RFC 8032 rejects and
                // curve25519-dalek reduces.
                assert!(
                    dalek(&encoded).is_none() || !y_below_prime(&encoded),
                    "candidate {counter}"
                );
            }
        }
    }
    // About half of all `y` values have an `x`.
    assert!(accepted > 1500 && rejected > 1500, "{accepted} {rejected}");
}

#[test]
fn encodings_at_the_edge() {
    let prime = prime();
    // y = p, p + 1 ... p + 18: all are not less than the prime.
    for offset in 0u8..19 {
        let mut encoded = prime;
        encoded[0] = 0xed + offset;
        assert!(ed2curve_public(&encoded).is_err(), "p + {offset}");
        encoded[31] |= 0x80;
        assert!(
            ed2curve_public(&encoded).is_err(),
            "p + {offset} with the sign bit"
        );
    }
    // y = 1 is the identity: u = (1 + y) / (1 - y) has no value.
    let mut one = [0u8; 32];
    one[0] = 1;
    assert!(ed2curve_public(&one).is_err());
    // y = 0 is a point of order 4 with u = 1.
    let zero = [0u8; 32];
    assert_eq!(ed2curve_public(&zero).ok(), dalek(&zero));
    let mut u_one = [0u8; 32];
    u_one[0] = 1;
    assert_eq!(ed2curve_public(&zero), Ok(u_one));
}
