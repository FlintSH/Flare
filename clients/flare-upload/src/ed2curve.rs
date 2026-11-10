//! `ed2curve_public` and `ed2curve_private` (section 4.4, rules 2 and 3),
//! and the canonical form of an X25519 public key (rule 3a).
//!
//! The public conversion is written from the specification with its own
//! arithmetic in the field of 2^255 - 19. It works on public values only,
//! so it does not have to run in constant time. The tests compare it with
//! the conversion of curve25519-dalek.

use sha2::{Digest, Sha512};
use zeroize::Zeroizing;

use crate::error::CryptoError;

/// An element of the field, as four 64-bit limbs, little-endian. A value
/// can be any number below 2^256; `canonical` reduces it below the prime.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct Field([u64; 4]);

/// 2^255 - 19.
const PRIME: [u64; 4] = [
    0xffff_ffff_ffff_ffed,
    0xffff_ffff_ffff_ffff,
    0xffff_ffff_ffff_ffff,
    0x7fff_ffff_ffff_ffff,
];

fn less_than(left: &[u64; 4], right: &[u64; 4]) -> bool {
    for index in (0..4).rev() {
        if left[index] != right[index] {
            return left[index] < right[index];
        }
    }
    false
}

fn subtract_limbs(left: &[u64; 4], right: &[u64; 4]) -> [u64; 4] {
    let mut result = [0u64; 4];
    let mut borrow = false;
    for index in 0..4 {
        let (first, borrow_first) = left[index].overflowing_sub(right[index]);
        let (second, borrow_second) = first.overflowing_sub(borrow as u64);
        result[index] = second;
        borrow = borrow_first || borrow_second;
    }
    result
}

impl Field {
    const ZERO: Field = Field([0, 0, 0, 0]);
    const ONE: Field = Field([1, 0, 0, 0]);

    fn from_u64(value: u64) -> Field {
        Field([value, 0, 0, 0])
    }

    fn from_bytes(bytes: &[u8; 32]) -> Field {
        let mut limbs = [0u64; 4];
        for (limb, word) in limbs.iter_mut().zip(bytes.as_chunks::<8>().0) {
            *limb = u64::from_le_bytes(*word);
        }
        Field(limbs)
    }

    fn canonical(self) -> Field {
        let mut limbs = self.0;
        // A value below 2^256 is below 3 * PRIME, so two steps are enough.
        for _ in 0..2 {
            if !less_than(&limbs, &PRIME) {
                limbs = subtract_limbs(&limbs, &PRIME);
            }
        }
        Field(limbs)
    }

    fn to_bytes(self) -> [u8; 32] {
        let mut bytes = [0u8; 32];
        for (word, limb) in bytes
            .as_chunks_mut::<8>()
            .0
            .iter_mut()
            .zip(self.canonical().0)
        {
            *word = limb.to_le_bytes();
        }
        bytes
    }

    /// Adds `carry * 2^256`, which is `carry * 38` in the field.
    fn fold(mut limbs: [u64; 4], mut carry: u64) -> Field {
        while carry != 0 {
            let mut add = (carry as u128) * 38;
            for limb in limbs.iter_mut() {
                add += *limb as u128;
                *limb = add as u64;
                add >>= 64;
            }
            carry = add as u64;
        }
        Field(limbs)
    }

    fn add(self, other: Field) -> Field {
        let mut limbs = [0u64; 4];
        let mut carry = 0u128;
        for (limb, (left, right)) in limbs.iter_mut().zip(self.0.iter().zip(other.0)) {
            carry += *left as u128 + right as u128;
            *limb = carry as u64;
            carry >>= 64;
        }
        Field::fold(limbs, carry as u64)
    }

    fn negate(self) -> Field {
        let value = self.canonical();
        if value == Field::ZERO {
            return value;
        }
        Field(subtract_limbs(&PRIME, &value.0))
    }

    fn subtract(self, other: Field) -> Field {
        self.add(other.negate())
    }

    fn multiply(self, other: Field) -> Field {
        let mut wide = [0u64; 8];
        for left in 0..4 {
            let mut carry = 0u128;
            for right in 0..4 {
                carry +=
                    wide[left + right] as u128 + (self.0[left] as u128) * (other.0[right] as u128);
                wide[left + right] = carry as u64;
                carry >>= 64;
            }
            wide[left + 4] = carry as u64;
        }
        // high * 2^256 = high * 38.
        let mut limbs = [0u64; 4];
        let mut carry = 0u128;
        for index in 0..4 {
            carry += wide[index] as u128 + (wide[index + 4] as u128) * 38;
            limbs[index] = carry as u64;
            carry >>= 64;
        }
        Field::fold(limbs, carry as u64)
    }

    /// `self ^ exponent`. The exponent is four limbs, little-endian.
    fn power(self, exponent: &[u64; 4]) -> Field {
        let mut result = Field::ONE;
        for index in (0..256).rev() {
            result = result.multiply(result);
            if (exponent[index / 64] >> (index % 64)) & 1 == 1 {
                result = result.multiply(self);
            }
        }
        result
    }

    fn invert(self) -> Field {
        // prime - 2
        let mut exponent = PRIME;
        exponent[0] -= 2;
        self.power(&exponent)
    }

    /// Whether a value has a square root in the field (Euler's criterion).
    fn is_square(self) -> bool {
        if self.canonical() == Field::ZERO {
            return true;
        }
        // (prime - 1) / 2 = 2^254 - 10
        let exponent = [
            0xffff_ffff_ffff_fff6,
            0xffff_ffff_ffff_ffff,
            0xffff_ffff_ffff_ffff,
            0x3fff_ffff_ffff_ffff,
        ];
        self.power(&exponent).canonical() == Field::ONE
    }
}

