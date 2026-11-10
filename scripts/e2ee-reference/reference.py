"""Reference implementation of Flare end-to-end encryption, protocol version 1.

Written from docs/e2ee-spec.md only. Each function names the section that it
implements. This program makes the test vectors. It is not production code:
it does not run in constant time and it does not erase secrets.

Two code paths exist on purpose:

- The forward path (seal, encrypt, wrap, sign) uses library primitives.
- The reverse path (open, decrypt, unwrap) uses the pure Python XChaCha20 and
  X25519 of this file. A wrong use of a library thus shows as a failure of
  the round trip, not as a silent agreement of a library with itself.
"""

from __future__ import annotations

import hashlib
import hmac
import unicodedata

import argon2.low_level
import blake3 as _blake3
import nacl.bindings
import nacl.signing
from Crypto.Cipher import ChaCha20 as _ChaCha20

PROTOCOL_VERSION = 1
RECORD_VERSION = b"\x01"

CHUNK_SIZE = 65536
TAG_SIZE = 32
NONCE_SIZE = 24
HEADER_SIZE = 26
STORED_CHUNK_SIZE = CHUNK_SIZE + TAG_SIZE  # 65568, section 7.5

# Section 4.3. Fixed for protocol version 1. No record stores them. The
# functions below take them as arguments only because SCHEMA.md has fast test
# vectors; a caller that is not a test uses the default values.
ARGON2_MEMORY_KIB = 65536
ARGON2_PASSES = 3
ARGON2_LANES = 4

# Each context string of the sections that this program implements.
CONTEXT_SEAL_CIPHER = "flare e2ee v1 seal cipher"
CONTEXT_SEAL_MAC = "flare e2ee v1 seal mac"
CONTEXT_ONE_TIME_NONCE = "flare e2ee v1 one-time nonce"
CONTEXT_ACCOUNT_SEED = "flare e2ee v1 account seed"
CONTEXT_AUTH = "flare e2ee v1 auth"
CONTEXT_WRAP = "flare e2ee v1 wrap"
CONTEXT_SIGN_IN = "flare e2ee v1 sign-in"
CONTEXT_REQUEST = "flare e2ee v1 request"
CONTEXT_CONTENT_CIPHER = "flare e2ee v1 content cipher"
CONTEXT_CONTENT_MAC = "flare e2ee v1 content mac"
CONTEXT_FILE_METADATA = "flare e2ee v1 file metadata"
CONTEXT_ACCOUNT_STANZA = "flare e2ee v1 account stanza"
CONTEXT_PASSWORD_STANZA = "flare e2ee v1 password stanza"
CONTEXT_LINK_SECRET_COPY = "flare e2ee v1 link secret copy"
CONTEXT_KEYRING = "flare e2ee v1 keyring"
CONTEXT_FOLDER_METADATA = "flare e2ee v1 folder metadata"
CONTEXT_FOLDER_OWNER = "flare e2ee v1 folder owner"
CONTEXT_PARENT_FOLDER_STANZA = "flare e2ee v1 parent folder stanza"
CONTEXT_FOLDER_FILE_STANZA = "flare e2ee v1 folder file stanza"
CONTEXT_FOLDER_LINK_SECRET_STANZA = "flare e2ee v1 folder link secret stanza"
CONTEXT_TAG_METADATA = "flare e2ee v1 tag metadata"
CONTEXT_OCR_TEXT = "flare e2ee v1 ocr text"
CONTEXT_THUMBNAIL = "flare e2ee v1 thumbnail"

HEADER_MAGIC = b"FLAREE2E"
FORMAT_VERSION = 1
CHUNK_SIZE_LOG2 = 16


class Reject(Exception):
    """A step failed. Section 1.3: stop the procedure and reject the input.

    `reason` is a short fixed word. The self-checks of the generator use it
    to prove that an input fails for the stated cause and not for another.
    """

    def __init__(self, message: str, reason: str = "other") -> None:
        super().__init__(message)
        self.reason = reason


def _need(value: bytes, size: int, name: str) -> None:
    if len(value) != size:
        raise Reject(f"{name} must have {size} bytes, got {len(value)}", "length")


# --------------------------------------------------------------------------
# Section 2.2. Notation.
# --------------------------------------------------------------------------


def le64(number: int) -> bytes:
    if not 0 <= number < 1 << 64:
        raise Reject("LE64 input is out of range")
    return number.to_bytes(8, "little")


def zeros(count: int) -> bytes:
    return bytes(count)


# --------------------------------------------------------------------------
# Section 4. BLAKE3.
# --------------------------------------------------------------------------


def blake3_hash(message: bytes) -> bytes:
    return _blake3.blake3(message).digest(32)


def blake3_keyed_hash(key: bytes, message: bytes) -> bytes:
    _need(key, 32, "blake3 key")
    return _blake3.blake3(message, key=key).digest(32)


def blake3_derive_key(context: str, key_material: bytes) -> bytes:
    # Section 2.2: all context strings are ASCII, without a terminator.
    context.encode("ascii")
    return _blake3.blake3(key_material, derive_key_context=context).digest(32)


# --------------------------------------------------------------------------
# Section 4.4 rule 4. XChaCha20, block counter from 0.
# --------------------------------------------------------------------------


def xchacha20(key: bytes, nonce: bytes, data: bytes) -> bytes:
    """Library path. A 24-byte nonce selects XChaCha20 in pycryptodome."""
    _need(key, 32, "XChaCha20 key")
    _need(nonce, NONCE_SIZE, "XChaCha20 nonce")
    return _ChaCha20.new(key=key, nonce=nonce).encrypt(data)


_MASK32 = 0xFFFFFFFF
_SIGMA = (0x61707865, 0x3320646E, 0x79622D32, 0x6B206574)


