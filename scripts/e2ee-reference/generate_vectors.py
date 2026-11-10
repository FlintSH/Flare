"""Makes lib/e2ee/vectors/v1.json from reference.py.

Usage:
    python generate_vectors.py            write the vector file
    python generate_vectors.py --check    make the vectors and compare them with the file
    python generate_vectors.py --output PATH

Each input is fixed, thus two runs give the same bytes. Before a vector is
written, its output is opened again by the reverse procedure of reference.py
(which uses separate pure Python primitives) and compared with the input.
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


def flip(data: bytes, index: int = 0) -> bytes:
    changed = bytearray(data)
    changed[index] ^= 0x01
    return bytes(changed)


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
    return {"sealed_box": sealed_box.hex()}


def run_account_keys(i: dict) -> dict:
    root_entropy = b(i["root_entropy"])
    keys = ref.account_keys(root_entropy)
    check(ref.entropy_from_mnemonic(keys["mnemonic_text"]) == root_entropy, "mnemonic round trip")
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
    return {"signature": signature.hex()}


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
    return {"stored_chunk": stored_chunk.hex()}


def run_file(i: dict) -> dict:
    file_key, nonce_prefix, plaintext_length = b(i["file_key"]), b(i["nonce_prefix"]), i["plaintext_length"]
    plaintext = pattern(plaintext_length)
    stored_file = ref.encrypt_file(file_key, nonce_prefix, plaintext)
    chunk_count = max(1, -(-plaintext_length // 65536))
    check(len(stored_file) == 26 + plaintext_length + 32 * chunk_count, "stored file length")
    check(ref.decrypt_file(file_key, stored_file) == plaintext, "file round trip")
    expect_reject("file, last byte removed", ref.decrypt_file, file_key, stored_file[:-1])
    expect_reject("file, one byte added", ref.decrypt_file, file_key, stored_file + b"\x00")
    expect_reject("file, changed header", ref.decrypt_file, file_key, flip(stored_file, 10))
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
    check(len(stanza) == 32 + 24 + len(secret) + 32, "stanza length")
    private_key = KNOWN_X25519_PRIVATE_KEYS[recipient_public_key]
    check(ref.public_unwrap(private_key, i["context_text"], associated_data, stanza) == secret, "public_wrap round trip")
    expect_reject(
        "public_wrap, other context", ref.public_unwrap, private_key, i["context_text"] + "x", associated_data, stanza
    )
    return {"stanza": stanza.hex()}


def run_account_stanza(i: dict) -> dict:
    account_public_key, header_hash, file_key = b(i["account_public_key"]), b(i["header_hash"]), b(i["file_key"])
    stanza = ref.account_stanza(account_public_key, b(i["ephemeral_private_key"]), header_hash, file_key)
    check(len(stanza) == 120, "account stanza has 120 bytes")
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
    expect_reject("account stanza, other file", ref.open_account_stanza, seed, flip(header_hash), stanza)
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
    check(len(stanza) == 240, "password stanza has 240 bytes")
    check(ref.open_link_secret_copy(file_key, header_hash, stanza) == link_secret, "sealed_link_secret round trip")
    if parameters == (FAST["memory_kib"], FAST["passes"], FAST["lanes"]):
        # The visitor path runs Argon2id again. Only the fast vectors do it, to keep the CPU use low.
        opened = ref.open_password_stanza(i["password_text"], link_secret, header_hash, stanza, *parameters)
        check(opened == file_key, "password stanza round trip")
        expect_reject(
            "password stanza, wrong password",
            ref.open_password_stanza,
            i["password_text"] + "x",
            link_secret,
            header_hash,
            stanza,
            *parameters,
        )
        expect_reject(
            "password stanza, wrong link secret",
            ref.open_password_stanza,
            i["password_text"],
            flip(link_secret),
            header_hash,
            stanza,
            *parameters,
        )
    else:
        check(ref.open_sealed(password_key, header_hash, stanza[64:152]) == file_key, "password stanza round trip")
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
    return {"keyring_key": keyring_key.hex(), "sealed_keyring": sealed_keyring.hex()}


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
    return {name: value.hex() for name, value in out.items()}


def run_folder_stanzas(i: dict) -> dict:
    folder_public_key, ephemeral_private_key = b(i["folder_public_key"]), b(i["ephemeral_private_key"])
    header_hash, file_key, link_secret = b(i["header_hash"]), b(i["file_key"]), b(i["link_secret"])
    child_private_key, child_public_key = b(i["child_folder_private_key"]), b(i["child_folder_public_key"])
    check(ref.x25519_public_key(child_private_key) == child_public_key, "child folder key pair")
    file_stanza = ref.folder_file_stanza(folder_public_key, ephemeral_private_key, header_hash, file_key)
    link_stanza = ref.folder_link_secret_stanza(folder_public_key, ephemeral_private_key, header_hash, link_secret)
    parent_stanza = ref.parent_folder_stanza(folder_public_key, ephemeral_private_key, child_public_key, child_private_key)
    private_key = KNOWN_X25519_PRIVATE_KEYS[folder_public_key]
    check(
        ref.public_unwrap(private_key, "flare e2ee v1 folder file stanza", header_hash, file_stanza) == file_key,
        "folder_file_stanza round trip",
    )
    check(
        ref.public_unwrap(private_key, "flare e2ee v1 folder link secret stanza", header_hash, link_stanza)
        == link_secret,
        "folder_link_secret_stanza round trip",
    )
    check(
        ref.public_unwrap(private_key, "flare e2ee v1 parent folder stanza", child_public_key, parent_stanza)
        == child_private_key,
        "parent_folder_stanza round trip",
    )
    expect_reject(
        "a folder file stanza does not open as a link secret stanza",
        ref.public_unwrap,
        private_key,
        "flare e2ee v1 folder link secret stanza",
        header_hash,
        file_stanza,
    )
    return {
        "folder_file_stanza": file_stanza.hex(),
        "folder_link_secret_stanza": link_stanza.hex(),
        "parent_folder_stanza": parent_stanza.hex(),
    }


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


def build_inputs() -> list[tuple[str, str, dict]]:
    cases: list[tuple[str, str, dict]] = []

    def add(procedure: str, name: str, **inputs) -> None:
        cases.append((procedure, name, inputs))

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
    add("seal", "zero nonce", key=fixed("seal key").hex(), nonce=ref.zeros(24).hex(), associated_data=fixed("seal associated data", 7).hex(), message=fixed("seal message", 1).hex())
    add("seal", "message longer than one cipher block", key=fixed("seal key").hex(), nonce=fixed("seal nonce", 24).hex(), associated_data=fixed("seal associated data", 300).hex(), message=pattern(200).hex())
    add("seal", "message of exactly one cipher block", key=fixed("seal key").hex(), nonce=fixed("seal nonce 2", 24).hex(), associated_data=sequence(1).hex(), message=pattern(64).hex())

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
    add("sign_in_signature", "user name with an upper case non-ASCII letter", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text=" Émilie ")
    add("sign_in_signature", "the lower case form of the non-ASCII user name, same output", auth_private_key=auth_private_key.hex(), challenge=challenge_b.hex(), identifier_text="émilie")

    # signed_request
    request_key = account_a["account_private_key"]
    add("signed_request", "POST with a JSON body", account_private_key=request_key.hex(), challenge=challenge_a.hex(), method_text="POST", path_text="/api/e2ee/keyring", body=b'{"sealed_keyring":"AQ"}'.hex())
    add("signed_request", "DELETE with a query and an empty body", account_private_key=request_key.hex(), challenge=challenge_a.hex(), method_text="DELETE", path_text="/api/e2ee/folders/42?recursive=true", body="")
    add("signed_request", "PUT with a binary body and a percent-encoded path", account_private_key=account_b["account_private_key"].hex(), challenge=challenge_b.hex(), method_text="PUT", path_text="/api/e2ee/tags/caf%C3%A9?x=1&y=2", body=sequence(256).hex())
    add("signed_request", "path with a non-ASCII character, encoded as UTF-8", account_private_key=account_b["account_private_key"].hex(), challenge=challenge_b.hex(), method_text="PATCH", path_text="/api/e2ee/tags/café", body="")

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

    # account_stanza
    add("account_stanza", "account of the sequence root entropy", account_public_key=account_a["account_public_key"].hex(), ephemeral_private_key=sequence(32, 0x70).hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex())
    add("account_stanza", "second account", account_public_key=account_b["account_public_key"].hex(), ephemeral_private_key=fixed("ephemeral private key 4").hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex())

    # password_stanza
    password_fullwidth = "Ｐａｓｓword ⁵"  # fullwidth "Pass", superscript five
    check(unicodedata.normalize("NFKC", password_fullwidth) == "Password 5", "fullwidth password changes under NFKC")
    add("password_stanza", "ASCII password", password_text="open sesame 42", password_salt=sequence(32, 0x90).hex(), link_secret=link_secret_a.hex(), owner_public_key=owner_public_key.hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex(), link_secret_nonce=sequence(24, 0xB0).hex(), **FAST)
    add("password_stanza", "password that changes under NFKC", password_text=password_fullwidth, password_salt=fixed("password salt b").hex(), link_secret=link_secret_b.hex(), owner_public_key=account_b["account_public_key"].hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex(), link_secret_nonce=fixed("link secret nonce b", 24).hex(), **FAST)
    add("password_stanza", "the NFKC form of that password, same output", password_text="Password 5", password_salt=fixed("password salt b").hex(), link_secret=link_secret_b.hex(), owner_public_key=account_b["account_public_key"].hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex(), link_secret_nonce=fixed("link secret nonce b", 24).hex(), **FAST)
    add("password_stanza", "real parameters", password_text="open sesame 42", password_salt=sequence(32, 0x90).hex(), link_secret=link_secret_a.hex(), owner_public_key=owner_public_key.hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex(), link_secret_nonce=sequence(24, 0xB0).hex(), **REAL)

    # sealed_keyring
    old_keys = [fixed(f"old account private key {n}") for n in (3, 2, 1)]
    add("sealed_keyring", "one old private key", account_private_key=account_a["account_private_key"].hex(), account_public_key=account_a["account_public_key"].hex(), nonce=sequence(24, 0xD0).hex(), old_private_keys=[old_keys[2].hex()])
    add("sealed_keyring", "three old private keys, newest first", account_private_key=account_b["account_private_key"].hex(), account_public_key=account_b["account_public_key"].hex(), nonce=fixed("keyring nonce b", 24).hex(), old_private_keys=[key.hex() for key in old_keys])
    add("sealed_keyring", "empty list of old private keys", account_private_key=account_a["account_private_key"].hex(), account_public_key=account_a["account_public_key"].hex(), nonce=sequence(24, 0xD1).hex(), old_private_keys=[])

    # folder
    add("folder", "folder a", folder_private_key=folder_private_key_a.hex(), account_private_key=account_a["account_private_key"].hex(), metadata_nonce=sequence(24, 0xE0).hex(), private_key_nonce=sequence(24, 0xE8).hex(), folder_metadata_text='{"name":"Screenshots"}')
    add("folder", "folder b, non-ASCII name", folder_private_key=folder_private_key_b.hex(), account_private_key=account_b["account_private_key"].hex(), metadata_nonce=fixed("folder metadata nonce b", 24).hex(), private_key_nonce=fixed("folder private key nonce b", 24).hex(), folder_metadata_text='{"name":"Förderanträge 2026"}')
    add("folder", "folder private key that is not a clamped scalar", folder_private_key=(b"\xff" * 32).hex(), account_private_key=account_a["account_private_key"].hex(), metadata_nonce=sequence(24, 0xE1).hex(), private_key_nonce=sequence(24, 0xE9).hex(), folder_metadata_text='{"name":"x"}')

    # folder_stanzas
    add("folder_stanzas", "folder a", folder_public_key=folder_public_key_a.hex(), ephemeral_private_key=sequence(32, 0x70).hex(), header_hash=header_hash_a.hex(), file_key=file_key_a.hex(), link_secret=link_secret_a.hex(), child_folder_private_key=child_private_key_a.hex(), child_folder_public_key=child_public_key_a.hex())
    add("folder_stanzas", "folder b", folder_public_key=folder_public_key_b.hex(), ephemeral_private_key=fixed("ephemeral private key 5").hex(), header_hash=header_hash_b.hex(), file_key=file_key_b.hex(), link_secret=link_secret_b.hex(), child_folder_private_key=child_private_key_b.hex(), child_folder_public_key=child_public_key_b.hex())

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


def build_vectors() -> list[dict]:
    vectors = []
    for procedure, name, inputs in build_inputs():
        output = PROCEDURES[procedure](inputs)
        vectors.append({"procedure": procedure, "name": name, "input": inputs, "output": output})
    check_vector_set(vectors)
    return vectors


def check_vector_set(vectors: list[dict]) -> None:
    """Checks of the full set against SCHEMA.md."""
    by_procedure: dict[str, list[dict]] = {}
    for vector in vectors:
        by_procedure.setdefault(vector["procedure"], []).append(vector)
    for procedure in PROCEDURES:
        check(len(by_procedure.get(procedure, [])) >= 2, f"{procedure} has at least two vectors")
    for procedure in ("passphrase_keys", "password_stanza"):
        check(
            any(v["input"]["memory_kib"] == 65536 and v["input"]["passes"] == 3 and v["input"]["lanes"] == 4 for v in by_procedure[procedure]),
            f"{procedure} has a vector with the real parameters",
        )
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
        check(len(vector["output"]["stanza"]) == 240, "account stanza hex length")
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
    for procedure, count in counts.items():
        print(f"vectors {count:2d}  {procedure}")
    print(f"vectors {len(vectors)} in total, each round-trip self-check passed")

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
