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
| `known_answers.py`    | Checks of each primitive against published values, and of the rules of draft 18.  |
| `generate_vectors.py` | The fixed inputs, the self-checks and the writer of `v1.json`.                    |
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
seconds. It runs Argon2id with 64 MiB three times. The output agrees with
Prettier; no format step follows.

## Checks

The generator stops before it writes the file if a check fails.

- **Known answers.** BLAKE3 (reference test vectors: hash, keyed hash, key
  derivation), Ed25519 (RFC 8032, tests 1 to 3), X25519 (RFC 7748, sections 5.2
  and 6.1), XChaCha20 and HChaCha20 (draft-irtf-cfrg-xchacha-03, sections 2.2.1
  and A.3.2.1, block counter 0), Argon2id (test values of the reference
  implementation, version `0x13`) and BIP39 (reference vectors).
- **Rules without published values.** `seal_once` is `seal` with the nonce from
  the key and without the nonce in the output. The limits of the canonical form
  of an X25519 public key. The 25 characters with White_Space. The form of
  `method`. No sealed empty keyring.
- **Two code paths.** `seal`, `seal_once`, the file encryption and `public_wrap`
  use library primitives (pycryptodome, libsodium through PyNaCl). `open`,
  `open_once`, the file decryption and `public_unwrap` use the pure Python
  XChaCha20 and X25519 of `reference.py`. Each output is opened again and
  compared with its input.
- **Key conversion.** `ed2curve_private` and `ed2curve_public` use the formulas
  of section 4.4 with integer arithmetic modulo 2^255 - 19. The checks compare
  them with the conversion functions of libsodium, and check that the converted
  private key gives the converted public key.
- **Rejections.** A changed tag, nonce, key, associated data, header or context
  must fail. A file with a removed or an added byte must fail. A file with
  another `chunk_size_log2` must fail. A file of full chunks that ends with a
  final chunk of length zero must fail, although each tag is correct.
- **Rejection vectors.** A vector with the output `{"error": true}` is written
  only after two checks. The first: the strict procedure rejects the input, and
  the cause that it gives is the stated one. The second shows that no other
  cause exists. For a key that is not canonical, a reader without rule 3a of
  section 4.4 opens the same stanza and gets the secret. For a changed byte, the
  stanza before the change opens. For a chunk that breaks a rule of section 7.4,
  the tag is correct.

## Rejection vectors

SCHEMA.md does not give each input name. This program uses these.

| Procedure         | `direction_text` | `input`                                                                                                |
| ----------------- | ---------------- | ------------------------------------------------------------------------------------------------------ |
| `public_wrap`     | `wrap`           | The inputs of a `public_wrap` vector. `recipient_public_key` is not canonical.                         |
| `public_wrap`     | `unwrap`         | `recipient_private_key`, `context_text`, `associated_data`, `stanza`                                   |
| `account_stanza`  | `wrap`           | The inputs of an `account_stanza` vector. The `y` of `account_public_key` is not less than 2^255 - 19. |
| `account_stanza`  | `unwrap`         | `account_private_key` (Ed25519 seed), `header_hash`, `stanza`                                          |
| `password_stanza` | `unwrap`         | `password_text`, `link_secret`, `header_hash`, `stanza`, `memory_kib`, `passes`, `lanes`               |
| `folder_stanzas`  | `wrap`           | `stanza_kind_text` and all inputs of a `folder_stanzas` vector. `folder_public_key` is not canonical.  |
| `folder_stanzas`  | `unwrap`         | `stanza_kind_text`, `folder_private_key`, `stanza`, and `header_hash` or `child_folder_public_key`     |

`stanza_kind_text` is `file`, `link_secret` or `parent`. It names the one
stanza that the vector is about. The kinds `file` and `link_secret` have
`header_hash`. The kind `parent` has `child_folder_public_key`, which is the
associated data of that stanza. Each rejection vector has `direction_text`.

A `decrypt_rejects ...` vector of `file_chunk` has `file_key`, `nonce_prefix`,
`chunk_index`, `is_final` and `stored_chunk`.

The two forms of a key that is not canonical are: the highest bit of the last
byte is 1, and the value 2^255 - 19 + 9 (X25519 reads it as the base point).

## Readings of the specification

Where the specification permits more than one reading, the program uses the
most literal one:

- Section 4.4 rule 3: "decode" is the full point decoding of RFC 8032 section
  5.1.3. A `y` that is not less than 2^255 - 19 fails. A point of small order
  passes the conversion and fails later, when X25519 gives `zeros(32)`.
- Section 4.4 rule 3a: the 32 bytes are one little-endian number of 256 bits.
  The key is canonical if that number is less than 2^255 - 19.
- Section 4.4 rule 7: the steps run in the sequence of the text: NFKC, then the
  removal of White_Space at the two ends, then lower case. Lower case is
  `str.lower` of Python, which is the full default mapping of Unicode without a
  locale. White_Space is the list of `PropList.txt`, 25 characters. U+0085 has
  the property and is removed. U+FEFF does not have it and stays.
- Section 4.4 rule 8: `method` is one or more of the letters `A` to `Z`. The
  program does not change it. Each other text is rejected. `path` is ASCII in
  the percent-encoded form. The program does not reject other characters; it
  encodes them as UTF-8. No vector has such a path.
- Section 4.4 rule 11: `seal_keyring` rejects an empty list. `open_keyring`
  does not reject a sealed empty list, because the rule is for the writer.
- Section 7.3: a plaintext of `n * 65536` bytes, `n > 0`, has `n` chunks. No
  empty chunk follows the last full chunk. Section 7.4 rule 8 makes the reader
  reject the other form.
- Section 7.4 rule 6, for one chunk: a stored chunk that is not final and has
  less than 65568 bytes is rejected, also with a correct tag.
- Section 8.2: the visitor does not open `sealed_link_secret`. A changed byte
  in the last 88 bytes of a password stanza does not stop the unwrap. The
  rejection vectors change a byte in the first 128 bytes only.
- Section 8.4.2: `folder_private_key` is the 32 bytes as made, not the clamped
  scalar. The reader of a `parent_folder_stanza` checks that the private key
  gives the `folder_public_key` of the record. One rejection vector has a
  correct stanza with the private key of a different folder.
