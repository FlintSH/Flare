"""Makes lib/e2ee/vectors/v1.json from reference.py.

Usage:
    python generate_vectors.py            write the vector file
    python generate_vectors.py --check    make the vectors and compare them with the file
    python generate_vectors.py --output PATH

Each input is fixed, thus two runs give the same bytes. Before a vector is
written, its output is opened again by the reverse procedure of reference.py
(which uses separate pure Python primitives) and compared with the input.

A vector whose name starts with `rejects ` or `decrypt_rejects ` has the
output `{"error": true}`. Before it is written, the strict procedure of
reference.py must reject its input for the stated cause, and a second check
shows that no other cause exists: a reader without the rule opens the same
input, or the input without the change opens. For the sealed empty keyring,
`open` of section 4.2 accepts the box and gives the empty byte string.
"""

from __future__ import annotations

import argparse
import json
import sys
import unicodedata
from pathlib import Path

import blake3

import known_answers
import reference as ref

DEFAULT_OUTPUT = Path(__file__).resolve().parents[2] / "lib" / "e2ee" / "vectors" / "v1.json"

FAST = {"memory_kib": 8, "passes": 1, "lanes": 1}
REAL = {"memory_kib": 65536, "passes": 3, "lanes": 4}

REQUIRED_FILE_LENGTHS = [0, 1, 65535, 65536, 65537, 131072, 200000]


# --------------------------------------------------------------------------
# Fixed test inputs.
# --------------------------------------------------------------------------


def fixed(label: str, count: int = 32) -> bytes:
    """`count` bytes that depend only on the label (BLAKE3 extended output)."""
    return blake3.blake3(b"flare e2ee v1 test vector input: " + label.encode("ascii")).digest(count)


def sequence(count: int, start: int = 0) -> bytes:
    """Bytes start, start + 1, ... modulo 256."""
    return bytes((start + i) % 256 for i in range(count))


def pattern(count: int) -> bytes:
    """SCHEMA.md, `file`: the plaintext byte at offset i is i mod 251."""
    return bytes(i % 251 for i in range(count))


def b(value: str) -> bytes:
    return bytes.fromhex(value)


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(f"self-check failed: {message}")


def expect_reject(message: str, function, *arguments) -> None:
    try:
        function(*arguments)
    except ref.Reject:
        return
    raise AssertionError(f"self-check failed: no rejection: {message}")


def expect_reason(reason: str, message: str, function, *arguments) -> None:
    """The call must fail, and for this cause."""
    try:
        function(*arguments)
    except ref.Reject as error:
        check(error.reason == reason, f"{message}: rejected for '{error.reason}', not for '{reason}'")
        return
    raise AssertionError(f"self-check failed: no rejection: {message}")


def flip(data: bytes, index: int = 0) -> bytes:
    changed = bytearray(data)
    changed[index] ^= 0x01
    return bytes(changed)


def one_byte_differs(first: bytes, second: bytes) -> bool:
    return len(first) == len(second) and sum(x != y for x, y in zip(first, second)) == 1


ERROR_OUTPUT = {"error": True}
P = ref.FIELD_PRIME


def set_highest_bit(public_key: bytes) -> bytes:
    """A form that is not canonical: the highest bit of the last byte is 1."""
    return public_key[:31] + bytes([public_key[31] | 0x80])


# A form that is not canonical: the value 2^255 - 19 + 9. The highest bit is
# 0. X25519 of RFC 7748 reads it as u = 9, the base point.
BASE_POINT_PLUS_P = (P + 9).to_bytes(32, "little")


def lax_stanza(recipient_private_key: bytes, ephemeral_public_key: bytes, context: str, associated_data: bytes, secret: bytes) -> bytes:
    """A stanza for given `ephemeral_public_key` bytes, made WITHOUT rule 3a.

    It is what a wrong writer would send. Each step is section 8.4.1 except
    the check of the canonical form. A reader without that check opens it.
    """
    recipient_public_key = ref.x25519_pure(recipient_private_key, ref.X25519_BASE_POINT)
    shared_secret = ref.x25519_checked_pure(recipient_private_key, ephemeral_public_key)
    stanza_key = ref.blake3_derive_key(context, shared_secret + ephemeral_public_key + recipient_public_key)
    return ephemeral_public_key + ref.seal_once(stanza_key, associated_data, secret)


def lax_unwrap(recipient_private_key: bytes, context: str, associated_data: bytes, stanza: bytes) -> bytes:
    """`public_unwrap` WITHOUT rule 3a."""
    ephemeral_public_key = stanza[:32]
    recipient_public_key = ref.x25519_pure(recipient_private_key, ref.X25519_BASE_POINT)
    shared_secret = ref.x25519_checked_pure(recipient_private_key, ephemeral_public_key)
    stanza_key = ref.blake3_derive_key(context, shared_secret + ephemeral_public_key + recipient_public_key)
    return ref.open_once(stanza_key, associated_data, stanza[32:])


# --------------------------------------------------------------------------
# One function for each procedure of SCHEMA.md. Each takes the `input`
# object of a vector (JSON types) and returns the `output` object. Each does
# its round-trip self-check before it returns.
# --------------------------------------------------------------------------


def run_blake3_derive_key(i: dict) -> dict:
    return {"key": ref.blake3_derive_key(i["context_text"], b(i["key_material"])).hex()}


def run_blake3_keyed_hash(i: dict) -> dict:
    return {"hash": ref.blake3_keyed_hash(b(i["key"]), b(i["message"])).hex()}


def run_seal(i: dict) -> dict:
    key, nonce, associated_data, message = b(i["key"]), b(i["nonce"]), b(i["associated_data"]), b(i["message"])
    sealed_box = ref.seal(key, nonce, associated_data, message)
    check(len(sealed_box) == 24 + len(message) + 32, "seal length")
    check(ref.open_sealed(key, associated_data, sealed_box) == message, "seal round trip")
    expect_reject("seal, changed tag", ref.open_sealed, key, associated_data, flip(sealed_box, -1))
    expect_reject("seal, changed nonce", ref.open_sealed, key, associated_data, flip(sealed_box, 0))
    expect_reject("seal, changed associated data", ref.open_sealed, key, associated_data + b"\x00", sealed_box)
    expect_reject("seal, changed key", ref.open_sealed, flip(key), associated_data, sealed_box)
    if message:
        expect_reject("seal, changed ciphertext", ref.open_sealed, key, associated_data, flip(sealed_box, 24))
    expect_reason("length", "seal, 55 bytes", ref.open_sealed, key, associated_data, sealed_box[:24] + sealed_box[-31:])
    # Section 4.2.1: seal_once is seal with the nonce from the key, without the nonce in the output.
    once = ref.seal_once(key, associated_data, message)
    check(len(once) == len(message) + 32, "seal_once length")
    check(ref.one_time_nonce(key) + once == ref.seal(key, ref.one_time_nonce(key), associated_data, message), "seal_once is seal")
    check(ref.open_once(key, associated_data, once) == message, "seal_once round trip")
    expect_reason("tag", "seal_once, changed tag", ref.open_once, key, associated_data, flip(once, -1))
    expect_reason("tag", "seal_once, changed key", ref.open_once, flip(key), associated_data, once)
    expect_reason("length", "seal_once, 31 bytes", ref.open_once, key, associated_data, once[-31:])
    return {"sealed_box": sealed_box.hex()}


def run_account_keys(i: dict) -> dict:
    root_entropy = b(i["root_entropy"])
    keys = ref.account_keys(root_entropy)
    check(ref.entropy_from_mnemonic(keys["mnemonic_text"]) == root_entropy, "mnemonic round trip")
    check(keys["mnemonic_text"] == keys["mnemonic_text"].lower(), "mnemonic is lower case")
    loose = keys["mnemonic_text"].upper().replace(" ", "  ")
    check(ref.entropy_from_mnemonic(loose) == root_entropy, "mnemonic reader accepts upper case and more spaces")
    check(len(keys["mnemonic_text"].split(" ")) == 24, "mnemonic has 24 words")
    check(
        ref.x25519_pure(keys["exchange_private_key"], ref.X25519_BASE_POINT) == keys["exchange_public_key"],
        "exchange key pair",
    )
    signature = ref.ed25519_sign(keys["account_private_key"], b"self-check")
    check(ref.ed25519_verify(keys["account_public_key"], b"self-check", signature), "account key pair")
    return {name: value if isinstance(value, str) else value.hex() for name, value in keys.items()}


def run_passphrase_keys(i: dict) -> dict:
    keys = ref.passphrase_keys(
        i["passphrase_text"], b(i["passphrase_salt"]), i["memory_kib"], i["passes"], i["lanes"]
    )
    signature = ref.ed25519_sign(keys["auth_private_key"], b"self-check")
    check(ref.ed25519_verify(keys["auth_public_key"], b"self-check", signature), "sign-in key pair")
    check(keys["auth_private_key"] != keys["wrap_key"], "auth_private_key and wrap_key are different")
    return {name: value.hex() for name, value in keys.items()}


def run_wrapped_root(i: dict) -> dict:
    wrap_key, account_public_key, root_entropy = b(i["wrap_key"]), b(i["account_public_key"]), b(i["root_entropy"])
    wrapped_root = ref.wrap_root(wrap_key, b(i["nonce"]), account_public_key, root_entropy)
    check(len(wrapped_root) == 88, "wrapped_root has 88 bytes")
    check(ref.unwrap_root(wrap_key, account_public_key, wrapped_root) == root_entropy, "wrapped_root round trip")
    expect_reject("wrapped_root, wrong key", ref.unwrap_root, flip(wrap_key), account_public_key, wrapped_root)
    return {"wrapped_root": wrapped_root.hex()}


def run_sign_in_signature(i: dict) -> dict:
    auth_private_key, challenge = b(i["auth_private_key"]), b(i["challenge"])
    signature = ref.sign_in_signature(auth_private_key, challenge, i["identifier_text"])
    message = ref.sign_in_message(challenge, i["identifier_text"])
    check(len(message) == 21 + 32 + 32, "sign-in message length")
    check(ref.ed25519_verify(ref.ed25519_public_key(auth_private_key), message, signature), "sign-in signature")
    # Section 6.3: a signature for one request is not valid for the other.
    auth_public_key = ref.ed25519_public_key(auth_private_key)
    ref.verify_sign_in_signature(auth_public_key, challenge, i["identifier_text"], signature)
    expect_reason(
        "signature", "a sign-in signature does not verify as an unlock signature",
        ref.verify_unlock_signature, auth_public_key, challenge, i["identifier_text"], signature,
    )
    normalized = ref.normalize_identifier(i["identifier_text"])
    check(message[53:] == ref.blake3_hash(normalized.encode("utf-8")), "sign-in message uses the normalized identifier")
    check(ref.normalize_identifier(normalized) == normalized, "normalization of the normalized identifier changes nothing")
    return {"signature": signature.hex(), "identifier_normalized_text": normalized}


