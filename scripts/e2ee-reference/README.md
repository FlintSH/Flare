# E2EE reference program

A Python reference implementation of protocol version 1 of
[`docs/e2ee-spec.md`](../../docs/e2ee-spec.md). It makes the test vectors in
[`lib/e2ee/vectors/v1.json`](../../lib/e2ee/vectors/v1.json), in the format of
[`SCHEMA.md`](../../lib/e2ee/vectors/SCHEMA.md).

The program was written from the specification text only. It shares no code
with `lib/e2ee/*.ts`. If the two give the same vectors, both agree with the
specification.

It is not production code. It does not run in constant time and it does not
erase secrets.

## Files

| File                  | Content                                                                           |
| --------------------- | --------------------------------------------------------------------------------- |
| `reference.py`        | One function for each procedure of the specification, and each reverse procedure. |
| `known_answers.py`    | Checks of each primitive against published values.                                |
| `generate_vectors.py` | The fixed inputs, the round-trip self-checks and the writer of `v1.json`.         |
| `requirements.txt`    | Pinned library versions.                                                          |

## Run

Use Python 3.12. Keep the virtual environment outside the repository.

```sh
python3.12 -m venv /tmp/e2ee-venv
/tmp/e2ee-venv/bin/pip install -r scripts/e2ee-reference/requirements.txt

# Known-answer checks only
/tmp/e2ee-venv/bin/python scripts/e2ee-reference/known_answers.py

# Make lib/e2ee/vectors/v1.json again
/tmp/e2ee-venv/bin/python scripts/e2ee-reference/generate_vectors.py

# Make the vectors and compare them with the file. Writes nothing.
/tmp/e2ee-venv/bin/python scripts/e2ee-reference/generate_vectors.py --check
```

Each input is fixed, thus two runs give the same bytes. One run takes a few
seconds. It runs Argon2id with 64 MiB three times.

## Checks

The generator stops before it writes the file if a check fails.

- **Known answers.** BLAKE3 (reference test vectors: hash, keyed hash, key
  derivation), Ed25519 (RFC 8032, tests 1 to 3), X25519 (RFC 7748, sections 5.2
  and 6.1), XChaCha20 and HChaCha20 (draft-irtf-cfrg-xchacha-03, sections 2.2.1
  and A.3.2.1, block counter 0), Argon2id (test values of the reference
  implementation, version `0x13`) and BIP39 (reference vectors).
- **Two code paths.** `seal`, the file encryption and `public_wrap` use library
  primitives (pycryptodome, libsodium through PyNaCl). `open`, the file
  decryption and `public_unwrap` use the pure Python XChaCha20 and X25519 of
  `reference.py`. Each output is opened again and compared with its input.
- **Key conversion.** `ed2curve_private` and `ed2curve_public` use the formulas
  of section 4.4 with integer arithmetic modulo 2^255 - 19. The checks compare
  them with the conversion functions of libsodium, and check that the converted
  private key gives the converted public key.
- **Rejections.** A changed tag, nonce, key, associated data, header or context
  must fail. A file with a removed or an added byte must fail.

## Readings of the specification

Where the specification permits more than one reading, the program uses the
most literal one:

- Section 4.4 rule 3: "decode" is the full point decoding of RFC 8032 section
  5.1.3. A `y` that is not less than 2^255 - 19 fails. A point of small order
  passes the conversion and fails later, when X25519 gives `zeros(32)`.
- Section 4.4 rule 7: "spaces" are U+0020 only. Lower case is the default
  Unicode mapping. The identifier is not normalized.
- Section 4.4 rule 8: `method` must be in upper case already. The program does
  not change it.
- Section 7.3: a plaintext of `n * 65536` bytes, `n > 0`, has `n` chunks. No
  empty chunk follows the last full chunk.
- Section 8.4.2: `folder_private_key` is the 32 bytes as made, not the clamped
  scalar.
- Section 8.3.3: an empty list of old private keys gives the `seal` of an empty
  message.
