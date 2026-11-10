"""Known-answer checks of the primitives against published values.

A failure here means that this program uses a library in the wrong way, or
that a pure Python primitive of reference.py is wrong. The generator runs
these checks before it writes any vector.
"""

from __future__ import annotations

import hashlib

import nacl.bindings

import reference as ref

h = bytes.fromhex


def _equal(name: str, actual: bytes | str, expected: bytes | str) -> None:
    if actual != expected:
        shown = actual.hex() if isinstance(actual, bytes) else actual
        raise AssertionError(f"known answer failed: {name}: got {shown}")


def _expect_reject(name: str, function, *arguments) -> None:
    try:
        function(*arguments)
    except ref.Reject:
        return
    raise AssertionError(f"known answer failed: {name}: no rejection")


def check_blake3() -> int:
    """BLAKE3 reference test vectors (test_vectors/test_vectors.json).

    The input byte at offset i is i mod 251. The first 32 bytes of each
    published output are compared.
    """
    key = b"whats the Elvish word for friend"
    context = "BLAKE3 2019-12-27 16:29:52 test vectors context"
    cases = {
        0: (
            "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262",
            "92b2b75604ed3c761f9d6f62392c8a9227ad0ea3f09573e783f1498a4ed60d26",
            "2cc39783c223154fea8dfb7c1b1660f2ac2dcbd1c1de8277b0b0dd39b7e50d7d",
        ),
        1: (
            "2d3adedff11b61f14c886e35afa036736dcd87a74d27b5c1510225d0f592e213",
            "6d7878dfff2f485635d39013278ae14f1454b8c0a3a2d34bc1ab38228a80c95b",
            "b3e2e340a117a499c6cf2398a19ee0d29cca2bb7404c73063382693bf66cb06c",
        ),
        1025: (
            "d00278ae47eb27b34faecf67b4fe263f82d5412916c1ffd97c8cb7fb814b8444",
            "357dc55de0c7e382c900fd6e320acc04146be01db6a8ce7210b7189bd664ea69",
            "effaa245f065fbf82ac186839a249707c3bddf6d3fdda22d1b95a3c970379bcb",
        ),
    }
    for length, (hash_hex, keyed_hex, derive_hex) in cases.items():
        message = bytes(i % 251 for i in range(length))
        _equal(f"blake3_hash {length}", ref.blake3_hash(message), h(hash_hex))
        _equal(f"blake3_keyed_hash {length}", ref.blake3_keyed_hash(key, message), h(keyed_hex))
        _equal(f"blake3_derive_key {length}", ref.blake3_derive_key(context, message), h(derive_hex))
    return 9


def check_ed25519() -> int:
    """RFC 8032 section 7.1, TEST 1, TEST 2 and TEST 3."""
    cases = [
        (
            "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
            "",
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
            "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
        ),
        (
            "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
            "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
            "72",
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
            "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
        ),
        (
            "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
            "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
            "af82",
            "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac"
            "18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
        ),
    ]
    for index, (seed, public_key, message, signature) in enumerate(cases, start=1):
        _equal(f"Ed25519 TEST {index} public key", ref.ed25519_public_key(h(seed)), h(public_key))
        _equal(f"Ed25519 TEST {index} signature", ref.ed25519_sign(h(seed), h(message)), h(signature))
        if not ref.ed25519_verify(h(public_key), h(message), h(signature)):
            raise AssertionError(f"known answer failed: Ed25519 TEST {index} verify")
    return 9