fn below_prime(bytes: &[u8; 32]) -> bool {
    less_than(&Field::from_bytes(bytes).0, &PRIME)
}

/// Whether an X25519 public key is canonical: less than 2^255 - 19, and the
/// highest bit of the last byte is zero (section 4.4, rule 3a).
pub fn is_canonical_x25519_public_key(public_key: &[u8; 32]) -> bool {
    public_key[31] & 0x80 == 0 && below_prime(public_key)
}

/// `ed2curve_public` (section 4.4, rule 3).
///
/// 1. Decode the Edwards point as RFC 8032, section 5.1.3: the highest bit
///    is the sign of `x`, the other 255 bits are `y`. Reject a `y` that is
///    not less than 2^255 - 19. Reject a `y` that has no `x`: the value
///    `(y^2 - 1) / (d y^2 + 1)` must be a square. Reject `x = 0` with the
///    sign bit set.
/// 2. If `y = 1`, fail.
/// 3. `u = (1 + y) / (1 - y)`, as 32 bytes little-endian.
pub fn ed2curve_public(ed25519_public_key: &[u8; 32]) -> Result<[u8; 32], CryptoError> {
    let mut y_bytes = *ed25519_public_key;
    let sign = y_bytes[31] >> 7;
    y_bytes[31] &= 0x7f;
    if !below_prime(&y_bytes) {
        return Err(CryptoError::InvalidPublicKey);
    }
    let y = Field::from_bytes(&y_bytes);
    // d = -121665 / 121666
    let d = Field::from_u64(121_665)
        .negate()
        .multiply(Field::from_u64(121_666).invert());
    let y_squared = y.multiply(y);
    let numerator = y_squared.subtract(Field::ONE);
    let denominator = d.multiply(y_squared).add(Field::ONE);
    // The denominator is never zero, because -1/d is not a square.
    let x_squared = numerator.multiply(denominator.invert());
    if !x_squared.is_square() {
        return Err(CryptoError::InvalidPublicKey);
    }
    if x_squared.canonical() == Field::ZERO && sign == 1 {
        return Err(CryptoError::InvalidPublicKey);
    }
    if y.canonical() == Field::ONE {
        return Err(CryptoError::InvalidPublicKey);
    }
    let u = Field::ONE.add(y).multiply(Field::ONE.subtract(y).invert());
    Ok(u.to_bytes())
}

/// `ed2curve_private` (section 4.4, rule 2): the first 32 bytes of SHA-512
/// of the seed, clamped as RFC 7748 specifies.
///
/// The command-line program never calls this. It exists for the tests,
/// which open what the program made.
pub fn ed2curve_private(ed25519_seed: &[u8; 32]) -> Zeroizing<[u8; 32]> {
    let digest = Zeroizing::new(<[u8; 64]>::from(Sha512::digest(ed25519_seed)));
    let mut scalar = Zeroizing::new([0u8; 32]);
    scalar.copy_from_slice(&digest[..32]);
    scalar[0] &= 248;
    scalar[31] &= 127;
    scalar[31] |= 64;
    scalar
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn field_arithmetic_wraps_at_the_prime() {
        let minus_one = Field::ONE.negate();
        assert_eq!(minus_one.add(Field::ONE).canonical(), Field::ZERO);
        assert_eq!(minus_one.multiply(minus_one).canonical(), Field::ONE);
        let big = Field([u64::MAX; 4]);
        // 2^256 - 1 = 2 * prime + 37
        assert_eq!(big.canonical(), Field::from_u64(37));
        assert_eq!(big.multiply(big).canonical(), Field::from_u64(37 * 37));
        let seven = Field::from_u64(7);
        assert_eq!(seven.multiply(seven.invert()).canonical(), Field::ONE);
    }

    #[test]
    fn canonical_x25519_keys() {
        let mut key = [0u8; 32];
        assert!(is_canonical_x25519_public_key(&key));
        key[31] = 0x80;
        assert!(!is_canonical_x25519_public_key(&key));
        // prime - 1 is canonical, prime is not.
        let mut prime = [0xffu8; 32];
        prime[0] = 0xed;
        prime[31] = 0x7f;
        assert!(!is_canonical_x25519_public_key(&prime));
        prime[0] = 0xec;
        assert!(is_canonical_x25519_public_key(&prime));
    }

    #[test]
    fn rejects_y_of_one_and_y_not_below_the_prime() {
        let mut one = [0u8; 32];
        one[0] = 1;
        assert_eq!(ed2curve_public(&one), Err(CryptoError::InvalidPublicKey));
        let mut prime = [0xffu8; 32];
        prime[0] = 0xed;
        prime[31] = 0x7f;
        assert_eq!(ed2curve_public(&prime), Err(CryptoError::InvalidPublicKey));
        // y = prime + 1 would be y = 1 after a reduction.
        prime[0] = 0xee;
        assert_eq!(ed2curve_public(&prime), Err(CryptoError::InvalidPublicKey));
    }

    #[test]
    fn rejects_zero_x_with_the_sign_bit() {
        // y = -1 has x = 0. With the sign bit, RFC 8032 rejects it.
        let mut minus_one = [0xffu8; 32];
        minus_one[0] = 0xec;
        minus_one[31] = 0x7f;
        assert_eq!(ed2curve_public(&minus_one), Ok([0u8; 32]));
        minus_one[31] = 0xff;
        assert_eq!(
            ed2curve_public(&minus_one),
            Err(CryptoError::InvalidPublicKey)
        );
    }
}