def run_unlock_signature(i: dict) -> dict:
    """Section 6.3 step 4."""
    auth_private_key, challenge, identifier = b(i["auth_private_key"]), b(i["challenge"]), i["identifier_text"]
    auth_public_key = ref.ed25519_public_key(auth_private_key)
    signature = ref.unlock_signature(auth_private_key, challenge, identifier)
    message = ref.unlock_message(challenge, identifier)
    normalized = ref.normalize_identifier(identifier)
    check(len(message) == 20 + 32 + 32, "unlock message length")
    check(
        message == b"flare e2ee v1 unlock" + challenge + ref.blake3_hash(normalized.encode("utf-8")),
        "unlock message uses its context string and the normalized identifier",
    )
    check(ref.normalize_identifier(normalized) == normalized, "normalization of the normalized identifier changes nothing")
    check(len(signature) == 64, "unlock signature has 64 bytes")
    check(ref.ed25519_verify(auth_public_key, message, signature), "unlock signature")
    ref.verify_unlock_signature(auth_public_key, challenge, identifier, signature)
    ref.verify_unlock_signature(auth_public_key, challenge, normalized, signature)
    # Section 6.3: a signature for one request is not valid for the other.
    expect_reason(
        "signature", "an unlock signature does not verify as a sign-in signature",
        ref.verify_sign_in_signature, auth_public_key, challenge, identifier, signature,
    )
    sign_in = ref.sign_in_signature(auth_private_key, challenge, identifier)
    check(sign_in != signature, "the sign-in signature and the unlock signature are different")
    ref.verify_sign_in_signature(auth_public_key, challenge, identifier, sign_in)
    expect_reason(
        "signature", "a sign-in signature does not verify as an unlock signature",
        ref.verify_unlock_signature, auth_public_key, challenge, identifier, sign_in,
    )
    expect_reason(
        "signature", "unlock signature, other challenge",
        ref.verify_unlock_signature, auth_public_key, flip(challenge), identifier, signature,
    )
    expect_reason(
        "signature", "unlock signature, other identifier",
        ref.verify_unlock_signature, auth_public_key, challenge, identifier + "x", signature,
    )
    expect_reason(
        "signature", "unlock signature, other key",
        ref.verify_unlock_signature, ref.ed25519_public_key(flip(auth_private_key)), challenge, identifier, signature,
    )
    return {"identifier_normalized_text": normalized, "signature": signature.hex()}


def run_signed_request(i: dict) -> dict:
    account_private_key = b(i["account_private_key"])
    signed_message, signature = ref.signed_request(
        account_private_key, b(i["challenge"]), i["method_text"], i["path_text"], b(i["body"])
    )
    check(len(signed_message) == 21 + 32 + 32 + 32, "signed_message length")
    check(
        ref.ed25519_verify(ref.ed25519_public_key(account_private_key), signed_message, signature),
        "request signature",
    )
    public_key = ref.ed25519_public_key(account_private_key)
    arguments = (b(i["challenge"]), i["method_text"], i["path_text"], b(i["body"]), signature)
    ref.verify_signed_request(public_key, *arguments)
    check(i["path_text"].isascii(), "path is in the percent-encoded form")
    # Rule 8: a verifier rejects a method that is not upper case ASCII.
    for method in (i["method_text"].lower(), i["method_text"].capitalize(), i["method_text"] + " ", ""):
        expect_reason(
            "method", f"signed request, method {method!r}", ref.verify_signed_request,
            public_key, b(i["challenge"]), method, i["path_text"], b(i["body"]), signature,
        )
    expect_reason(
        "signature", "signed request, other method", ref.verify_signed_request,
        public_key, b(i["challenge"]), "OPTIONS", i["path_text"], b(i["body"]), signature,
    )
    return {"signed_message": signed_message.hex(), "signature": signature.hex()}


def run_file_keys(i: dict) -> dict:
    keys = ref.file_keys(b(i["file_key"]))
    check(len(set(keys.values())) == 6, "the six file keys are different")
    return {name: value.hex() for name, value in keys.items()}


def run_header(i: dict) -> dict:
    header = ref.build_header(b(i["nonce_prefix"]))
    check(len(header) == 26, "header has 26 bytes")
    return {"header": header.hex(), "header_hash": ref.header_hash_of(header).hex()}


def run_file_chunk(i: dict) -> dict:
    file_key, nonce_prefix = b(i["file_key"]), b(i["nonce_prefix"])
    chunk_index, is_final, chunk_plaintext = i["chunk_index"], i["is_final"], b(i["chunk_plaintext"])
    stored_chunk = ref.encrypt_chunk(file_key, nonce_prefix, chunk_index, is_final, chunk_plaintext)
    check(len(stored_chunk) == len(chunk_plaintext) + 32, "stored chunk length")
    # Independent check: tag and plaintext with the pure Python cipher.
    keys = ref.file_keys(file_key)
    header_hash = ref.header_hash_of(ref.build_header(nonce_prefix))
    ciphertext, tag = stored_chunk[:-32], stored_chunk[-32:]
    expected_tag = ref.blake3_keyed_hash(
        keys["content_mac_key"],
        header_hash + chunk_index.to_bytes(8, "little") + (b"\x01" if is_final else b"\x00") + ciphertext,
    )
    check(expected_tag == tag, "chunk tag")
    nonce = nonce_prefix + chunk_index.to_bytes(8, "little")
    check(ref.xchacha20_pure(keys["content_cipher_key"], nonce, ciphertext) == chunk_plaintext, "chunk round trip")
    check(
        ref.decrypt_chunk(file_key, nonce_prefix, chunk_index, is_final, stored_chunk) == chunk_plaintext,
        "decrypt_chunk round trip",
    )
    expect_reason("tag", "chunk, other index", ref.decrypt_chunk, file_key, nonce_prefix, chunk_index + 1, is_final, stored_chunk)
    expect_reason("tag", "chunk, changed tag", ref.decrypt_chunk, file_key, nonce_prefix, chunk_index, is_final, flip(stored_chunk, -1))
    if len(chunk_plaintext) == 65536:
        expect_reason("tag", "chunk, other final flag", ref.decrypt_chunk, file_key, nonce_prefix, chunk_index, not is_final, stored_chunk)
    return {"stored_chunk": stored_chunk.hex()}


def raw_stored_chunk(file_key: bytes, nonce_prefix: bytes, chunk_index: int, is_final: bool, chunk_plaintext: bytes) -> bytes:
    """Section 7.3 steps 1 to 5 WITHOUT the rules of section 7.4.

    It makes a chunk with a correct tag that a writer must not make, for
    example a final chunk of length zero at an index above 0.
    """
    keys = ref.file_keys(file_key)
    header_hash = ref.header_hash_of(ref.build_header(nonce_prefix))
    ciphertext = ref.xchacha20_pure(keys["content_cipher_key"], nonce_prefix + ref.le64(chunk_index), chunk_plaintext)
    tag = ref.blake3_keyed_hash(
        keys["content_mac_key"],
        header_hash + ref.le64(chunk_index) + (b"\x01" if is_final else b"\x00") + ciphertext,
    )
    return ciphertext + tag


def run_file_chunk_decrypt_rejects(i: dict, expect: dict) -> dict:
    check(set(i) == {"file_key", "nonce_prefix", "chunk_index", "is_final", "stored_chunk"}, "decrypt_rejects input fields")
    file_key, nonce_prefix = b(i["file_key"]), b(i["nonce_prefix"])
    arguments = (file_key, nonce_prefix, i["chunk_index"], i["is_final"], b(i["stored_chunk"]))
    expect_reason(expect["reason"], "decrypt_rejects", ref.decrypt_chunk, *arguments)
    if expect["reason"] != "tag":
        # The tag is correct, thus the stated rule is the only cause.
        check(raw_stored_chunk(*arguments[:4], expect["plaintext"]) == arguments[4], "decrypt_rejects chunk has a correct tag")
    else:
        # The chunk opens with the values of `opens_as`.
        original = dict(i, **expect["opens_as"])
        ref.decrypt_chunk(
            b(original["file_key"]), b(original["nonce_prefix"]), original["chunk_index"], original["is_final"], b(original["stored_chunk"])
        )
    return dict(ERROR_OUTPUT)