def check_x25519() -> int:
    """RFC 7748 section 5.2 (two function vectors) and section 6.1 (Diffie-Hellman)."""
    function_cases = [
        (
            "a546e36bf0527c9d3b16154b82465edd62144c0ac1fc5a18506a2244ba449ac4",
            "e6db6867583030db3594c1a424b15f7c726624ec26b3353b10a903a6d0ab1c4c",
            "c3da55379de9c6908e94ea4df28d084f32eccf03491c71f754b4075577a28552",
        ),
        (
            "4b66e9d4d1b4673c5ad22691957d6af5c11b6421e0ea01d42ca4169e7918ba0d",
            "e5210f12786811d3f4b7959d0538ae2c31dbe7106fc03c3efc4cd549c715a493",
            "95cbde9476e8907d7aade45cb4b873f88b595a68799fa152e6f8f7647aac7957",
        ),
    ]
    count = 0
    for scalar, u_coordinate, output in function_cases:
        _equal("X25519 function, library", ref.x25519(h(scalar), h(u_coordinate)), h(output))
        _equal("X25519 function, pure", ref.x25519_pure(h(scalar), h(u_coordinate)), h(output))
        count += 2
    alice_private = h("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a")
    alice_public = h("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a")
    bob_private = h("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb")
    bob_public = h("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f")
    shared = h("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742")
    _equal("X25519 Alice public, library", ref.x25519_public_key(alice_private), alice_public)
    _equal("X25519 Bob public, library", ref.x25519_public_key(bob_private), bob_public)
    _equal("X25519 Alice public, pure", ref.x25519_pure(alice_private, ref.X25519_BASE_POINT), alice_public)
    _equal("X25519 Bob public, pure", ref.x25519_pure(bob_private, ref.X25519_BASE_POINT), bob_public)
    _equal("X25519 shared, library", ref.x25519(alice_private, bob_public), shared)
    _equal("X25519 shared, pure", ref.x25519_pure(bob_private, alice_public), shared)
    # A point of small order gives zeros(32). Sections 8.1 and 8.4.1 reject it.
    _expect_reject("X25519 zero output, library", ref.x25519, alice_private, bytes(32))
    _expect_reject("X25519 zero output, pure", ref.x25519_checked_pure, alice_private, bytes(32))
    return count + 8


_DHOLE_PLAINTEXT = (
    b'The dhole (pronounced "dole") is also known as the Asiatic wild dog, red dog, and whistling dog. '
    b"It is about the size of a German shepherd but looks more like a long-legged fox. "
    b"This highly elusive and skilled jumper is classified with wolves, coyotes, jackals, and foxes "
    b"in the taxonomic family Canidae."
)

_DHOLE_CIPHERTEXT_COUNTER_0 = (
    "4559abba4e48c16102e8bb2c05e6947f50a786de162f9b0b7e592a9b53d0d4e9"
    "8d8d6410d540a1a6375b26d80dace4fab52384c731acbf16a5923c0c48d3575d"
    "4d0d2c673b666faa731061277701093a6bf7a158a8864292a41c48e3a9b4c0da"
    "ece0f8d98d0d7e05b37a307bbb66333164ec9e1b24ea0d6c3ffddcec4f68e744"
    "3056193a03c810e11344ca06d8ed8a2bfb1e8d48cfa6bc0eb4e2464b74814240"
    "7c9f431aee769960e15ba8b96890466ef2457599852385c661f752ce20f9da0c"
    "09ab6b19df74e76a95967446f8d0fd415e7bee2a12a114c20eb5292ae7a349ae"
    "577820d5520a1f3fb62a17ce6a7e68fa7c79111d8860920bc048ef43fe84486c"
    "cb87c25f0ae045f0cce1e7989a9aa220a28bdd4827e751a24a6d5c62d790a663"
    "93b93111c1a55dd7421a10184974c7c5"
)


def check_xchacha20() -> int:
    """draft-irtf-cfrg-xchacha-03, section 2.2.1 (HChaCha20) and A.3.2.1 (counter 0)."""
    _equal(
        "HChaCha20, pure",
        ref.hchacha20_pure(bytes(range(32)), h("000000090000004a0000000031415927")),
        h("82413b4227b27bfed30e42508a877d73a0f9e4d58a74a853c12ec41326d3ecdc"),
    )
    key = bytes(range(0x80, 0xA0))
    nonce = h("404142434445464748494a4b4c4d4e4f5051525354555658")
    expected = h(_DHOLE_CIPHERTEXT_COUNTER_0)
    if len(_DHOLE_PLAINTEXT) != 304:
        raise AssertionError("known answer failed: XChaCha20 plaintext length")
    _equal("XChaCha20 counter 0, library", ref.xchacha20(key, nonce, _DHOLE_PLAINTEXT), expected)
    _equal("XChaCha20 counter 0, pure", ref.xchacha20_pure(key, nonce, _DHOLE_PLAINTEXT), expected)
    return 3