def _chacha_rounds(state: list[int]) -> None:
    def quarter(a: int, b: int, c: int, d: int) -> None:
        state[a] = (state[a] + state[b]) & _MASK32
        x = state[d] ^ state[a]
        state[d] = ((x << 16) | (x >> 16)) & _MASK32
        state[c] = (state[c] + state[d]) & _MASK32
        x = state[b] ^ state[c]
        state[b] = ((x << 12) | (x >> 20)) & _MASK32
        state[a] = (state[a] + state[b]) & _MASK32
        x = state[d] ^ state[a]
        state[d] = ((x << 8) | (x >> 24)) & _MASK32
        state[c] = (state[c] + state[d]) & _MASK32
        x = state[b] ^ state[c]
        state[b] = ((x << 7) | (x >> 25)) & _MASK32

    for _ in range(10):
        quarter(0, 4, 8, 12)
        quarter(1, 5, 9, 13)
        quarter(2, 6, 10, 14)
        quarter(3, 7, 11, 15)
        quarter(0, 5, 10, 15)
        quarter(1, 6, 11, 12)
        quarter(2, 7, 8, 13)
        quarter(3, 4, 9, 14)


def _words(data: bytes) -> list[int]:
    return [int.from_bytes(data[i : i + 4], "little") for i in range(0, len(data), 4)]


def hchacha20_pure(key: bytes, nonce16: bytes) -> bytes:
    _need(key, 32, "HChaCha20 key")
    _need(nonce16, 16, "HChaCha20 nonce")
    state = list(_SIGMA) + _words(key) + _words(nonce16)
    _chacha_rounds(state)
    return b"".join(w.to_bytes(4, "little") for w in state[0:4] + state[12:16])


def xchacha20_pure(key: bytes, nonce: bytes, data: bytes, counter: int = 0) -> bytes:
    """Pure Python XChaCha20 (HChaCha20, then ChaCha20 of RFC 8439)."""
    _need(key, 32, "XChaCha20 key")
    _need(nonce, NONCE_SIZE, "XChaCha20 nonce")
    subkey = _words(hchacha20_pure(key, nonce[:16]))
    tail = _words(bytes(4) + nonce[16:24])
    keystream = bytearray()
    block = counter
    while len(keystream) < len(data):
        initial = list(_SIGMA) + subkey + [block & _MASK32] + tail
        state = list(initial)
        _chacha_rounds(state)
        for i in range(16):
            keystream += ((state[i] + initial[i]) & _MASK32).to_bytes(4, "little")
        block += 1
    return bytes(a ^ b for a, b in zip(data, keystream))


# --------------------------------------------------------------------------
# Curve25519 field arithmetic with plain integers.
# --------------------------------------------------------------------------