def run_file(i: dict) -> dict:
    file_key, nonce_prefix, plaintext_length = b(i["file_key"]), b(i["nonce_prefix"]), i["plaintext_length"]
    plaintext = pattern(plaintext_length)
    stored_file = ref.encrypt_file(file_key, nonce_prefix, plaintext)
    chunk_count = max(1, -(-plaintext_length // 65536))
    check(len(stored_file) == 26 + plaintext_length + 32 * chunk_count, "stored file length")
    check(ref.decrypt_file(file_key, stored_file) == plaintext, "file round trip")
    expect_reject("file, last byte removed", ref.decrypt_file, file_key, stored_file[:-1])
    expect_reject("file, one byte added", ref.decrypt_file, file_key, stored_file + b"\x00")
    expect_reason("tag", "file, changed nonce prefix", ref.decrypt_file, file_key, flip(stored_file, 10))
    expect_reason("header", "file, changed magic", ref.decrypt_file, file_key, flip(stored_file, 0))
    expect_reason("header", "file, changed format_version", ref.decrypt_file, file_key, flip(stored_file, 8))
    for value in (0, 15, 17, 255):  # section 7.4 rule 9
        other = stored_file[:9] + bytes([value]) + stored_file[10:]
        expect_reason("header", f"file, chunk_size_log2 = {value}", ref.decrypt_file, file_key, other)
    if plaintext_length > 0 and plaintext_length % 65536 == 0:
        # Section 7.4 rule 8. The second form of the same plaintext: each
        # full chunk is not final, and a final chunk of length zero follows.
        # Each tag is correct. The reader must reject it all the same.
        second_form = bytearray(ref.build_header(nonce_prefix))
        for index in range(chunk_count):
            second_form += ref.encrypt_chunk(file_key, nonce_prefix, index, False, plaintext[index * 65536 : (index + 1) * 65536])
        second_form += raw_stored_chunk(file_key, nonce_prefix, chunk_count, True, b"")
        expect_reason("empty_final_chunk", "file, zero-length final chunk after a full chunk", ref.decrypt_file, file_key, bytes(second_form))
    if chunk_count > 1:
        expect_reject("file, last chunk removed", ref.decrypt_file, file_key, stored_file[: 26 + 65568])
        for index in range(chunk_count):
            # Section 7.5: the stored chunk starts at offset 26 + chunk_index * 65568.
            start = 26 + index * 65568
            chunk = ref.encrypt_chunk(
                file_key, nonce_prefix, index, index == chunk_count - 1, plaintext[index * 65536 : (index + 1) * 65536]
            )
            check(stored_file[start : start + len(chunk)] == chunk, "chunk offset")
    return {"stored_length": len(stored_file), "stored_blake3": ref.blake3_hash(stored_file).hex()}


def run_sealed_metadata(i: dict) -> dict:
    file_key, header_hash = b(i["file_key"]), b(i["header_hash"])
    plaintext = i["file_metadata_text"].encode("utf-8")
    json.loads(plaintext)
    sealed = ref.seal_metadata(file_key, b(i["nonce"]), header_hash, plaintext)
    check(ref.open_metadata(file_key, header_hash, sealed) == plaintext, "sealed_metadata round trip")
    return {"sealed_metadata": sealed.hex()}


def run_sealed_ocr_text(i: dict) -> dict:
    file_key, header_hash = b(i["file_key"]), b(i["header_hash"])
    plaintext = i["ocr_text"].encode("utf-8")
    sealed = ref.seal_ocr_text(file_key, b(i["nonce"]), header_hash, plaintext)
    check(ref.open_ocr_text(file_key, header_hash, sealed) == plaintext, "sealed_ocr_text round trip")
    return {"sealed_ocr_text": sealed.hex()}


def run_sealed_thumbnail(i: dict) -> dict:
    file_key, header_hash, plaintext = b(i["file_key"]), b(i["header_hash"]), b(i["thumbnail"])
    sealed = ref.seal_thumbnail(file_key, b(i["nonce"]), header_hash, plaintext)
    check(ref.open_thumbnail(file_key, header_hash, sealed) == plaintext, "sealed_thumbnail round trip")
    expect_reject("thumbnail does not open as OCR text", ref.open_ocr_text, file_key, header_hash, sealed)
    return {"sealed_thumbnail": sealed.hex()}


KNOWN_X25519_PRIVATE_KEYS: dict[bytes, bytes] = {}
KNOWN_ED25519_SEEDS: dict[bytes, bytes] = {}


def x25519_pair(label: str) -> tuple[bytes, bytes]:
    private_key = fixed(label)
    public_key = ref.x25519_public_key(private_key)
    KNOWN_X25519_PRIVATE_KEYS[public_key] = private_key
    return private_key, public_key


def ed25519_pair(label: str) -> tuple[bytes, bytes]:
    seed = fixed(label)
    public_key = ref.ed25519_public_key(seed)
    KNOWN_ED25519_SEEDS[public_key] = seed
    return seed, public_key


def run_public_wrap(i: dict) -> dict:
    recipient_public_key, associated_data, secret = b(i["recipient_public_key"]), b(i["associated_data"]), b(i["secret"])
    stanza = ref.public_wrap(
        recipient_public_key, b(i["ephemeral_private_key"]), i["context_text"], associated_data, secret
    )
    check(len(stanza) == 32 + len(secret) + 32, "stanza length")
    check(stanza[:32] == ref.x25519_pure(b(i["ephemeral_private_key"]), ref.X25519_BASE_POINT), "ephemeral public key")
    ref.check_canonical_x25519_public_key(stanza[:32], "ephemeral_public_key")
    private_key = KNOWN_X25519_PRIVATE_KEYS[recipient_public_key]
    check(ref.public_unwrap(private_key, i["context_text"], associated_data, stanza) == secret, "public_wrap round trip")
    check(lax_unwrap(private_key, i["context_text"], associated_data, stanza) == secret, "public_wrap, second reader")
    check(
        lax_stanza(private_key, stanza[:32], i["context_text"], associated_data, secret) == stanza,
        "public_wrap, stanza made from the side of the recipient",
    )
    expect_reason(
        "tag", "public_wrap, other context", ref.public_unwrap, private_key, i["context_text"] + "x", associated_data, stanza
    )
    expect_reason(
        "tag", "public_wrap, other associated data", ref.public_unwrap, private_key, i["context_text"], associated_data + b"\x00", stanza
    )
    expect_reason("length", "public_wrap, 63 bytes", ref.public_unwrap, private_key, i["context_text"], associated_data, stanza[:63])
    return {"stanza": stanza.hex()}


def run_account_stanza(i: dict) -> dict:
    account_public_key, header_hash, file_key = b(i["account_public_key"]), b(i["header_hash"]), b(i["file_key"])
    stanza = ref.account_stanza(account_public_key, b(i["ephemeral_private_key"]), header_hash, file_key)
    check(len(stanza) == 96, "account stanza has 96 bytes")
    seed = KNOWN_ED25519_SEEDS[account_public_key]
    check(ref.open_account_stanza(seed, header_hash, stanza) == file_key, "account stanza round trip")
    # Section 8.4.1: the account stanza is public_wrap with the exchange key.
    same = ref.public_wrap(
        ref.ed2curve_public(account_public_key),
        b(i["ephemeral_private_key"]),
        "flare e2ee v1 account stanza",
        header_hash,
        file_key,
    )
    check(same == stanza, "account stanza is public_wrap")
    expect_reason("tag", "account stanza, other file", ref.open_account_stanza, seed, flip(header_hash), stanza)
    return {"stanza": stanza.hex()}


def run_password_stanza(i: dict) -> dict:
    header_hash, file_key, link_secret = b(i["header_hash"]), b(i["file_key"]), b(i["link_secret"])
    parameters = (i["memory_kib"], i["passes"], i["lanes"])
    password_key, stanza = ref.password_stanza(
        i["password_text"],
        b(i["password_salt"]),
        link_secret,
        b(i["owner_public_key"]),
        header_hash,
        file_key,
        b(i["link_secret_nonce"]),
        *parameters,
    )
    check(len(stanza) == 216, "password stanza has 216 bytes")
    check(stanza[:32] == b(i["password_salt"]) and stanza[32:64] == b(i["owner_public_key"]), "password stanza layout")
    check(stanza[128:152] == b(i["link_secret_nonce"]), "sealed_link_secret has its nonce")
    check(stanza[64:128] == ref.seal_once(password_key, header_hash, file_key), "wrapped_file_key is seal_once")
    check(ref.open_link_secret_copy(file_key, header_hash, stanza) == link_secret, "sealed_link_secret round trip")
    if parameters == (FAST["memory_kib"], FAST["passes"], FAST["lanes"]):
        # The visitor path runs Argon2id again. Only the fast vectors do it, to keep the CPU use low.
        opened = ref.open_password_stanza(i["password_text"], link_secret, header_hash, stanza, *parameters)
        check(opened == file_key, "password stanza round trip")
        expect_reason(
            "tag",
            "password stanza, wrong password",
            ref.open_password_stanza,
            i["password_text"] + "x",
            link_secret,
            header_hash,
            stanza,
            *parameters,
        )
        expect_reason(
            "tag",
            "password stanza, wrong link secret",
            ref.open_password_stanza,
            i["password_text"],
            flip(link_secret),
            header_hash,
            stanza,
            *parameters,
        )
    else:
        check(ref.open_once(password_key, header_hash, stanza[64:128]) == file_key, "password stanza round trip")
    return {"password_key": password_key.hex(), "stanza": stanza.hex()}


def run_sealed_keyring(i: dict) -> dict:
    account_private_key, account_public_key = b(i["account_private_key"]), b(i["account_public_key"])
    old_private_keys = [b(key) for key in i["old_private_keys"]]
    check(ref.ed25519_public_key(account_private_key) == account_public_key, "keyring key pair")
    keyring_key, sealed_keyring = ref.seal_keyring(account_private_key, account_public_key, b(i["nonce"]), old_private_keys)
    check(len(sealed_keyring) == 56 + 32 * len(old_private_keys), "sealed_keyring length")
    check(
        ref.open_keyring(account_private_key, account_public_key, sealed_keyring) == old_private_keys,
        "sealed_keyring round trip",
    )
    # Section 4.4 rule 11: no sealed empty list.
    expect_reason("empty_keyring", "sealed empty keyring", ref.seal_keyring, account_private_key, account_public_key, b(i["nonce"]), [])
    # Rule 11, the reader: the same key and nonce with an empty list. The box is correct.
    empty = ref.seal(keyring_key, b(i["nonce"]), account_public_key, b"")
    check(ref.open_sealed(keyring_key, account_public_key, empty) == b"", "sealed empty keyring is a correct sealed box")
    expect_reason("empty_keyring", "reader of a sealed empty keyring", ref.open_keyring, account_private_key, account_public_key, empty)
    return {"keyring_key": keyring_key.hex(), "sealed_keyring": sealed_keyring.hex()}


def run_sealed_keyring_rejects(i: dict, expect: dict) -> dict:
    """Section 4.4 rule 11: a reader rejects a sealed empty list.

    The second check shows that only the rule rejects it: `open` of section
    4.2 accepts the tag and gives the empty byte string.
    """
    check(set(i) == {"direction_text", "account_private_key", "account_public_key", "sealed_keyring"}, "sealed_keyring rejection: input fields")
    check(i["direction_text"] == "open", "direction_text")
    check(expect["reason"] == "empty_keyring", "a sealed_keyring rejection is for an empty list")
    account_private_key, account_public_key = b(i["account_private_key"]), b(i["account_public_key"])
    sealed_keyring = b(i["sealed_keyring"])
    check(ref.ed25519_public_key(account_private_key) == account_public_key, "keyring key pair")
    check(len(sealed_keyring) == 56, "a sealed empty list has 56 bytes")
    expect_reason("empty_keyring", "sealed_keyring open", ref.open_keyring, account_private_key, account_public_key, sealed_keyring)
    keyring_key = ref.keyring_key_of(account_private_key)
    check(ref.open_sealed(keyring_key, account_public_key, sealed_keyring) == b"", "a reader without rule 11 opens the sealed empty list")
    check(ref.seal(keyring_key, sealed_keyring[:24], account_public_key, b"") == sealed_keyring, "the sealed empty list is made as section 8.3.3 step 5 says")
    return dict(ERROR_OUTPUT)


def run_folder(i: dict) -> dict:
    folder_private_key, account_private_key = b(i["folder_private_key"]), b(i["account_private_key"])
    folder_metadata = i["folder_metadata_text"].encode("utf-8")
    json.loads(folder_metadata)
    out = ref.folder_keys(
        folder_private_key, account_private_key, b(i["metadata_nonce"]), b(i["private_key_nonce"]), folder_metadata
    )
    check(
        ref.open_folder_metadata(folder_private_key, out["sealed_folder_metadata"]) == folder_metadata,
        "sealed_folder_metadata round trip",
    )
    check(
        ref.open_folder_private_key(account_private_key, out["folder_public_key"], out["sealed_folder_private_key"])
        == folder_private_key,
        "sealed_folder_private_key round trip",
    )
    ref.check_canonical_x25519_public_key(out["folder_public_key"], "folder_public_key")
    check(out["folder_public_key"] == ref.x25519_pure(folder_private_key, ref.X25519_BASE_POINT), "folder key pair")
    # Section 8.4.2: the copy of a different folder does not open as this folder.
    other_private_key = flip(folder_private_key, 5)
    other_copy = ref.seal(out["folder_owner_key"], b(i["private_key_nonce"]), out["folder_public_key"], other_private_key)
    expect_reason(
        "key_mismatch", "sealed_folder_private_key with a key of a different folder",
        ref.open_folder_private_key, account_private_key, out["folder_public_key"], other_copy,
    )
    return {name: value.hex() for name, value in out.items()}


def run_folder_stanzas(i: dict) -> dict:
    folder_public_key = b(i["folder_public_key"])
    ephemeral_keys = [b(i[f"{kind}_ephemeral_private_key"]) for kind in ("file", "link_secret", "parent")]
    # Section 8.4.1: a caller must not use one ephemeral key pair for two stanzas.
    check(len(set(ephemeral_keys)) == 3, "each folder stanza has its own ephemeral key")
    check("ephemeral_private_key" not in i, "no shared ephemeral key")
    header_hash, file_key, link_secret = b(i["header_hash"]), b(i["file_key"]), b(i["link_secret"])
    child_private_key, child_public_key = b(i["child_folder_private_key"]), b(i["child_folder_public_key"])
    check(ref.x25519_public_key(child_private_key) == child_public_key, "child folder key pair")
    file_stanza = ref.folder_file_stanza(folder_public_key, ephemeral_keys[0], header_hash, file_key)
    link_stanza = ref.folder_link_secret_stanza(folder_public_key, ephemeral_keys[1], header_hash, link_secret)
    parent_stanza = ref.parent_folder_stanza(folder_public_key, ephemeral_keys[2], child_public_key, child_private_key)
    check(len({file_stanza[:32], link_stanza[:32], parent_stanza[:32]}) == 3, "three ephemeral public keys")
    check(len(file_stanza) == 96 and len(link_stanza) == 96 and len(parent_stanza) == 96, "folder stanzas have 96 bytes")
    private_key = KNOWN_X25519_PRIVATE_KEYS[folder_public_key]
    check(ref.open_folder_file_stanza(private_key, header_hash, file_stanza) == file_key, "folder_file_stanza round trip")
    check(
        ref.open_folder_link_secret_stanza(private_key, header_hash, link_stanza) == link_secret,
        "folder_link_secret_stanza round trip",
    )
    check(
        ref.open_parent_folder_stanza(private_key, child_public_key, parent_stanza) == child_private_key,
        "parent_folder_stanza round trip",
    )
    expect_reason(
        "tag",
        "a folder file stanza does not open as a link secret stanza",
        ref.open_folder_link_secret_stanza,
        private_key,
        header_hash,
        file_stanza,
    )
    return {
        "folder_file_stanza": file_stanza.hex(),
        "folder_link_secret_stanza": link_stanza.hex(),
        "parent_folder_stanza": parent_stanza.hex(),
    }


# --------------------------------------------------------------------------
# `rejects ...` vectors of the procedures that wrap or open a stanza.
#
# input, unwrap:  direction_text "unwrap", the private key of the reader,
#                 the values that the reader has, and `stanza`.
# input, wrap:    direction_text "wrap" and the inputs of the wrap vector,
#                 with the public key that is not canonical.
# folder_stanzas: also stanza_kind_text "file", "link_secret" or "parent".
# output:         {"error": true}
# --------------------------------------------------------------------------

FOLDER_CONTEXTS = {
    "file": "flare e2ee v1 folder file stanza",
    "link_secret": "flare e2ee v1 folder link secret stanza",
    "parent": "flare e2ee v1 parent folder stanza",
}

UNWRAP_FIELDS = {
    ("public_wrap", None): {"direction_text", "recipient_private_key", "context_text", "associated_data", "stanza"},
    ("account_stanza", None): {"direction_text", "account_private_key", "header_hash", "stanza"},
    ("password_stanza", None): {"direction_text", "password_text", "link_secret", "header_hash", "stanza", "memory_kib", "passes", "lanes"},
    ("folder_stanzas", "file"): {"direction_text", "stanza_kind_text", "folder_private_key", "header_hash", "stanza"},
    ("folder_stanzas", "link_secret"): {"direction_text", "stanza_kind_text", "folder_private_key", "header_hash", "stanza"},
    ("folder_stanzas", "parent"): {"direction_text", "stanza_kind_text", "folder_private_key", "child_folder_public_key", "stanza"},
}


def strict_unwrap(procedure: str, i: dict) -> bytes:
    """The reader of reference.py for the `input` of an unwrap rejection."""
    stanza = b(i["stanza"])
    if procedure == "public_wrap":
        return ref.public_unwrap(b(i["recipient_private_key"]), i["context_text"], b(i["associated_data"]), stanza)
    if procedure == "account_stanza":
        return ref.open_account_stanza(b(i["account_private_key"]), b(i["header_hash"]), stanza)
    if procedure == "password_stanza":
        return ref.open_password_stanza(
            i["password_text"], b(i["link_secret"]), b(i["header_hash"]), stanza, i["memory_kib"], i["passes"], i["lanes"]
        )
    kind, private_key = i["stanza_kind_text"], b(i["folder_private_key"])
    if kind == "file":
        return ref.open_folder_file_stanza(private_key, b(i["header_hash"]), stanza)
    if kind == "link_secret":
        return ref.open_folder_link_secret_stanza(private_key, b(i["header_hash"]), stanza)
    return ref.open_parent_folder_stanza(private_key, b(i["child_folder_public_key"]), stanza)


def lax_reader_arguments(procedure: str, i: dict) -> tuple[bytes, str, bytes]:
    """(X25519 private key, context, associated data) of an unwrap rejection of a public-key stanza."""
    if procedure == "public_wrap":
        return b(i["recipient_private_key"]), i["context_text"], b(i["associated_data"])
    if procedure == "account_stanza":
        return ref.ed2curve_private(b(i["account_private_key"])), "flare e2ee v1 account stanza", b(i["header_hash"])
    kind = i["stanza_kind_text"]
    associated_data = b(i["child_folder_public_key"]) if kind == "parent" else b(i["header_hash"])
    return b(i["folder_private_key"]), FOLDER_CONTEXTS[kind], associated_data


def strict_wrap(procedure: str, i: dict) -> bytes:
    """The writer of reference.py for the `input` of a wrap rejection."""
    if procedure == "public_wrap":
        return ref.public_wrap(
            b(i["recipient_public_key"]), b(i["ephemeral_private_key"]), i["context_text"], b(i["associated_data"]), b(i["secret"])
        )
    if procedure == "account_stanza":
        return ref.account_stanza(b(i["account_public_key"]), b(i["ephemeral_private_key"]), b(i["header_hash"]), b(i["file_key"]))
    kind, folder_public_key = i["stanza_kind_text"], b(i["folder_public_key"])
    if kind == "file":
        return ref.folder_file_stanza(folder_public_key, b(i["file_ephemeral_private_key"]), b(i["header_hash"]), b(i["file_key"]))
    if kind == "link_secret":
        return ref.folder_link_secret_stanza(
            folder_public_key, b(i["link_secret_ephemeral_private_key"]), b(i["header_hash"]), b(i["link_secret"])
        )
    return ref.parent_folder_stanza(
        folder_public_key, b(i["parent_ephemeral_private_key"]), b(i["child_folder_public_key"]), b(i["child_folder_private_key"])
    )


def run_rejects(procedure: str, i: dict, expect: dict) -> dict:
    """`expect` is not written to the file. It says why the input must fail.

    reason        the cause that the strict procedure must give
    secret        for a key that is not canonical in a stanza: what a reader
                  without rule 3a gets from the same stanza
    original      for a changed byte: the stanza before the change
    """
    reason = expect["reason"]
    kind = i.get("stanza_kind_text")
    check((kind is not None) == (procedure == "folder_stanzas"), "stanza_kind_text is for folder_stanzas only")

    if i["direction_text"] == "wrap":
        check(reason == "not_canonical", "a wrap rejection is for a key that is not canonical")
        expect_reason(reason, f"{procedure} wrap", strict_wrap, procedure, i)
        if procedure == "account_stanza":
            # The Edwards y is p + k. Without the rule, it is the point with y = k, and the wrap works.
            y = int.from_bytes(b(i["account_public_key"]), "little")
            check(P <= y < 1 << 255, "account public key has y >= p and no sign bit")
            same_point = (y - P).to_bytes(32, "little")
            ref.account_stanza(same_point, b(i["ephemeral_private_key"]), b(i["header_hash"]), b(i["file_key"]))
        else:
            # Without the rule, X25519 gives a shared secret that is not zero, thus the wrap would work.
            name = "recipient_public_key" if procedure == "public_wrap" else "folder_public_key"
            ephemeral_name = "ephemeral_private_key" if procedure == "public_wrap" else f"{kind}_ephemeral_private_key"
            ref.x25519_checked_pure(b(i[ephemeral_name]), b(i[name]))
            # The same input with the canonical form of the key is accepted.
            canonical = (int.from_bytes(b(i[name]), "little") % (1 << 255) % P).to_bytes(32, "little")
            strict_wrap(procedure, dict(i, **{name: canonical.hex()}))
        return dict(ERROR_OUTPUT)

    check(i["direction_text"] == "unwrap", "direction_text")
    check(set(i) == UNWRAP_FIELDS[(procedure, kind)], f"{procedure} unwrap rejection: input fields")
    expect_reason(reason, f"{procedure} unwrap", strict_unwrap, procedure, i)
    if reason == "not_canonical":
        check(int.from_bytes(b(i["stanza"])[:32], "little") >= P, "ephemeral public key is not canonical")
        private_key, context, associated_data = lax_reader_arguments(procedure, i)
        check(lax_unwrap(private_key, context, associated_data, b(i["stanza"])) == expect["secret"], "a reader without rule 3a opens the stanza")
    elif reason == "tag":
        original = expect["original"]
        check(one_byte_differs(original, b(i["stanza"])), "exactly one byte is changed")
        check(strict_unwrap(procedure, dict(i, stanza=original.hex())) == expect["secret"], "the stanza without the change opens")
    elif reason == "key_mismatch":
        # Section 8.4.2. The stanza itself is correct: public_unwrap opens it.
        private_key, context, associated_data = lax_reader_arguments(procedure, i)
        opened = ref.public_unwrap(private_key, context, associated_data, b(i["stanza"]))
        check(opened == expect["secret"], "the stanza opens")
        check(ref.x25519_public_key(opened) != b(i["child_folder_public_key"]), "the private key gives a different public key")
    else:
        raise AssertionError(f"self-check failed: no check for the cause '{reason}'")
    return dict(ERROR_OUTPUT)


def run_tag(i: dict) -> dict:
    account_private_key, account_public_key = b(i["account_private_key"]), b(i["account_public_key"])
    tag_metadata = i["tag_metadata_text"].encode("utf-8")
    json.loads(tag_metadata)
    check(ref.ed25519_public_key(account_private_key) == account_public_key, "tag key pair")
    tag_key, sealed = ref.seal_tag_metadata(account_private_key, account_public_key, b(i["nonce"]), tag_metadata)
    check(ref.open_tag_metadata(account_private_key, account_public_key, sealed) == tag_metadata, "tag round trip")
    return {"tag_key": tag_key.hex(), "sealed_tag_metadata": sealed.hex()}


def run_encode_record(i: dict) -> dict:
    record = b(i["record"])
    stored_record = ref.encode_record(record)
    check(stored_record[0] == 1 and ref.decode_record(stored_record) == record, "encode_record round trip")
    return {"stored_record": stored_record.hex()}


# The order of SCHEMA.md.
PROCEDURES = {
    "blake3_derive_key": run_blake3_derive_key,
    "blake3_keyed_hash": run_blake3_keyed_hash,
    "seal": run_seal,
    "account_keys": run_account_keys,
    "passphrase_keys": run_passphrase_keys,
    "wrapped_root": run_wrapped_root,
    "sign_in_signature": run_sign_in_signature,
    "unlock_signature": run_unlock_signature,
    "signed_request": run_signed_request,
    "file_keys": run_file_keys,
    "header": run_header,
    "file_chunk": run_file_chunk,
    "file": run_file,
    "sealed_metadata": run_sealed_metadata,
    "sealed_ocr_text": run_sealed_ocr_text,
    "sealed_thumbnail": run_sealed_thumbnail,
    "public_wrap": run_public_wrap,
    "account_stanza": run_account_stanza,
    "password_stanza": run_password_stanza,
    "sealed_keyring": run_sealed_keyring,
    "folder": run_folder,
    "folder_stanzas": run_folder_stanzas,
    "tag": run_tag,
    "encode_record": run_encode_record,
}


# --------------------------------------------------------------------------
# The inputs.
# --------------------------------------------------------------------------


def build_inputs() -> list[tuple[str, str, dict, dict | None]]:
    cases: list[tuple[str, str, dict, dict | None]] = []

    def add(procedure: str, name: str, **inputs) -> None:
        cases.append((procedure, name, inputs, None))

    def add_rejects(procedure: str, name: str, expect: dict, **inputs) -> None:
        """`expect` goes to the self-check only, not to the file."""
        check(name.startswith(("rejects ", "decrypt_rejects ")), "name of a rejection vector")
        cases.append((procedure, name, inputs, expect))

    # Values that several procedures share.
    file_key_a, file_key_b = sequence(32), fixed("file key b")
    nonce_prefix_a, nonce_prefix_b = sequence(16, 0xA0), fixed("nonce prefix b", 16)
    header_hash_a = ref.header_hash_of(ref.build_header(nonce_prefix_a))
    header_hash_b = ref.header_hash_of(ref.build_header(nonce_prefix_b))
    root_entropy_a = sequence(32)
    account_a = ref.account_keys(root_entropy_a)
    account_b = ref.account_keys(fixed("root entropy b"))
    for account in (account_a, account_b):
        KNOWN_ED25519_SEEDS[account["account_public_key"]] = account["account_private_key"]
    owner_seed, owner_public_key = ed25519_pair("owner account seed")
    recipient_private_key, recipient_public_key = x25519_pair("x25519 recipient")
    recipient_public_key_2 = x25519_pair("x25519 recipient 2")[1]
    folder_private_key_a, folder_public_key_a = x25519_pair("folder private key a")
    folder_private_key_b, folder_public_key_b = x25519_pair("folder private key b")
    child_private_key_a, child_public_key_a = x25519_pair("child folder private key a")
    child_private_key_b, child_public_key_b = x25519_pair("child folder private key b")
    link_secret_a, link_secret_b = fixed("link secret a"), fixed("link secret b")

    # blake3_derive_key
    add("blake3_derive_key", "sequence key material", context_text="flare e2ee v1 account seed", key_material=sequence(32).hex())
    add("blake3_derive_key", "empty key material", context_text="flare e2ee v1 test vector", key_material="")
    add("blake3_derive_key", "96 bytes of key material", context_text="flare e2ee v1 account stanza", key_material=fixed("derive key material", 96).hex())
    add("blake3_derive_key", "1025 bytes of key material", context_text="flare e2ee v1 test vector", key_material=pattern(1025).hex())

    # blake3_keyed_hash
    add("blake3_keyed_hash", "short message", key=sequence(32).hex(), message=b"flare".hex())
    add("blake3_keyed_hash", "empty message", key=fixed("keyed hash key").hex(), message="")
    add("blake3_keyed_hash", "1025-byte message", key=fixed("keyed hash key").hex(), message=pattern(1025).hex())

    # seal
    seal_key, seal_nonce = sequence(32), sequence(24, 0x40)
    add("seal", "32-byte message", key=seal_key.hex(), nonce=seal_nonce.hex(), associated_data=sequence(32, 0x80).hex(), message=sequence(32, 0xC0).hex())
    add("seal", "empty message", key=seal_key.hex(), nonce=seal_nonce.hex(), associated_data=sequence(32, 0x80).hex(), message="")
    add("seal", "empty associated data", key=seal_key.hex(), nonce=seal_nonce.hex(), associated_data="", message=sequence(32, 0xC0).hex())
    add("seal", "empty message and empty associated data", key=seal_key.hex(), nonce=seal_nonce.hex(), associated_data="", message="")
    add("seal", "nonce of ff bytes", key=fixed("seal key").hex(), nonce=(b"\xff" * 24).hex(), associated_data=fixed("seal associated data", 7).hex(), message=fixed("seal message", 1).hex())
    add("seal", "message longer than one cipher block", key=fixed("seal key").hex(), nonce=fixed("seal nonce", 24).hex(), associated_data=fixed("seal associated data", 300).hex(), message=pattern(200).hex())
    add("seal", "message of exactly one cipher block", key=fixed("seal key").hex(), nonce=fixed("seal nonce 2", 24).hex(), associated_data=sequence(1).hex(), message=pattern(64).hex())

    add("seal", "nonce from the key as in seal_once (section 4.2.1); seal_once gives this box without its first 24 bytes", key=fixed("seal key").hex(), nonce=ref.one_time_nonce(fixed("seal key")).hex(), associated_data=header_hash_a.hex(), message=file_key_a.hex())

    # account_keys
    add("account_keys", "sequence root entropy", root_entropy=root_entropy_a.hex())
    add("account_keys", "zero root entropy", root_entropy=ref.zeros(32).hex())
    add("account_keys", "root entropy of ff bytes", root_entropy=(b"\xff" * 32).hex())
    add("account_keys", "root entropy from a label", root_entropy=fixed("root entropy b").hex())

    # passphrase_keys
    salt_a, salt_b = sequence(32, 0x10), fixed("passphrase salt b")
    fullwidth = "Ｆｌａｒｅ passphrase ①"  # fullwidth "Flare", circled digit one
    check(unicodedata.normalize("NFKC", fullwidth) == "Flare passphrase 1", "fullwidth text changes under NFKC")
    decomposed = "café crème brûlée"
    composed = "café crème brûlée"
    check(decomposed != composed and unicodedata.normalize("NFKC", decomposed) == composed, "decomposed text")
    add("passphrase_keys", "ASCII passphrase", passphrase_text="correct horse battery staple", passphrase_salt=salt_a.hex(), **FAST)
    add("passphrase_keys", "fullwidth letters and a circled digit, changed by NFKC", passphrase_text=fullwidth, passphrase_salt=salt_a.hex(), **FAST)
    add("passphrase_keys", "the NFKC form of the fullwidth passphrase, same output", passphrase_text="Flare passphrase 1", passphrase_salt=salt_a.hex(), **FAST)
    add("passphrase_keys", "decomposed accents, changed by NFKC", passphrase_text=decomposed, passphrase_salt=salt_b.hex(), **FAST)
    add("passphrase_keys", "composed accents, same output as the decomposed form", passphrase_text=composed, passphrase_salt=salt_b.hex(), **FAST)
    add("passphrase_keys", "spaces at the start and the end are not removed", passphrase_text="  correct horse battery staple ", passphrase_salt=salt_a.hex(), **FAST)
    add("passphrase_keys", "real parameters", passphrase_text="correct horse battery staple", passphrase_salt=salt_a.hex(), **REAL)

    # wrapped_root
    add("wrapped_root", "sequence root entropy", wrap_key=sequence(32, 0x20).hex(), nonce=sequence(24, 0x60).hex(), account_public_key=account_a["account_public_key"].hex(), root_entropy=root_entropy_a.hex())
    add("wrapped_root", "root entropy from a label", wrap_key=fixed("wrap key b").hex(), nonce=fixed("wrapped root nonce b", 24).hex(), account_public_key=account_b["account_public_key"].hex(), root_entropy=fixed("root entropy b").hex())

    # sign_in_signature
    auth_private_key, challenge_a, challenge_b = fixed("auth private key"), sequence(32, 0x30), fixed("challenge b")
    add("sign_in_signature", "lower case identifier", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="alice@example.com")
    add("sign_in_signature", "identifier with spaces and upper case, same output as the lower case form", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="  Alice@Example.COM ")
    # Rule 7. Each character here is in Unicode since version 1.1 and has one case mapping in each locale.
    add("sign_in_signature", "tab and no-break space at the ends, a fullwidth letter and mixed case, same output as the lower case form", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="\t\uff21lice@Example.COM\u00a0")
    add("sign_in_signature", "White_Space that is not a space: U+0085 and U+2028 at the ends, same output as the lower case form", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="\u0085\u2028alice@EXAMPLE.com\u3000\u0085")
    add("sign_in_signature", "U+FEFF at the start does not have White_Space and stays, different output", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="\ufeffalice@example.com")
    add("sign_in_signature", "spaces inside the identifier stay, a fullwidth space becomes U+0020", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text=" Alice\u3000Example ")
    add("sign_in_signature", "decomposed upper case letter, same output as the lower case form", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text="E\u0301milie")
    add("sign_in_signature", "user name with an upper case non-ASCII letter", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text=" Émilie ")
    add("sign_in_signature", "the lower case form of the non-ASCII user name, same output", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text="émilie")

    # unlock_signature (section 6.3). The first vector has the key, the challenge and the identifier of
    # the sign_in_signature vector "lower case identifier": only the context string is different.
    add("unlock_signature", "lower case identifier, same inputs as the sign_in_signature vector of that name, different signature", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="alice@example.com")
    add("unlock_signature", "identifier with spaces and upper case, same output as the lower case form", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="  Alice@Example.COM ")
    add("unlock_signature", "tab and no-break space at the ends, a fullwidth letter and mixed case, same output as the lower case form", auth_private_key=auth_private_key.hex(), challenge=challenge_a.hex(), identifier_text="\t\uff21lice@Example.COM\u00a0")
    add("unlock_signature", "decomposed upper case non-ASCII letter, second challenge", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text="E\u0301milie")
    add("unlock_signature", "second key, U+FEFF at the start stays", auth_private_key=fixed("auth private key 2").hex(), challenge=challenge_b.hex(), identifier_text="\ufeffalice@example.com")

    # signed_request
    request_key = account_a["account_private_key"]
    add("signed_request", "POST with a JSON body", account_private_key=request_key.hex(), challenge=challenge_a.hex(), method_text="POST", path_text="/api/e2ee/keyring", body=b'{"sealed_keyring":"AQ"}'.hex())
    add("signed_request", "DELETE with a query and an empty body", account_private_key=request_key.hex(), challenge=challenge_a.hex(), method_text="DELETE", path_text="/api/e2ee/folders/42?recursive=true", body="")
    add("signed_request", "PUT with a binary body and a percent-encoded path", account_private_key=account_b["account_private_key"].hex(), challenge=challenge_b.hex(), method_text="PUT", path_text="/api/e2ee/tags/caf%C3%A9?x=1&y=2", body=sequence(256).hex())
    add("signed_request", "GET with the path / and an empty body", account_private_key=account_b["account_private_key"].hex(), challenge=challenge_b.hex(), method_text="GET", path_text="/", body="")
    add("signed_request", "PATCH with percent-encoded characters in lower case hexadecimal, used as sent", account_private_key=account_b["account_private_key"].hex(), challenge=challenge_b.hex(), method_text="PATCH", path_text="/flare/api/e2ee/tags/caf%c3%a9%20%2F?q=a+b", body="")

    # file_keys
    add("file_keys", "sequence file key", file_key=file_key_a.hex())
    add("file_keys", "file key from a label", file_key=file_key_b.hex())
    add("file_keys", "zero file key", file_key=ref.zeros(32).hex())

    # header
    add("header", "sequence nonce prefix", nonce_prefix=nonce_prefix_a.hex())
    add("header", "nonce prefix from a label", nonce_prefix=nonce_prefix_b.hex())
    add("header", "zero nonce prefix", nonce_prefix=ref.zeros(16).hex())

    # file_chunk
    add("file_chunk", "short final chunk, index 0", file_key=file_key_a.hex(), nonce_prefix=nonce_prefix_a.hex(), chunk_index=0, is_final=True, chunk_plaintext=b"Flare test vector".hex())
    add("file_chunk", "zero-length final chunk, index 0 (empty file)", file_key=file_key_a.hex(), nonce_prefix=nonce_prefix_a.hex(), chunk_index=0, is_final=True, chunk_plaintext="")
    add("file_chunk", "one byte final chunk, index 1", file_key=file_key_a.hex(), nonce_prefix=nonce_prefix_a.hex(), chunk_index=1, is_final=True, chunk_plaintext="00")
    add("file_chunk", "final chunk with an index above 32 bits", file_key=file_key_b.hex(), nonce_prefix=nonce_prefix_b.hex(), chunk_index=0x0102030405, is_final=True, chunk_plaintext=pattern(100).hex())
    add("file_chunk", "full 65536-byte chunk that is not final, index 0", file_key=file_key_b.hex(), nonce_prefix=nonce_prefix_b.hex(), chunk_index=0, is_final=False, chunk_plaintext=pattern(65536).hex())
    add("file_chunk", "full 65536-byte final chunk, index 1", file_key=file_key_b.hex(), nonce_prefix=nonce_prefix_b.hex(), chunk_index=1, is_final=True, chunk_plaintext=pattern(131072)[65536:].hex())

    # file_chunk, decrypt_rejects (section 7.4 rules 6 and 8, and the tag)
    def chunk_input(file_key: bytes, nonce_prefix: bytes, chunk_index: int, is_final: bool, stored_chunk: bytes) -> dict:
        return {"file_key": file_key.hex(), "nonce_prefix": nonce_prefix.hex(), "chunk_index": chunk_index, "is_final": is_final, "stored_chunk": stored_chunk.hex()}

    add_rejects("file_chunk", "decrypt_rejects a zero-length final chunk at index 1, the tag is correct", {"reason": "empty_final_chunk", "plaintext": b""}, **chunk_input(file_key_a, nonce_prefix_a, 1, True, raw_stored_chunk(file_key_a, nonce_prefix_a, 1, True, b"")))
    add_rejects("file_chunk", "decrypt_rejects a zero-length final chunk with an index above 32 bits, the tag is correct", {"reason": "empty_final_chunk", "plaintext": b""}, **chunk_input(file_key_b, nonce_prefix_b, 0x0102030405, True, raw_stored_chunk(file_key_b, nonce_prefix_b, 0x0102030405, True, b"")))
    add_rejects("file_chunk", "decrypt_rejects a chunk that is not final and has less than 65536 bytes, the tag is correct", {"reason": "chunk_length", "plaintext": pattern(100)}, **chunk_input(file_key_a, nonce_prefix_a, 0, False, raw_stored_chunk(file_key_a, nonce_prefix_a, 0, False, pattern(100))))
    good_chunk = ref.encrypt_chunk(file_key_a, nonce_prefix_a, 0, True, b"Flare test vector")
    add_rejects("file_chunk", "decrypt_rejects a chunk with one changed byte in the ciphertext", {"reason": "tag", "opens_as": {"stored_chunk": good_chunk.hex()}}, **chunk_input(file_key_a, nonce_prefix_a, 0, True, flip(good_chunk, 0)))
    add_rejects("file_chunk", "decrypt_rejects a chunk with one changed byte in the tag", {"reason": "tag", "opens_as": {"stored_chunk": good_chunk.hex()}}, **chunk_input(file_key_a, nonce_prefix_a, 0, True, flip(good_chunk, -1)))
    add_rejects("file_chunk", "decrypt_rejects a chunk at a different index", {"reason": "tag", "opens_as": {"chunk_index": 0}}, **chunk_input(file_key_a, nonce_prefix_a, 1, True, good_chunk))
    add_rejects("file_chunk", "decrypt_rejects a zero-length chunk of index 0 with the tag of a different file key", {"reason": "tag", "opens_as": {"file_key": file_key_b.hex()}}, **chunk_input(file_key_a, nonce_prefix_a, 0, True, ref.encrypt_chunk(file_key_b, nonce_prefix_a, 0, True, b"")))

    # file
    for length in REQUIRED_FILE_LENGTHS:
        add("file", f"plaintext of {length} bytes", file_key=file_key_a.hex(), nonce_prefix=nonce_prefix_a.hex(), plaintext_length=length)
    add("file", "plaintext of 1000 bytes, second key", file_key=file_key_b.hex(), nonce_prefix=nonce_prefix_b.hex(), plaintext_length=1000)
    add("file", "plaintext of 196608 bytes (three full chunks), second key", file_key=file_key_b.hex(), nonce_prefix=nonce_prefix_b.hex(), plaintext_length=196608)

    # sealed_metadata
    add("sealed_metadata", "PNG image", file_key=file_key_a.hex(), nonce=sequence(24, 0x50).hex(), header_hash=header_hash_a.hex(), file_metadata_text='{"name":"holiday-photo.png","type":"image/png"}')
    add("sealed_metadata", "non-ASCII name and a MIME type with a parameter", file_key=file_key_b.hex(), nonce=fixed("metadata nonce b", 24).hex(), header_hash=header_hash_b.hex(), file_metadata_text='{"name":"résumé 日本語.txt","type":"text/plain; charset=utf-8"}')

    # sealed_ocr_text
    add("sealed_ocr_text", "two lines of text", file_key=file_key_a.hex(), nonce=sequence(24, 0x51).hex(), header_hash=header_hash_a.hex(), ocr_text="INVOICE 2026-0042\nTotal: 123.45 EUR")
    add("sealed_ocr_text", "empty text", file_key=file_key_a.hex(), nonce=sequence(24, 0x52).hex(), header_hash=header_hash_a.hex(), ocr_text="")
    add("sealed_ocr_text", "non-ASCII text", file_key=file_key_b.hex(), nonce=fixed("ocr nonce b", 24).hex(), header_hash=header_hash_b.hex(), ocr_text="Grüße aus Köln — 東京")

    # sealed_thumbnail
    add("sealed_thumbnail", "small thumbnail", file_key=file_key_a.hex(), nonce=sequence(24, 0x53).hex(), header_hash=header_hash_a.hex(), thumbnail=(b"RIFF\x18\x00\x00\x00WEBPVP8 " + sequence(16)).hex())
    add("sealed_thumbnail", "thumbnail of 1000 bytes", file_key=file_key_b.hex(), nonce=fixed("thumbnail nonce b", 24).hex(), header_hash=header_hash_b.hex(), thumbnail=fixed("thumbnail b", 1000).hex())

    # public_wrap
    add("public_wrap", "32-byte secret", recipient_public_key=recipient_public_key.hex(), ephemeral_private_key=sequence(32, 0x70).hex(), context_text="flare e2ee v1 folder file stanza", associated_data=header_hash_a.hex(), secret=file_key_a.hex())
    add("public_wrap", "empty associated data", recipient_public_key=recipient_public_key.hex(), ephemeral_private_key=fixed("ephemeral private key 2").hex(), context_text="flare e2ee v1 test vector", associated_data="", secret=file_key_b.hex())
    add("public_wrap", "empty secret", recipient_public_key=recipient_public_key_2.hex(), ephemeral_private_key=fixed("ephemeral private key 3").hex(), context_text="flare e2ee v1 test vector", associated_data=sequence(5).hex(), secret="")
    add("public_wrap", "ephemeral private key with all bits set", recipient_public_key=recipient_public_key_2.hex(), ephemeral_private_key=(b"\xff" * 32).hex(), context_text="flare e2ee v1 parent folder stanza", associated_data=fixed("public wrap associated data", 48).hex(), secret=fixed("public wrap secret", 80).hex())

    top_bit_ephemeral = set_highest_bit(ref.x25519_public_key(fixed("ephemeral private key for a rejection")))
    check(int.from_bytes(top_bit_ephemeral, "little") >= P and int.from_bytes(BASE_POINT_PLUS_P, "little") >= P, "forms that are not canonical")
    check(BASE_POINT_PLUS_P[31] & 0x80 == 0, "the second form has no highest bit")
    HIGH_BIT = "with the highest bit set"
    NOT_LESS = "that is not less than 2^255 - 19"

    def unwrap_rejects(procedure: str, suffix: str, private_key: bytes, context: str, associated_data: bytes, secret: bytes, good_stanza: bytes, changed_at: list[tuple[str, int]], /, **reader_inputs) -> None:
        """The unwrap rejections of one public-key stanza. `private_key` is the X25519 key of the reader."""
        for form, ephemeral_public_key in ((HIGH_BIT, top_bit_ephemeral), (NOT_LESS, BASE_POINT_PLUS_P)):
            stanza = lax_stanza(private_key, ephemeral_public_key, context, associated_data, secret)
            add_rejects(procedure, f"rejects an ephemeral public key {form}{suffix}", {"reason": "not_canonical", "secret": secret}, direction_text="unwrap", **reader_inputs, stanza=stanza.hex())
        for where, index in changed_at:
            add_rejects(procedure, f"rejects a stanza with one changed byte in the {where}{suffix}", {"reason": "tag", "secret": secret, "original": good_stanza}, direction_text="unwrap", **reader_inputs, stanza=flip(good_stanza, index).hex())

    wrap_inputs = dict(ephemeral_private_key=sequence(32, 0x70).hex(), context_text="flare e2ee v1 folder file stanza", associated_data=header_hash_a.hex(), secret=file_key_a.hex())
    add_rejects("public_wrap", f"rejects a recipient public key {HIGH_BIT}", {"reason": "not_canonical"}, direction_text="wrap", recipient_public_key=set_highest_bit(recipient_public_key).hex(), **wrap_inputs)
    add_rejects("public_wrap", f"rejects a recipient public key {NOT_LESS}", {"reason": "not_canonical"}, direction_text="wrap", recipient_public_key=BASE_POINT_PLUS_P.hex(), **wrap_inputs)
    good_stanza = ref.public_wrap(recipient_public_key, sequence(32, 0x70), "flare e2ee v1 folder file stanza", header_hash_a, file_key_a)
    unwrap_rejects("public_wrap", "", recipient_private_key, "flare e2ee v1 folder file stanza", header_hash_a, file_key_a, good_stanza, [("ciphertext", 32), ("tag", 95)], recipient_private_key=recipient_private_key.hex(), context_text="flare e2ee v1 folder file stanza", associated_data=header_hash_a.hex())

    # account_stanza
    add("account_stanza", "account of the sequence root entropy", account_public_key=account_a["account_public_key"].hex(), ephemeral_private_key=sequence(32, 0x70).hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex())
    add("account_stanza", "second account", account_public_key=account_b["account_public_key"].hex(), ephemeral_private_key=fixed("ephemeral private key 4").hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex())

    # An Edwards y that is not canonical: p + k, where y = k is a point of the curve (not y = 1).
    small_y = next(k for k in range(2, 19) if decodes(k.to_bytes(32, "little")))
    add_rejects("account_stanza", "rejects an account public key with y that is not less than 2^255 - 19", {"reason": "not_canonical"}, direction_text="wrap", account_public_key=(P + small_y).to_bytes(32, "little").hex(), ephemeral_private_key=sequence(32, 0x70).hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex())
    good_stanza = ref.account_stanza(account_a["account_public_key"], sequence(32, 0x70), header_hash_a, file_key_a)
    unwrap_rejects("account_stanza", "", account_a["exchange_private_key"], "flare e2ee v1 account stanza", header_hash_a, file_key_a, good_stanza, [("ciphertext", 32), ("tag", 95)], account_private_key=account_a["account_private_key"].hex(), header_hash=header_hash_a.hex())

    # password_stanza
    password_fullwidth = "Ｐａｓｓword ⁵"  # fullwidth "Pass", superscript five
    check(unicodedata.normalize("NFKC", password_fullwidth) == "Password 5", "fullwidth password changes under NFKC")
    add("password_stanza", "ASCII password", password_text="open sesame 42", password_salt=sequence(32, 0x90).hex(), link_secret=link_secret_a.hex(), owner_public_key=owner_public_key.hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex(), link_secret_nonce=sequence(24, 0xB0).hex(), **FAST)
    add("password_stanza", "password that changes under NFKC", password_text=password_fullwidth, password_salt=fixed("password salt b").hex(), link_secret=link_secret_b.hex(), owner_public_key=account_b["account_public_key"].hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex(), link_secret_nonce=fixed("link secret nonce b", 24).hex(), **FAST)
    add("password_stanza", "the NFKC form of that password, same output", password_text="Password 5", password_salt=fixed("password salt b").hex(), link_secret=link_secret_b.hex(), owner_public_key=account_b["account_public_key"].hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex(), link_secret_nonce=fixed("link secret nonce b", 24).hex(), **FAST)
    add("password_stanza", "real parameters", password_text="open sesame 42", password_salt=sequence(32, 0x90).hex(), link_secret=link_secret_a.hex(), owner_public_key=owner_public_key.hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex(), link_secret_nonce=sequence(24, 0xB0).hex(), **REAL)

    # A change in sealed_link_secret (the last 88 bytes) does not stop the visitor, thus no vector changes a byte there.
    good_stanza = ref.password_stanza("open sesame 42", sequence(32, 0x90), link_secret_a, owner_public_key, header_hash_a, file_key_a, sequence(24, 0xB0), **FAST)[1]
    for where, index in (("password_salt", 0), ("owner_public_key", 32), ("ciphertext of wrapped_file_key", 64), ("tag of wrapped_file_key", 127)):
        add_rejects("password_stanza", f"rejects a stanza with one changed byte in the {where}", {"reason": "tag", "secret": file_key_a, "original": good_stanza}, direction_text="unwrap", password_text="open sesame 42", link_secret=link_secret_a.hex(), header_hash=header_hash_a.hex(), stanza=flip(good_stanza, index).hex(), **FAST)

    # sealed_keyring
    old_keys = [fixed(f"old account private key {n}") for n in (3, 2, 1)]
    add("sealed_keyring", "one old private key", account_private_key=account_a["account_private_key"].hex(), account_public_key=account_a["account_public_key"].hex(), nonce=sequence(24, 0xD0).hex(), old_private_keys=[old_keys[2].hex()])
    add("sealed_keyring", "three old private keys, newest first", account_private_key=account_b["account_private_key"].hex(), account_public_key=account_b["account_public_key"].hex(), nonce=fixed("keyring nonce b", 24).hex(), old_private_keys=[key.hex() for key in old_keys])
    add("sealed_keyring", "two old private keys, newest first", account_private_key=account_a["account_private_key"].hex(), account_public_key=account_a["account_public_key"].hex(), nonce=sequence(24, 0xD1).hex(), old_private_keys=[old_keys[1].hex(), old_keys[2].hex()])
    # Rule 11: a correctly sealed empty list. seal_keyring refuses to make it, thus `seal` makes it here.
    empty_keyring = ref.seal(ref.keyring_key_of(account_a["account_private_key"]), sequence(24, 0xD2), account_a["account_public_key"], b"")
    add_rejects("sealed_keyring", "rejects a sealed empty list, the tag is correct", {"reason": "empty_keyring"}, direction_text="open", account_private_key=account_a["account_private_key"].hex(), account_public_key=account_a["account_public_key"].hex(), sealed_keyring=empty_keyring.hex())

    # folder
    add("folder", "folder a", folder_private_key=folder_private_key_a.hex(), account_private_key=account_a["account_private_key"].hex(), metadata_nonce=sequence(24, 0xE0).hex(), private_key_nonce=sequence(24, 0xE8).hex(), folder_metadata_text='{"name":"Screenshots"}')
    add("folder", "folder b, non-ASCII name", folder_private_key=folder_private_key_b.hex(), account_private_key=account_b["account_private_key"].hex(), metadata_nonce=fixed("folder metadata nonce b", 24).hex(), private_key_nonce=fixed("folder private key nonce b", 24).hex(), folder_metadata_text='{"name":"Förderanträge 2026"}')
    add("folder", "folder private key that is not a clamped scalar", folder_private_key=(b"\xff" * 32).hex(), account_private_key=account_a["account_private_key"].hex(), metadata_nonce=sequence(24, 0xE1).hex(), private_key_nonce=sequence(24, 0xE9).hex(), folder_metadata_text='{"name":"x"}')

    # folder_stanzas
    stanzas_a = dict(folder_public_key=folder_public_key_a.hex(), file_ephemeral_private_key=sequence(32, 0x70).hex(), link_secret_ephemeral_private_key=sequence(32, 0x71).hex(), parent_ephemeral_private_key=sequence(32, 0x72).hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex(), link_secret=link_secret_a.hex(), child_folder_private_key=child_private_key_a.hex(), child_folder_public_key=child_public_key_a.hex())
    add("folder_stanzas", "folder a", **stanzas_a)
    add("folder_stanzas", "folder b", folder_public_key=folder_public_key_b.hex(), file_ephemeral_private_key=fixed("ephemeral private key 5").hex(), link_secret_ephemeral_private_key=fixed("ephemeral private key 6").hex(), parent_ephemeral_private_key=fixed("ephemeral private key 7").hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex(), link_secret=link_secret_b.hex(), child_folder_private_key=child_private_key_b.hex(), child_folder_public_key=child_public_key_b.hex())
    kinds = {
        "file": (header_hash_a, file_key_a, ref.folder_file_stanza(folder_public_key_a, sequence(32, 0x70), header_hash_a, file_key_a), {"header_hash": header_hash_a.hex()}),
        "link_secret": (header_hash_a, link_secret_a, ref.folder_link_secret_stanza(folder_public_key_a, sequence(32, 0x71), header_hash_a, link_secret_a), {"header_hash": header_hash_a.hex()}),
        "parent": (child_public_key_a, child_private_key_a, ref.parent_folder_stanza(folder_public_key_a, sequence(32, 0x72), child_public_key_a, child_private_key_a), {"child_folder_public_key": child_public_key_a.hex()}),
    }
    for kind, (associated_data, secret, good_stanza, reader_inputs) in kinds.items():
        suffix = f" ({kind} stanza)"
        add_rejects("folder_stanzas", f"rejects a folder public key {HIGH_BIT}{suffix}", {"reason": "not_canonical"}, direction_text="wrap", stanza_kind_text=kind, **dict(stanzas_a, folder_public_key=set_highest_bit(folder_public_key_a).hex()))
        add_rejects("folder_stanzas", f"rejects a folder public key {NOT_LESS}{suffix}", {"reason": "not_canonical"}, direction_text="wrap", stanza_kind_text=kind, **dict(stanzas_a, folder_public_key=BASE_POINT_PLUS_P.hex()))
        unwrap_rejects("folder_stanzas", suffix, folder_private_key_a, FOLDER_CONTEXTS[kind], associated_data, secret, good_stanza, [("tag", 95)], stanza_kind_text=kind, folder_private_key=folder_private_key_a.hex(), **reader_inputs)
    # Section 8.4.2: a correct stanza that holds the private key of a different folder.
    wrong_child = ref.parent_folder_stanza(folder_public_key_a, sequence(32, 0x73), child_public_key_a, child_private_key_b)
    add_rejects("folder_stanzas", "rejects a parent folder stanza with a private key that does not give the folder public key (parent stanza)", {"reason": "key_mismatch", "secret": child_private_key_b}, direction_text="unwrap", stanza_kind_text="parent", folder_private_key=folder_private_key_a.hex(), child_folder_public_key=child_public_key_a.hex(), stanza=wrong_child.hex())

    # tag
    add("tag", "tag with a file name rule", account_private_key=account_a["account_private_key"].hex(), account_public_key=account_a["account_public_key"].hex(), nonce=sequence(24, 0xF0).hex(), tag_metadata_text='{"name":"Invoices","rule_source":"filename","rule_text":"invoice"}')
    add("tag", "tag without a rule, non-ASCII name", account_private_key=account_b["account_private_key"].hex(), account_public_key=account_b["account_public_key"].hex(), nonce=fixed("tag nonce b", 24).hex(), tag_metadata_text='{"name":"À trier","rule_source":null,"rule_text":null}')

    # encode_record
    example_stanza = ref.account_stanza(account_a["account_public_key"], sequence(32, 0x70), header_hash_a, file_key_a)
    example_sealed = ref.seal_metadata(file_key_a, sequence(24, 0x50), header_hash_a, b'{"name":"holiday-photo.png","type":"image/png"}')
    add("encode_record", "account stanza", record=example_stanza.hex())
    add("encode_record", "sealed_metadata", record=example_sealed.hex())
    add("encode_record", "record that starts with the byte 01", record="0102")

    return cases


def decodes(account_public_key: bytes) -> bool:
    """True if the Edwards point decodes and gives an X25519 key that X25519 accepts."""
    try:
        ref.x25519_checked_pure(sequence(32, 0x70), ref.ed2curve_public(account_public_key))
        return True
    except ref.Reject:
        return False


def is_rejection(name: str) -> bool:
    return name.startswith(("rejects ", "decrypt_rejects "))


def build_vectors() -> list[dict]:
    vectors = []
    for procedure, name, inputs, expect in build_inputs():
        if expect is None:
            check(not is_rejection(name), "a vector with a result has a name without `rejects`")
            output = PROCEDURES[procedure](inputs)
        elif name.startswith("decrypt_rejects "):
            check(procedure == "file_chunk", "decrypt_rejects is for file_chunk")
            output = run_file_chunk_decrypt_rejects(inputs, expect)
        elif procedure == "sealed_keyring":
            output = run_sealed_keyring_rejects(inputs, expect)
        else:
            output = run_rejects(procedure, inputs, expect)
        vectors.append({"procedure": procedure, "name": name, "input": inputs, "output": output})
    check_vector_set(vectors)
    return vectors


def check_vector_set(vectors: list[dict]) -> None:
    """Checks of the full set against SCHEMA.md."""
    by_procedure: dict[str, list[dict]] = {}
    for vector in vectors:
        by_procedure.setdefault(vector["procedure"], []).append(vector)
    rejections = [v for v in vectors if is_rejection(v["name"])]
    for vector in vectors:
        check(("error" in vector["output"]) == is_rejection(vector["name"]), "only a rejection vector has an error output")
    for vector in rejections:
        check(vector["output"] == {"error": True}, "the output of a rejection vector is exactly error: true")
    for procedure in PROCEDURES:
        with_result = [v for v in by_procedure.get(procedure, []) if not is_rejection(v["name"])]
        check(len(with_result) >= 2, f"{procedure} has at least two vectors")
        has_rejection = any(is_rejection(v["name"]) for v in by_procedure[procedure])
        expected = procedure in ("public_wrap", "account_stanza", "password_stanza", "sealed_keyring", "folder_stanzas", "file_chunk")
        check(has_rejection == expected, f"{procedure}: rejection vectors")
    for procedure in ("public_wrap", "account_stanza", "folder_stanzas"):
        names = [v["name"] for v in by_procedure[procedure]]
        check(any("public key" in n and n.startswith("rejects ") for n in names), f"{procedure} rejects a key that is not canonical")
        check(any("one changed byte" in n for n in names), f"{procedure} rejects a changed byte")
    check(any("one changed byte" in v["name"] for v in by_procedure["password_stanza"]), "password_stanza rejects a changed byte")
    check(
        any(v["name"].startswith("decrypt_rejects a zero-length final chunk") and v["input"]["chunk_index"] > 0 for v in by_procedure["file_chunk"]),
        "file_chunk has a decrypt_rejects vector for a zero-length final chunk above index 0",
    )
    keyring_rejections = [v for v in by_procedure["sealed_keyring"] if is_rejection(v["name"])]
    check(
        all(v["input"]["old_private_keys"] for v in by_procedure["sealed_keyring"] if not is_rejection(v["name"])),
        "no sealed_keyring vector with a result has an empty list",
    )
    check(
        len(keyring_rejections) == 1 and keyring_rejections[0]["input"]["direction_text"] == "open",
        "sealed_keyring has one rejection vector, for the reader of a sealed empty list",
    )
    check(len(by_procedure["unlock_signature"]) >= 3, "unlock_signature has at least three vectors")
    check(all("ephemeral_private_key" not in v["input"] for v in by_procedure["folder_stanzas"]), "folder_stanzas has no shared ephemeral key")
    # Section 4.3: the real parameters are 65536, 3, 4. Each other vector uses the fast test values.
    for procedure in ("passphrase_keys", "password_stanza"):
        parameters = [(v["input"]["memory_kib"], v["input"]["passes"], v["input"]["lanes"]) for v in by_procedure[procedure]]
        check(parameters.count((65536, 3, 4)) == 1, f"{procedure} has one vector with the real parameters")
        check(set(parameters) == {(65536, 3, 4), (8, 1, 1)}, f"{procedure} uses the real and the fast parameters only")
    check((ref.ARGON2_MEMORY_KIB, ref.ARGON2_PASSES, ref.ARGON2_LANES) == (65536, 3, 4), "fixed Argon2id parameters")
    lengths = {v["input"]["plaintext_length"] for v in by_procedure["file"]}
    check(lengths >= set(REQUIRED_FILE_LENGTHS), "file has each required plaintext length")
    names = [(v["procedure"], v["name"]) for v in vectors]
    check(len(names) == len(set(names)), "vector names are unique in each procedure")

    def output_of(procedure: str, name: str) -> dict:
        return next(v["output"] for v in by_procedure[procedure] if v["name"] == name)

    # Pairs that must agree, and pairs that must not.
    check(
        output_of("passphrase_keys", "fullwidth letters and a circled digit, changed by NFKC")
        == output_of("passphrase_keys", "the NFKC form of the fullwidth passphrase, same output"),
        "NFKC fullwidth pair",
    )
    check(
        output_of("passphrase_keys", "decomposed accents, changed by NFKC")
        == output_of("passphrase_keys", "composed accents, same output as the decomposed form"),
        "NFKC accent pair",
    )
    check(
        output_of("passphrase_keys", "ASCII passphrase")
        != output_of("passphrase_keys", "spaces at the start and the end are not removed"),
        "spaces of a passphrase stay",
    )
    check(
        output_of("password_stanza", "password that changes under NFKC")
        == output_of("password_stanza", "the NFKC form of that password, same output"),
        "NFKC password pair",
    )
    check(
        output_of("sign_in_signature", "lower case identifier")
        == output_of("sign_in_signature", "identifier with spaces and upper case, same output as the lower case form"),
        "identifier pair",
    )
    check(
        output_of("sign_in_signature", "user name with an upper case non-ASCII letter")
        == output_of("sign_in_signature", "the lower case form of the non-ASCII user name, same output"),
        "non-ASCII identifier pair",
    )
    alice = output_of("sign_in_signature", "lower case identifier")
    check(alice["identifier_normalized_text"] == "alice@example.com", "normalized identifier")
    for name in (
        "tab and no-break space at the ends, a fullwidth letter and mixed case, same output as the lower case form",
        "White_Space that is not a space: U+0085 and U+2028 at the ends, same output as the lower case form",
    ):
        check(output_of("sign_in_signature", name) == alice, f"identifier: {name}")
    kept = output_of("sign_in_signature", "U+FEFF at the start does not have White_Space and stays, different output")
    check(kept["identifier_normalized_text"] == "\ufeffalice@example.com" and kept["signature"] != alice["signature"], "U+FEFF stays")
    check(
        output_of("sign_in_signature", "spaces inside the identifier stay, a fullwidth space becomes U+0020")["identifier_normalized_text"]
        == "alice example",
        "inner space",
    )
    check(
        output_of("sign_in_signature", "decomposed upper case letter, same output as the lower case form")
        == output_of("sign_in_signature", "the lower case form of the non-ASCII user name, same output"),
        "decomposed identifier",
    )
    for vector in by_procedure["sign_in_signature"]:
        check(set(vector["output"]) == {"signature", "identifier_normalized_text"}, "sign_in_signature outputs")
        # The vectors use no character that Unicode added after version 13.
        # Only characters of Unicode 1.1: Latin, U+0301, U+2028, U+3000, U+FEFF and the fullwidth forms.
        check(
            all(ord(c) < 0x250 or ord(c) in (0x301, 0x2028, 0x3000, 0xFEFF) or 0xFF01 <= ord(c) <= 0xFF5E for c in vector["input"]["identifier_text"]),
            "identifier characters are old and stable",
        )
    # Section 6.3: the unlock signature. Same key, challenge and identifier as a sign-in vector, different signature.
    def vector_of(procedure: str, name: str) -> dict:
        return next(v for v in by_procedure[procedure] if v["name"] == name)

    sign_in_alice = vector_of("sign_in_signature", "lower case identifier")
    unlock_alice = vector_of("unlock_signature", "lower case identifier, same inputs as the sign_in_signature vector of that name, different signature")
    check(unlock_alice["input"] == sign_in_alice["input"], "one unlock vector has the inputs of a sign-in vector")
    check(
        unlock_alice["output"]["identifier_normalized_text"] == sign_in_alice["output"]["identifier_normalized_text"],
        "the two vectors have the same normalized identifier",
    )
    check(unlock_alice["output"]["signature"] != sign_in_alice["output"]["signature"], "the two signatures are different")
    sign_in_signatures = {v["output"]["signature"] for v in by_procedure["sign_in_signature"]}
    check(
        all(v["output"]["signature"] not in sign_in_signatures for v in by_procedure["unlock_signature"]),
        "no unlock signature is a sign-in signature",
    )
    for name in (
        "identifier with spaces and upper case, same output as the lower case form",
        "tab and no-break space at the ends, a fullwidth letter and mixed case, same output as the lower case form",
    ):
        check(output_of("unlock_signature", name) == unlock_alice["output"], f"unlock identifier: {name}")
    check(
        output_of("unlock_signature", "decomposed upper case non-ASCII letter, second challenge")["identifier_normalized_text"] == "\u00e9milie",
        "unlock, decomposed identifier",
    )
    check(
        output_of("unlock_signature", "second key, U+FEFF at the start stays")["identifier_normalized_text"] == "\ufeffalice@example.com",
        "unlock, U+FEFF stays",
    )
    for vector in by_procedure["unlock_signature"]:
        check(set(vector["input"]) == {"auth_private_key", "challenge", "identifier_text"}, "unlock_signature inputs")
        check(set(vector["output"]) == {"identifier_normalized_text", "signature"}, "unlock_signature outputs")
        check(
            all(ord(c) < 0x250 or ord(c) in (0x301, 0x2028, 0x3000, 0xFEFF) or 0xFF01 <= ord(c) <= 0xFF5E for c in vector["input"]["identifier_text"]),
            "identifier characters are old and stable",
        )
    # The `file` vectors agree with the `header` and `file_chunk` procedures.
    empty_file = output_of("file", "plaintext of 0 bytes")
    header = output_of("header", "sequence nonce prefix")["header"]
    empty_chunk = output_of("file_chunk", "zero-length final chunk, index 0 (empty file)")["stored_chunk"]
    check(empty_file["stored_length"] == 58, "empty file has 58 stored bytes")
    check(ref.blake3_hash(bytes.fromhex(header + empty_chunk)).hex() == empty_file["stored_blake3"], "empty file")
    check(output_of("file", "plaintext of 65536 bytes")["stored_length"] == 26 + 65568, "65536 bytes give one chunk")
    check(output_of("file", "plaintext of 131072 bytes")["stored_length"] == 26 + 2 * 65568, "131072 bytes give two chunks")
    # No output has the record_version byte, except in encode_record: check the fixed lengths.
    for vector in by_procedure["account_stanza"]:
        if not is_rejection(vector["name"]):
            check(len(vector["output"]["stanza"]) == 192, "account stanza hex length")
    for vector in by_procedure["wrapped_root"]:
        check(len(vector["output"]["wrapped_root"]) == 176, "wrapped_root hex length")


def render(vectors: list[dict]) -> str:
    document = {"protocol_version": ref.PROTOCOL_VERSION, "vectors": vectors}
    return json.dumps(document, indent=2, ensure_ascii=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--check", action="store_true", help="compare with the file, write nothing")
    arguments = parser.parse_args()

    for name, count in known_answers.run_all().items():
        print(f"known answers ok  {count:3d}  {name}")

    vectors = build_vectors()
    counts: dict[str, int] = {}
    for vector in vectors:
        counts[vector["procedure"]] = counts.get(vector["procedure"], 0) + 1
    rejections = {p: sum(1 for v in vectors if v["procedure"] == p and is_rejection(v["name"])) for p in counts}
    for procedure, count in counts.items():
        note = f"  ({rejections[procedure]} with error: true)" if rejections[procedure] else ""
        print(f"vectors {count:2d}  {procedure}{note}")
    print(f"vectors {len(vectors)} in total, {sum(rejections.values())} with error: true, each self-check passed")

    text = render(vectors)
    if arguments.check:
        if not arguments.output.exists() or arguments.output.read_text(encoding="utf-8") != text:
            print(f"DIFFERENT: {arguments.output}", file=sys.stderr)
            return 1
        print(f"identical: {arguments.output}")
        return 0
    arguments.output.write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {arguments.output} ({len(text)} bytes, blake3 {ref.blake3_hash(text.encode('utf-8')).hex()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