def check_argon2id() -> int:
    """Argon2 reference implementation, src/test.c, version 0x13, Argon2id.

    t=2, m=2^16 KiB, p=1 and t=2, m=2^8 KiB, p=2, password "password", salt "somesalt".
    """
    _equal(
        "Argon2id t=2 m=65536 p=1",
        ref.argon2id(b"password", b"somesalt", 65536, 2, 1),
        h("09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7"),
    )
    _equal(
        "Argon2id t=2 m=256 p=2",
        ref.argon2id(b"password", b"somesalt", 256, 2, 2),
        h("6d093c501fd5999645e0ea3bf620d7b8be7fd2db59c20d9fff9539da2bf57037"),
    )
    return 2


def check_bip39() -> int:
    """BIP39 reference vectors (trezor/python-mnemonic vectors.json), 256-bit entropy."""
    import mnemonic

    library = mnemonic.Mnemonic("english")
    cases = [
        (bytes(32), "abandon " * 23 + "art"),
        (b"\x7f" * 32, "legal winner thank year wave sausage worth useful " * 2
         + "legal winner thank year wave sausage worth title"),
        (b"\x80" * 32, "letter advice cage absurd amount doctor acoustic avoid " * 2
         + "letter advice cage absurd amount doctor acoustic bless"),
        (b"\xff" * 32, "zoo " * 23 + "vote"),
    ]
    for entropy, words in cases:
        _equal("BIP39 words", ref.mnemonic_from_entropy(entropy), words)
        _equal("BIP39 words, library", library.to_mnemonic(entropy), words)
        _equal("BIP39 entropy", ref.entropy_from_mnemonic(words), entropy)
    return 12


def check_ed2curve() -> int:
    """Section 4.4 rules 2 and 3 against libsodium and against X25519 itself."""
    count = 0
    seeds = [bytes(32), bytes(range(32)), b"\xff" * 32] + [
        ref.blake3_hash(b"ed2curve check %d" % i) for i in range(16)
    ]
    for seed in seeds:
        public_key = ref.ed25519_public_key(seed)
        exchange_private_key = ref.ed2curve_private(seed)
        exchange_public_key = ref.ed2curve_public(public_key)
        _equal(
            "ed2curve_private, libsodium",
            exchange_private_key,
            ref.clamp_x25519(nacl.bindings.crypto_sign_ed25519_sk_to_curve25519(seed + public_key)),
        )
        _equal(
            "ed2curve_public, libsodium",
            exchange_public_key,
            nacl.bindings.crypto_sign_ed25519_pk_to_curve25519(public_key),
        )
        # The two conversions must agree: the converted private key gives the converted public key.
        _equal("ed2curve pair, library", ref.x25519_public_key(exchange_private_key), exchange_public_key)
        _equal(
            "ed2curve pair, pure", ref.x25519_pure(exchange_private_key, ref.X25519_BASE_POINT), exchange_public_key
        )
        count += 4
    # RFC 8032 TEST 1 seed: the SHA-512 step, written out.
    seed = h("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60")
    digest = bytearray(hashlib.sha512(seed).digest()[:32])
    digest[0] &= 0xF8
    digest[31] = (digest[31] & 0x7F) | 0x40
    _equal("ed2curve_private, by hand", ref.ed2curve_private(seed), bytes(digest))
    # Failures of rule 3.
    one = (1).to_bytes(32, "little")
    _expect_reject("ed2curve_public y = 1", ref.ed2curve_public, one)
    _expect_reject("ed2curve_public y = 1 with sign bit", ref.ed2curve_public, one[:31] + b"\x80")
    _expect_reject("ed2curve_public y = 2 (not on the curve)", ref.ed2curve_public, (2).to_bytes(32, "little"))
    _expect_reject(
        "ed2curve_public y = p + 3 (not canonical)", ref.ed2curve_public, (ref.FIELD_PRIME + 3).to_bytes(32, "little")
    )
    return count + 5


def run_all() -> dict[str, int]:
    return {
        "BLAKE3 (reference test vectors)": check_blake3(),
        "Ed25519 (RFC 8032)": check_ed25519(),
        "X25519 (RFC 7748)": check_x25519(),
        "XChaCha20 (draft-irtf-cfrg-xchacha-03)": check_xchacha20(),
        "Argon2id (reference implementation test.c)": check_argon2id(),
        "BIP39 (reference vectors)": check_bip39(),
        "ed2curve (libsodium cross-check)": check_ed2curve(),
    }


if __name__ == "__main__":
    for name, count in run_all().items():
        print(f"ok  {count:3d} checks  {name}")