FIELD_PRIME = 2**255 - 19
_EDWARDS_D = (-121665 * pow(121666, FIELD_PRIME - 2, FIELD_PRIME)) % FIELD_PRIME
_SQRT_MINUS_ONE = pow(2, (FIELD_PRIME - 1) // 4, FIELD_PRIME)
X25519_BASE_POINT = (9).to_bytes(32, "little")


def _field_inverse(value: int) -> int:
    return pow(value, FIELD_PRIME - 2, FIELD_PRIME)


def clamp_x25519(scalar: bytes) -> bytes:
    """RFC 7748 section 5, decodeScalar25519."""
    _need(scalar, 32, "X25519 scalar")
    clamped = bytearray(scalar)
    clamped[0] &= 248
    clamped[31] &= 127
    clamped[31] |= 64
    return bytes(clamped)


def x25519_pure(private_key: bytes, public_key: bytes) -> bytes:
    """RFC 7748 section 5, Montgomery ladder with plain integers."""
    _need(private_key, 32, "X25519 private key")
    _need(public_key, 32, "X25519 public key")
    k = int.from_bytes(clamp_x25519(private_key), "little")
    u = int.from_bytes(public_key, "little") & ((1 << 255) - 1)
    p = FIELD_PRIME
    x_1, x_2, z_2, x_3, z_3, swap = u % p, 1, 0, u % p, 1, 0
    for t in range(254, -1, -1):
        k_t = (k >> t) & 1
        swap ^= k_t
        if swap:
            x_2, x_3, z_2, z_3 = x_3, x_2, z_3, z_2
        swap = k_t
        a = (x_2 + z_2) % p
        aa = a * a % p
        b = (x_2 - z_2) % p
        bb = b * b % p
        e = (aa - bb) % p
        c = (x_3 + z_3) % p
        d = (x_3 - z_3) % p
        da = d * a % p
        cb = c * b % p
        x_3 = (da + cb) ** 2 % p
        z_3 = x_1 * (da - cb) ** 2 % p
        x_2 = aa * bb % p
        z_2 = e * (aa + 121665 * e) % p
    if swap:
        x_2, x_3, z_2, z_3 = x_3, x_2, z_3, z_2
    return (x_2 * _field_inverse(z_2) % p).to_bytes(32, "little")


def x25519(private_key: bytes, public_key: bytes) -> bytes:
    """Library path (libsodium). Sections 8.1 and 8.4.1 reject a zero output."""
    _need(private_key, 32, "X25519 private key")
    _need(public_key, 32, "X25519 public key")
    try:
        shared_secret = nacl.bindings.crypto_scalarmult(private_key, public_key)
    except Exception as error:  # libsodium refuses an all-zero output itself
        raise Reject("shared_secret = zeros(32)", "zero_shared_secret") from error
    if shared_secret == zeros(32):
        raise Reject("shared_secret = zeros(32)", "zero_shared_secret")
    return shared_secret


def x25519_checked_pure(private_key: bytes, public_key: bytes) -> bytes:
    shared_secret = x25519_pure(private_key, public_key)
    if shared_secret == zeros(32):
        raise Reject("shared_secret = zeros(32)", "zero_shared_secret")
    return shared_secret


def check_canonical_x25519_public_key(public_key: bytes, name: str) -> None:
    """Section 4.4 rule 3a.

    The 32 bytes, read as one little-endian number of 256 bits, must be less
    than 2^255 - 19. This one comparison also rejects a set highest bit of
    the last byte, because such a number is not less than 2^255.
    """
    _need(public_key, 32, name)
    if int.from_bytes(public_key, "little") >= FIELD_PRIME:
        raise Reject(f"{name} is not canonical", "not_canonical")


def x25519_public_key(private_key: bytes) -> bytes:
    """Rule 3b: the private key is 32 bytes as they are. X25519 clamps them."""
    _need(private_key, 32, "X25519 private key")
    return nacl.bindings.crypto_scalarmult_base(private_key)


# --------------------------------------------------------------------------
# Section 4.1 and section 4.4 rules 1 to 3. Ed25519 and ed2curve.
# --------------------------------------------------------------------------


def ed25519_public_key(seed: bytes) -> bytes:
    _need(seed, 32, "Ed25519 seed")
    return bytes(nacl.signing.SigningKey(seed).verify_key)


def ed25519_sign(private_key: bytes, message: bytes) -> bytes:
    """RFC 8032 Ed25519 (pure, deterministic). The private key is the seed."""
    _need(private_key, 32, "Ed25519 private key")
    return nacl.signing.SigningKey(private_key).sign(message).signature


def ed25519_verify(public_key: bytes, message: bytes, signature: bytes) -> bool:
    try:
        nacl.signing.VerifyKey(public_key).verify(message, signature)
        return True
    except Exception:
        return False


def ed2curve_private(seed: bytes) -> bytes:
    """Rule 2: SHA-512 of the seed, first 32 bytes, clamped as RFC 7748."""
    _need(seed, 32, "Ed25519 seed")
    return clamp_x25519(hashlib.sha512(seed).digest()[:32])


def _decode_edwards_y(public_key: bytes) -> int:
    """RFC 8032 section 5.1.3. Returns y. Fails if the point does not decode."""
    _need(public_key, 32, "Ed25519 public key")
    p = FIELD_PRIME
    encoded = int.from_bytes(public_key, "little")
    sign = encoded >> 255
    y = encoded & ((1 << 255) - 1)
    if y >= p:
        raise Reject("Edwards point does not decode: y is not canonical", "not_canonical")
    numerator = (y * y - 1) % p
    denominator = (_EDWARDS_D * y * y + 1) % p
    x_squared = numerator * _field_inverse(denominator) % p
    x = pow(x_squared, (p + 3) // 8, p)
    if (x * x - x_squared) % p != 0:
        x = x * _SQRT_MINUS_ONE % p
    if (x * x - x_squared) % p != 0:
        raise Reject("Edwards point does not decode: no square root", "edwards")
    if x == 0 and sign == 1:
        raise Reject("Edwards point does not decode: x = 0 with sign bit", "edwards")
    return y


def ed2curve_public(public_key: bytes) -> bytes:
    """Rule 3: u = (1 + y) / (1 - y), 32 bytes little-endian."""
    y = _decode_edwards_y(public_key)
    if y == 1:
        raise Reject("ed2curve_public: y = 1", "edwards")
    u = (1 + y) * _field_inverse((1 - y) % FIELD_PRIME) % FIELD_PRIME
    return u.to_bytes(32, "little")


# --------------------------------------------------------------------------
# Section 4.2. Sealed box.
# --------------------------------------------------------------------------


def _seal_tag(mac_key: bytes, associated_data: bytes, nonce: bytes, ciphertext: bytes) -> bytes:
    return blake3_keyed_hash(
        mac_key, le64(len(associated_data)) + associated_data + nonce + ciphertext
    )


def seal(key: bytes, nonce: bytes, associated_data: bytes, message: bytes) -> bytes:
    _need(key, 32, "seal key")
    _need(nonce, NONCE_SIZE, "seal nonce")
    cipher_key = blake3_derive_key(CONTEXT_SEAL_CIPHER, key)
    mac_key = blake3_derive_key(CONTEXT_SEAL_MAC, key)
    ciphertext = xchacha20(cipher_key, nonce, message)
    tag = _seal_tag(mac_key, associated_data, nonce, ciphertext)
    return nonce + ciphertext + tag


def open_sealed(key: bytes, associated_data: bytes, sealed_box: bytes) -> bytes:
    """`open` of section 4.2. Uses the pure Python XChaCha20."""
    _need(key, 32, "open key")
    if len(sealed_box) < NONCE_SIZE + TAG_SIZE:
        raise Reject("sealed_box has less than 56 bytes", "length")
    nonce = sealed_box[:NONCE_SIZE]
    ciphertext = sealed_box[NONCE_SIZE:-TAG_SIZE]
    tag = sealed_box[-TAG_SIZE:]
    cipher_key = blake3_derive_key(CONTEXT_SEAL_CIPHER, key)
    mac_key = blake3_derive_key(CONTEXT_SEAL_MAC, key)
    expected_tag = _seal_tag(mac_key, associated_data, nonce, ciphertext)
    if not hmac.compare_digest(expected_tag, tag):
        raise Reject("sealed_box tag is not correct", "tag")
    return xchacha20_pure(cipher_key, nonce, ciphertext)


# --------------------------------------------------------------------------
# Section 4.2.1. Sealed box for a key that is used one time.
# --------------------------------------------------------------------------


def one_time_nonce(key: bytes) -> bytes:
    _need(key, 32, "seal_once key")
    return blake3_derive_key(CONTEXT_ONE_TIME_NONCE, key)[:NONCE_SIZE]


def seal_once(key: bytes, associated_data: bytes, message: bytes) -> bytes:
    """The output is ciphertext || tag. It has no nonce."""
    return seal(key, one_time_nonce(key), associated_data, message)[NONCE_SIZE:]


def open_once(key: bytes, associated_data: bytes, sealed_once_box: bytes) -> bytes:
    """Uses `open`, thus the pure Python XChaCha20."""
    if len(sealed_once_box) < TAG_SIZE:
        raise Reject("sealed_once_box has less than 32 bytes", "length")
    return open_sealed(key, associated_data, one_time_nonce(key) + sealed_once_box)


# --------------------------------------------------------------------------
# Section 4.4 rules 5 to 7, 10, 12. Encodings.
# --------------------------------------------------------------------------


def encode_secret_text(text: str) -> bytes:
    """Rule 5: NFKC, then UTF-8. Spaces stay."""
    return unicodedata.normalize("NFKC", text).encode("utf-8")


def argon2id(
    secret: bytes,
    salt: bytes,
    memory_kib: int = ARGON2_MEMORY_KIB,
    passes: int = ARGON2_PASSES,
    lanes: int = ARGON2_LANES,
) -> bytes:
    """Rule 6: version 0x13, no secret value, no associated data, 32 bytes."""
    return argon2.low_level.hash_secret_raw(
        secret=secret,
        salt=salt,
        time_cost=passes,
        memory_cost=memory_kib,
        parallelism=lanes,
        hash_len=32,
        type=argon2.low_level.Type.ID,
        version=0x13,
    )


# The characters with the Unicode property White_Space (PropList.txt). The set
# did not change since Unicode 6.3. Python `str.strip()` is not used: it also
# removes U+001C to U+001F, which do not have the property.
WHITE_SPACE = (
    "\u0009\u000a\u000b\u000c\u000d\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000"
)


def normalize_identifier(identifier: str) -> str:
    """Rule 7, in the sequence of the text: NFKC, then remove White_Space at
    the start and the end, then lower case with the default Unicode mapping
    (Python `str.lower`, which uses no locale)."""
    return unicodedata.normalize("NFKC", identifier).strip(WHITE_SPACE).lower()


def encode_identifier(identifier: str) -> bytes:
    return normalize_identifier(identifier).encode("utf-8")


def _bip39_word_list() -> list[str]:
    import mnemonic

    return mnemonic.Mnemonic("english").wordlist


def mnemonic_from_entropy(root_entropy: bytes) -> str:
    """Rule 10: BIP39, English list. 256 bits and an 8-bit checksum, 24 words."""
    _need(root_entropy, 32, "root_entropy")
    words = _bip39_word_list()
    checksum = hashlib.sha256(root_entropy).digest()[0]
    number = (int.from_bytes(root_entropy, "big") << 8) | checksum
    indexes = [(number >> (11 * (23 - i))) & 0x7FF for i in range(24)]
    return " ".join(words[i] for i in indexes)


def entropy_from_mnemonic(mnemonic_text: str) -> bytes:
    """Rule 10: the reader accepts upper case and more than one space."""
    words = _bip39_word_list()
    parts = [part for part in mnemonic_text.lower().split(" ") if part]
    if len(parts) != 24:
        raise Reject("mnemonic must have 24 words")
    number = 0
    for part in parts:
        if part not in words:
            raise Reject("mnemonic word is not in the list")
        number = (number << 11) | words.index(part)
    root_entropy = (number >> 8).to_bytes(32, "big")
    if hashlib.sha256(root_entropy).digest()[0] != number & 0xFF:
        raise Reject("mnemonic checksum is not correct")
    return root_entropy


def encode_record(record: bytes) -> bytes:
    """Rule 12: each stanza and each sealed value that the server stores is 0x01 || record."""
    return RECORD_VERSION + record


def decode_record(stored_record: bytes) -> bytes:
    if stored_record[:1] != RECORD_VERSION:
        raise Reject("unknown record_version")
    return stored_record[1:]


# --------------------------------------------------------------------------
# Section 5.1. Key hierarchy.
# --------------------------------------------------------------------------


def account_keys(root_entropy: bytes) -> dict[str, bytes | str]:
    _need(root_entropy, 32, "root_entropy")
    account_seed = blake3_derive_key(CONTEXT_ACCOUNT_SEED, root_entropy)
    account_private_key = account_seed  # rule 1
    account_public_key = ed25519_public_key(account_seed)
    return {
        "mnemonic_text": mnemonic_from_entropy(root_entropy),
        "account_private_key": account_private_key,
        "account_public_key": account_public_key,
        "exchange_private_key": ed2curve_private(account_private_key),
        "exchange_public_key": ed2curve_public(account_public_key),
    }


def passphrase_keys(
    passphrase: str,
    passphrase_salt: bytes,
    memory_kib: int = ARGON2_MEMORY_KIB,
    passes: int = ARGON2_PASSES,
    lanes: int = ARGON2_LANES,
) -> dict[str, bytes]:
    passphrase_root = argon2id(
        encode_secret_text(passphrase), passphrase_salt, memory_kib, passes, lanes
    )
    auth_seed = blake3_derive_key(CONTEXT_AUTH, passphrase_root)
    return {
        "passphrase_root": passphrase_root,
        "auth_private_key": auth_seed,  # rule 1
        "auth_public_key": ed25519_public_key(auth_seed),
        "wrap_key": blake3_derive_key(CONTEXT_WRAP, passphrase_root),
    }


def wrap_root(wrap_key: bytes, nonce: bytes, account_public_key: bytes, root_entropy: bytes) -> bytes:
    """Section 5.3: wrapped_root = seal(wrap_key, nonce, account_public_key, root_entropy)."""
    _need(root_entropy, 32, "root_entropy")
    _need(account_public_key, 32, "account_public_key")
    return seal(wrap_key, nonce, account_public_key, root_entropy)


def unwrap_root(wrap_key: bytes, account_public_key: bytes, wrapped_root: bytes) -> bytes:
    """Section 6.2 steps 9 to 11."""
    root_entropy = open_sealed(wrap_key, account_public_key, wrapped_root)
    _need(root_entropy, 32, "root_entropy")
    account_seed = blake3_derive_key(CONTEXT_ACCOUNT_SEED, root_entropy)
    if ed25519_public_key(account_seed) != account_public_key:
        raise Reject("account_private_key does not give account_public_key", "key_mismatch")
    return root_entropy


# --------------------------------------------------------------------------
# Section 6.2 step 4 and section 6.6.
# --------------------------------------------------------------------------


def sign_in_message(challenge: bytes, identifier: str) -> bytes:
    _need(challenge, 32, "challenge")
    return CONTEXT_SIGN_IN.encode("ascii") + challenge + blake3_hash(encode_identifier(identifier))


def sign_in_signature(auth_private_key: bytes, challenge: bytes, identifier: str) -> bytes:
    return ed25519_sign(auth_private_key, sign_in_message(challenge, identifier))


def check_method(method: str) -> bytes:
    """Rule 8: `method` is in upper case ASCII. Each other form is rejected.

    Reading: one or more of the letters A to Z, and no other character.
    """
    if not method or any(not "A" <= character <= "Z" for character in method):
        raise Reject("method must be upper case ASCII", "method")
    return method.encode("ascii")


def signed_request_message(challenge: bytes, method: str, path: str, body: bytes) -> bytes:
    """Section 6.6 step 2 with rule 8.

    `method` must be upper case ASCII already. This function does not change
    it. `path` is the percent-encoded form that the client sends, thus ASCII;
    the UTF-8 encoding gives the same bytes. A request without a body has
    `body = b""`, thus the last part is blake3_hash of the empty byte string.
    """
    _need(challenge, 32, "challenge")
    method_bytes = check_method(method)
    return (
        CONTEXT_REQUEST.encode("ascii")
        + challenge
        + blake3_hash(method_bytes + b" " + path.encode("utf-8"))
        + blake3_hash(body)
    )


def signed_request(
    account_private_key: bytes, challenge: bytes, method: str, path: str, body: bytes
) -> tuple[bytes, bytes]:
    signed_message = signed_request_message(challenge, method, path, body)
    return signed_message, ed25519_sign(account_private_key, signed_message)


def verify_signed_request(
    account_public_key: bytes, challenge: bytes, method: str, path: str, body: bytes, signature: bytes
) -> None:
    """Section 6.6 step 5 with rule 8. The verifier rejects a method that is not upper case ASCII."""
    signed_message = signed_request_message(challenge, method, path, body)
    if not ed25519_verify(account_public_key, signed_message, signature):
        raise Reject("request signature is not correct", "signature")


# --------------------------------------------------------------------------
# Section 7. File encryption.
# --------------------------------------------------------------------------


def file_keys(file_key: bytes) -> dict[str, bytes]:
    """Sections 7.1, 8.2 step 7, 9.6.1 and 12.1."""
    _need(file_key, 32, "file_key")
    return {
        "content_cipher_key": blake3_derive_key(CONTEXT_CONTENT_CIPHER, file_key),
        "content_mac_key": blake3_derive_key(CONTEXT_CONTENT_MAC, file_key),
        "metadata_key": blake3_derive_key(CONTEXT_FILE_METADATA, file_key),
        "ocr_text_key": blake3_derive_key(CONTEXT_OCR_TEXT, file_key),
        "thumbnail_key": blake3_derive_key(CONTEXT_THUMBNAIL, file_key),
        "link_secret_key": blake3_derive_key(CONTEXT_LINK_SECRET_COPY, file_key),
    }


def build_header(nonce_prefix: bytes) -> bytes:
    """Section 7.2. 26 bytes."""
    _need(nonce_prefix, 16, "nonce_prefix")
    return HEADER_MAGIC + bytes([FORMAT_VERSION, CHUNK_SIZE_LOG2]) + nonce_prefix


def header_hash_of(header: bytes) -> bytes:
    _need(header, HEADER_SIZE, "header")
    return blake3_hash(header)


def _chunk_tag(
    content_mac_key: bytes, header_hash: bytes, chunk_index: int, is_final: bool, chunk_ciphertext: bytes
) -> bytes:
    final_flag = b"\x01" if is_final else b"\x00"
    return blake3_keyed_hash(
        content_mac_key, header_hash + le64(chunk_index) + final_flag + chunk_ciphertext
    )


def encrypt_chunk(
    file_key: bytes, nonce_prefix: bytes, chunk_index: int, is_final: bool, chunk_plaintext: bytes
) -> bytes:
    """Section 7.3 steps 1 to 5. The output is the stored chunk."""
    if len(chunk_plaintext) > CHUNK_SIZE:
        raise Reject("a chunk has at most 65536 bytes", "chunk_length")
    if not is_final and len(chunk_plaintext) != CHUNK_SIZE:
        raise Reject("a chunk that is not the last one has exactly 65536 bytes", "chunk_length")
    if is_final and len(chunk_plaintext) == 0 and chunk_index != 0:
        raise Reject("a last chunk of length zero is valid only as chunk 0", "empty_final_chunk")
    keys = file_keys(file_key)
    header_hash = header_hash_of(build_header(nonce_prefix))
    chunk_nonce = nonce_prefix + le64(chunk_index)
    chunk_ciphertext = xchacha20(keys["content_cipher_key"], chunk_nonce, chunk_plaintext)
    chunk_tag = _chunk_tag(keys["content_mac_key"], header_hash, chunk_index, is_final, chunk_ciphertext)
    return chunk_ciphertext + chunk_tag


def split_plaintext(plaintext: bytes) -> list[bytes]:
    """Section 7.3, first paragraph.

    Chunks of 65536 bytes. The last chunk can be shorter. An empty file has
    one chunk of length zero. A plaintext whose length is a positive multiple
    of 65536 ends with a full chunk; no empty chunk follows it.
    """
    if len(plaintext) == 0:
        return [b""]
    return [plaintext[i : i + CHUNK_SIZE] for i in range(0, len(plaintext), CHUNK_SIZE)]


def encrypt_file(file_key: bytes, nonce_prefix: bytes, plaintext: bytes) -> bytes:
    """Section 7.3: the header and then all stored chunks in sequence."""
    chunks = split_plaintext(plaintext)
    stored = bytearray(build_header(nonce_prefix))
    for chunk_index, chunk in enumerate(chunks):
        stored += encrypt_chunk(file_key, nonce_prefix, chunk_index, chunk_index == len(chunks) - 1, chunk)
    return bytes(stored)


def decrypt_chunk(
    file_key: bytes, nonce_prefix: bytes, chunk_index: int, is_final: bool, stored_chunk: bytes
) -> bytes:
    """Section 7.4 rules 3, 4, 6 and 8 for one stored chunk. Uses the pure Python XChaCha20."""
    if len(stored_chunk) < TAG_SIZE or len(stored_chunk) > STORED_CHUNK_SIZE:
        raise Reject("stored chunk has a length that is not possible", "chunk_length")
    if not is_final and len(stored_chunk) != STORED_CHUNK_SIZE:
        raise Reject("a chunk that is not the last one must have 65536 bytes", "chunk_length")
    keys = file_keys(file_key)
    header_hash = header_hash_of(build_header(nonce_prefix))
    chunk_ciphertext, chunk_tag = stored_chunk[:-TAG_SIZE], stored_chunk[-TAG_SIZE:]
    expected_tag = _chunk_tag(keys["content_mac_key"], header_hash, chunk_index, is_final, chunk_ciphertext)
    if not hmac.compare_digest(expected_tag, chunk_tag):
        raise Reject(f"tag of chunk {chunk_index} is not correct", "tag")
    if is_final and len(chunk_ciphertext) == 0 and chunk_index != 0:
        # Rule 8. The tag is correct here. The chunk is rejected all the same.
        raise Reject("a last chunk of length zero is valid only as chunk 0", "empty_final_chunk")
    return xchacha20_pure(keys["content_cipher_key"], nonce_prefix + le64(chunk_index), chunk_ciphertext)


def decrypt_file(file_key: bytes, stored_file: bytes) -> bytes:
    """Section 7.4. Uses the pure Python XChaCha20."""
    if len(stored_file) < HEADER_SIZE + TAG_SIZE:
        raise Reject("stored file is too short", "length")
    header = stored_file[:HEADER_SIZE]
    if header[:8] != HEADER_MAGIC or header[8] != FORMAT_VERSION:
        raise Reject("header is not correct", "header")
    if header[9] != CHUNK_SIZE_LOG2:
        raise Reject("chunk_size_log2 must be 16", "header")  # rule 9
    nonce_prefix = header[10:26]
    body = stored_file[HEADER_SIZE:]
    plaintext = bytearray()
    chunk_index = 0
    offset = 0
    while True:
        stored_chunk = body[offset : offset + STORED_CHUNK_SIZE]
        offset += len(stored_chunk)
        # The chunk that ends the stored bytes is the last one (rules 5 and 7).
        is_final = offset == len(body)
        plaintext += decrypt_chunk(file_key, nonce_prefix, chunk_index, is_final, stored_chunk)
        if is_final:
            return bytes(plaintext)
        chunk_index += 1


# --------------------------------------------------------------------------
# Sections 9.1, 9.6.1, 12.1. Sealed records of one file.
# --------------------------------------------------------------------------


def seal_metadata(file_key: bytes, nonce: bytes, header_hash: bytes, file_metadata: bytes) -> bytes:
    _need(header_hash, 32, "header_hash")
    return seal(file_keys(file_key)["metadata_key"], nonce, header_hash, file_metadata)


def open_metadata(file_key: bytes, header_hash: bytes, sealed_metadata: bytes) -> bytes:
    return open_sealed(file_keys(file_key)["metadata_key"], header_hash, sealed_metadata)


def seal_ocr_text(file_key: bytes, nonce: bytes, header_hash: bytes, ocr_text: bytes) -> bytes:
    _need(header_hash, 32, "header_hash")
    return seal(file_keys(file_key)["ocr_text_key"], nonce, header_hash, ocr_text)


def open_ocr_text(file_key: bytes, header_hash: bytes, sealed_ocr_text: bytes) -> bytes:
    return open_sealed(file_keys(file_key)["ocr_text_key"], header_hash, sealed_ocr_text)


def seal_thumbnail(file_key: bytes, nonce: bytes, header_hash: bytes, thumbnail: bytes) -> bytes:
    _need(header_hash, 32, "header_hash")
    return seal(file_keys(file_key)["thumbnail_key"], nonce, header_hash, thumbnail)


def open_thumbnail(file_key: bytes, header_hash: bytes, sealed_thumbnail: bytes) -> bytes:
    return open_sealed(file_keys(file_key)["thumbnail_key"], header_hash, sealed_thumbnail)


# --------------------------------------------------------------------------
# Sections 8.1 and 8.4.1. Public-key wrap.
# --------------------------------------------------------------------------


def public_wrap(
    recipient_public_key: bytes,
    ephemeral_private_key: bytes,
    context: str,
    associated_data: bytes,
    secret: bytes,
) -> bytes:
    """Section 8.4.1. `ephemeral_private_key` is an input, thus the output is fixed.

    A caller must not use one ephemeral key pair for two stanzas.
    """
    check_canonical_x25519_public_key(recipient_public_key, "recipient_public_key")
    ephemeral_public_key = x25519_public_key(ephemeral_private_key)
    shared_secret = x25519(ephemeral_private_key, recipient_public_key)
    stanza_key = blake3_derive_key(
        context, shared_secret + ephemeral_public_key + recipient_public_key
    )
    return ephemeral_public_key + seal_once(stanza_key, associated_data, secret)


def public_unwrap(recipient_private_key: bytes, context: str, associated_data: bytes, stanza: bytes) -> bytes:
    """Section 8.4.1. Uses the pure Python X25519 and XChaCha20."""
    if len(stanza) < 32 + TAG_SIZE:
        raise Reject("stanza is too short", "length")
    ephemeral_public_key = stanza[:32]
    check_canonical_x25519_public_key(ephemeral_public_key, "ephemeral_public_key")
    recipient_public_key = x25519_pure(recipient_private_key, X25519_BASE_POINT)
    shared_secret = x25519_checked_pure(recipient_private_key, ephemeral_public_key)
    stanza_key = blake3_derive_key(
        context, shared_secret + ephemeral_public_key + recipient_public_key
    )
    return open_once(stanza_key, associated_data, stanza[32:])


def account_stanza(
    account_public_key: bytes, ephemeral_private_key: bytes, header_hash: bytes, file_key: bytes
) -> bytes:
    """Section 8.1, wrap. The stanza has 96 bytes."""
    _need(header_hash, 32, "header_hash")
    _need(file_key, 32, "file_key")
    exchange_public_key = ed2curve_public(account_public_key)
    return public_wrap(exchange_public_key, ephemeral_private_key, CONTEXT_ACCOUNT_STANZA, header_hash, file_key)


def open_account_stanza(account_private_key: bytes, header_hash: bytes, stanza: bytes) -> bytes:
    """Section 8.1, unwrap."""
    _need(stanza, 96, "account stanza")
    exchange_private_key = ed2curve_private(account_private_key)
    return public_unwrap(exchange_private_key, CONTEXT_ACCOUNT_STANZA, header_hash, stanza)


# --------------------------------------------------------------------------
# Section 8.2. Password stanza.
# --------------------------------------------------------------------------


def password_key_of(
    password: str,
    password_salt: bytes,
    link_secret: bytes,
    owner_public_key: bytes,
    header_hash: bytes,
    memory_kib: int = ARGON2_MEMORY_KIB,
    passes: int = ARGON2_PASSES,
    lanes: int = ARGON2_LANES,
) -> bytes:
    _need(password_salt, 32, "password_salt")
    _need(link_secret, 32, "link_secret")
    _need(owner_public_key, 32, "owner_public_key")
    _need(header_hash, 32, "header_hash")
    stretched_password = argon2id(encode_secret_text(password), password_salt, memory_kib, passes, lanes)
    return blake3_derive_key(
        CONTEXT_PASSWORD_STANZA, stretched_password + link_secret + owner_public_key + header_hash
    )


def password_stanza(
    password: str,
    password_salt: bytes,
    link_secret: bytes,
    owner_public_key: bytes,
    header_hash: bytes,
    file_key: bytes,
    link_secret_nonce: bytes,
    memory_kib: int = ARGON2_MEMORY_KIB,
    passes: int = ARGON2_PASSES,
    lanes: int = ARGON2_LANES,
) -> tuple[bytes, bytes]:
    """Section 8.2, wrap. Returns (password_key, stanza).

    The stanza has 32 + 32 + 64 + 88 = 216 bytes: `wrapped_file_key` is a
    `seal_once` box without a nonce, `sealed_link_secret` is a `seal` box
    with its random nonce.
    """
    _need(file_key, 32, "file_key")
    password_key = password_key_of(
        password, password_salt, link_secret, owner_public_key, header_hash, memory_kib, passes, lanes
    )
    wrapped_file_key = seal_once(password_key, header_hash, file_key)
    link_secret_key = file_keys(file_key)["link_secret_key"]
    sealed_link_secret = seal(link_secret_key, link_secret_nonce, header_hash, link_secret)
    return password_key, password_salt + owner_public_key + wrapped_file_key + sealed_link_secret


_WRAPPED_FILE_KEY_SIZE = 32 + TAG_SIZE  # 64, seal_once
_SEALED_LINK_SECRET_SIZE = NONCE_SIZE + 32 + TAG_SIZE  # 88, seal
PASSWORD_STANZA_SIZE = 64 + _WRAPPED_FILE_KEY_SIZE + _SEALED_LINK_SECRET_SIZE  # 216


def open_password_stanza(
    password: str,
    link_secret: bytes,
    header_hash: bytes,
    stanza: bytes,
    memory_kib: int = ARGON2_MEMORY_KIB,
    passes: int = ARGON2_PASSES,
    lanes: int = ARGON2_LANES,
) -> bytes:
    """Section 8.2, unwrap. For the visitor, who has the link and the password.

    The visitor does not open `sealed_link_secret`: its key comes from
    `file_key`. A change in the last 88 bytes thus does not stop this
    procedure.
    """
    _need(stanza, PASSWORD_STANZA_SIZE, "password stanza")
    password_salt, owner_public_key = stanza[:32], stanza[32:64]
    wrapped_file_key = stanza[64 : 64 + _WRAPPED_FILE_KEY_SIZE]
    password_key = password_key_of(
        password, password_salt, link_secret, owner_public_key, header_hash, memory_kib, passes, lanes
    )
    return open_once(password_key, header_hash, wrapped_file_key)


def open_link_secret_copy(file_key: bytes, header_hash: bytes, stanza: bytes) -> bytes:
    """Section 8.2: the owner has file_key and gets link_secret back."""
    _need(stanza, PASSWORD_STANZA_SIZE, "password stanza")
    sealed_link_secret = stanza[64 + _WRAPPED_FILE_KEY_SIZE :]
    return open_sealed(file_keys(file_key)["link_secret_key"], header_hash, sealed_link_secret)


# --------------------------------------------------------------------------
# Section 8.3.3. Keyring.
# --------------------------------------------------------------------------


def keyring_key_of(account_private_key: bytes) -> bytes:
    _need(account_private_key, 32, "account_private_key")
    return blake3_derive_key(CONTEXT_KEYRING, account_private_key)


def seal_keyring(
    account_private_key: bytes, account_public_key: bytes, nonce: bytes, old_private_keys: list[bytes]
) -> tuple[bytes, bytes]:
    """Steps 4 and 5 with rule 11. Returns (keyring_key, sealed_keyring).

    Rule 11: an account with no old key has no `sealed_keyring`. An empty
    list is an error.
    """
    _need(account_public_key, 32, "account_public_key")
    if not old_private_keys:
        raise Reject("a sealed empty list of old private keys is not permitted", "empty_keyring")
    for key in old_private_keys:
        _need(key, 32, "old private key")
    keyring_key = keyring_key_of(account_private_key)
    return keyring_key, seal(keyring_key, nonce, account_public_key, b"".join(old_private_keys))


def open_keyring(account_private_key: bytes, account_public_key: bytes, sealed_keyring: bytes) -> list[bytes]:
    plaintext = open_sealed(keyring_key_of(account_private_key), account_public_key, sealed_keyring)
    if len(plaintext) % 32 != 0:
        raise Reject("old_private_keys is not a list of 32-byte seeds")
    return [plaintext[i : i + 32] for i in range(0, len(plaintext), 32)]


# --------------------------------------------------------------------------
# Section 8.4. Folders.
# --------------------------------------------------------------------------


def folder_keys(
    folder_private_key: bytes,
    account_private_key: bytes,
    metadata_nonce: bytes,
    private_key_nonce: bytes,
    folder_metadata: bytes,
) -> dict[str, bytes]:
    """Section 8.4.2 steps 1 to 4. `folder_private_key` is used as given, not clamped."""
    _need(folder_private_key, 32, "folder_private_key")
    _need(account_private_key, 32, "account_private_key")
    folder_public_key = x25519_public_key(folder_private_key)
    folder_metadata_key = blake3_derive_key(CONTEXT_FOLDER_METADATA, folder_private_key)
    folder_owner_key = blake3_derive_key(CONTEXT_FOLDER_OWNER, account_private_key)
    return {
        "folder_public_key": folder_public_key,
        "folder_metadata_key": folder_metadata_key,
        "sealed_folder_metadata": seal(folder_metadata_key, metadata_nonce, folder_public_key, folder_metadata),
        "folder_owner_key": folder_owner_key,
        "sealed_folder_private_key": seal(
            folder_owner_key, private_key_nonce, folder_public_key, folder_private_key
        ),
    }


def open_folder_metadata(folder_private_key: bytes, sealed_folder_metadata: bytes) -> bytes:
    folder_public_key = x25519_pure(folder_private_key, X25519_BASE_POINT)
    folder_metadata_key = blake3_derive_key(CONTEXT_FOLDER_METADATA, folder_private_key)
    return open_sealed(folder_metadata_key, folder_public_key, sealed_folder_metadata)


def open_folder_private_key(
    account_private_key: bytes, folder_public_key: bytes, sealed_folder_private_key: bytes
) -> bytes:
    """The owner opens the copy, then gets folder_public_key from the private key (8.4.2)."""
    folder_owner_key = blake3_derive_key(CONTEXT_FOLDER_OWNER, account_private_key)
    folder_private_key = open_sealed(folder_owner_key, folder_public_key, sealed_folder_private_key)
    if x25519_pure(folder_private_key, X25519_BASE_POINT) != folder_public_key:
        raise Reject("folder_private_key does not give folder_public_key", "key_mismatch")
    return folder_private_key


def open_parent_folder_stanza(
    parent_folder_private_key: bytes, child_folder_public_key: bytes, stanza: bytes
) -> bytes:
    """Section 8.4.2: open the stanza, then check that the private key gives the public key of the record."""
    child_folder_private_key = public_unwrap(
        parent_folder_private_key, CONTEXT_PARENT_FOLDER_STANZA, child_folder_public_key, stanza
    )
    _need(child_folder_private_key, 32, "folder_private_key")
    if x25519_pure(child_folder_private_key, X25519_BASE_POINT) != child_folder_public_key:
        raise Reject("folder_private_key does not give folder_public_key", "key_mismatch")
    return child_folder_private_key


def open_folder_file_stanza(folder_private_key: bytes, header_hash: bytes, stanza: bytes) -> bytes:
    return public_unwrap(folder_private_key, CONTEXT_FOLDER_FILE_STANZA, header_hash, stanza)


def open_folder_link_secret_stanza(folder_private_key: bytes, header_hash: bytes, stanza: bytes) -> bytes:
    return public_unwrap(folder_private_key, CONTEXT_FOLDER_LINK_SECRET_STANZA, header_hash, stanza)


def parent_folder_stanza(
    parent_folder_public_key: bytes,
    ephemeral_private_key: bytes,
    child_folder_public_key: bytes,
    child_folder_private_key: bytes,
) -> bytes:
    """Section 8.4.2 step 5."""
    return public_wrap(
        parent_folder_public_key,
        ephemeral_private_key,
        CONTEXT_PARENT_FOLDER_STANZA,
        child_folder_public_key,
        child_folder_private_key,
    )


def folder_file_stanza(
    folder_public_key: bytes, ephemeral_private_key: bytes, header_hash: bytes, file_key: bytes
) -> bytes:
    """Section 8.4.3."""
    return public_wrap(folder_public_key, ephemeral_private_key, CONTEXT_FOLDER_FILE_STANZA, header_hash, file_key)


def folder_link_secret_stanza(
    folder_public_key: bytes, ephemeral_private_key: bytes, header_hash: bytes, link_secret: bytes
) -> bytes:
    """Section 8.4.3."""
    return public_wrap(
        folder_public_key, ephemeral_private_key, CONTEXT_FOLDER_LINK_SECRET_STANZA, header_hash, link_secret
    )


# --------------------------------------------------------------------------
# Section 9.5. Tags.
# --------------------------------------------------------------------------


def tag_key_of(account_private_key: bytes) -> bytes:
    _need(account_private_key, 32, "account_private_key")
    return blake3_derive_key(CONTEXT_TAG_METADATA, account_private_key)


def seal_tag_metadata(
    account_private_key: bytes, account_public_key: bytes, nonce: bytes, tag_metadata: bytes
) -> tuple[bytes, bytes]:
    """Sections 9.5.1 and 9.5.2. Returns (tag_key, sealed_tag_metadata)."""
    _need(account_public_key, 32, "account_public_key")
    tag_key = tag_key_of(account_private_key)
    return tag_key, seal(tag_key, nonce, account_public_key, tag_metadata)


def open_tag_metadata(account_private_key: bytes, account_public_key: bytes, sealed_tag_metadata: bytes) -> bytes:
    return open_sealed(tag_key_of(account_private_key), account_public_key, sealed_tag_metadata)
