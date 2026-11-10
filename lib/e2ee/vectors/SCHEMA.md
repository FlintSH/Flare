# Test vector schema

`v1.json` holds the test vectors of protocol version 1. The rules are in
[`docs/e2ee-spec.md`](../../../docs/e2ee-spec.md), sections 4 to 9 and 12.1.

```json
{
  "protocol_version": 1,
  "vectors": [
    { "procedure": "seal", "name": "empty message", "input": {}, "output": {} }
  ]
}
```

- Each byte string is lower case hexadecimal. An empty byte string is `""`.
- A key that ends with `_text` holds UTF-8 text, not hexadecimal. The
  exceptions are `sealed_ocr_text` and `ocr_text`: `sealed_ocr_text` is a sealed
  box in hexadecimal, and the input `ocr_text` is UTF-8 text.
- `is_final` is a JSON boolean. `old_private_keys` is an array of hexadecimal
  strings. `record` is hexadecimal.
- A key that ends with `_length` or `_kib`, and `passes`, `lanes`, `chunk_index`,
  hold integers.
- Each random value of the specification is an input, thus each output is fixed.
- No output contains the `record_version` byte, except in `encode_record`.
- Each procedure has at least two vectors, unless the table says more.

The specification fixes the Argon2id parameters at `65536`, `3`, `4`. The
vectors pass them as inputs only so that most vectors can be fast. A fast
vector must use a path of the implementation that is for tests only.
`argon2` inputs appear as `memory_kib`, `passes`, `lanes`. Use `8`, `1`, `1` for
fast vectors. Each procedure that uses Argon2id has one more vector with the
real parameters `65536`, `3`, `4`.

| `procedure`         | `input`                                                                                                                                              | `output`                                                                                                                                                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `blake3_derive_key` | `context_text`, `key_material`                                                                                                                       | `key`                                                                                                                                                                                                                                                            |
| `blake3_keyed_hash` | `key`, `message`                                                                                                                                     | `hash`                                                                                                                                                                                                                                                           |
| `seal`              | `key`, `nonce`, `associated_data`, `message`                                                                                                         | `sealed_box`                                                                                                                                                                                                                                                     |
| `account_keys`      | `root_entropy`                                                                                                                                       | `mnemonic_text`, `account_private_key`, `account_public_key`, `exchange_private_key`, `exchange_public_key`                                                                                                                                                      |
| `passphrase_keys`   | `passphrase_text`, `passphrase_salt`, `memory_kib`, `passes`, `lanes`                                                                                | `passphrase_root`, `auth_private_key`, `auth_public_key`, `wrap_key`                                                                                                                                                                                             |
| `wrapped_root`      | `wrap_key`, `nonce`, `account_public_key`, `root_entropy`                                                                                            | `wrapped_root`                                                                                                                                                                                                                                                   |
| `sign_in_signature` | `auth_private_key`, `challenge`, `identifier_text`                                                                                                   | `signature`                                                                                                                                                                                                                                                      |
| `signed_request`    | `account_private_key`, `challenge`, `method_text`, `path_text`, `body`                                                                               | `signed_message`, `signature`                                                                                                                                                                                                                                    |
| `file_keys`         | `file_key`                                                                                                                                           | `content_cipher_key`, `content_mac_key`, `metadata_key`, `ocr_text_key`, `thumbnail_key`, `link_secret_key`                                                                                                                                                      |
| `header`            | `nonce_prefix`                                                                                                                                       | `header`, `header_hash`                                                                                                                                                                                                                                          |
| `file_chunk`        | `file_key`, `nonce_prefix`, `chunk_index`, `is_final` (`true` or `false`), `chunk_plaintext`                                                         | `stored_chunk`                                                                                                                                                                                                                                                   |
| `file`              | `file_key`, `nonce_prefix`, `plaintext_length`. The plaintext byte at offset `i` is `i mod 251`.                                                     | `stored_length`, `stored_blake3` (`blake3_hash` of the header and all stored chunks)                                                                                                                                                                             |
| `sealed_metadata`   | `file_key`, `nonce`, `header_hash`, `file_metadata_text`                                                                                             | `sealed_metadata`                                                                                                                                                                                                                                                |
| `sealed_ocr_text`   | `file_key`, `nonce`, `header_hash`, `ocr_text`                                                                                                       | `sealed_ocr_text`                                                                                                                                                                                                                                                |
| `sealed_thumbnail`  | `file_key`, `nonce`, `header_hash`, `thumbnail`                                                                                                      | `sealed_thumbnail`                                                                                                                                                                                                                                               |
| `public_wrap`       | `recipient_public_key` (X25519), `ephemeral_private_key`, `context_text`, `associated_data`, `secret`                                                | `stanza`                                                                                                                                                                                                                                                         |
| `account_stanza`    | `account_public_key` (Ed25519), `ephemeral_private_key`, `header_hash`, `file_key`                                                                   | `stanza`                                                                                                                                                                                                                                                         |
| `password_stanza`   | `password_text`, `password_salt`, `link_secret`, `owner_public_key`, `header_hash`, `file_key`, `link_secret_nonce`, `memory_kib`, `passes`, `lanes` | `password_key`, `stanza`                                                                                                                                                                                                                                         |
| `sealed_keyring`    | `account_private_key` (the new one), `account_public_key` (the new one), `nonce`, `old_private_keys` (array, newest first)                           | `keyring_key`, `sealed_keyring`                                                                                                                                                                                                                                  |
| `folder`            | `folder_private_key`, `account_private_key`, `metadata_nonce`, `private_key_nonce`, `folder_metadata_text`                                           | `folder_public_key`, `folder_metadata_key`, `sealed_folder_metadata`, `folder_owner_key`, `sealed_folder_private_key`                                                                                                                                            |
| `folder_stanzas`    | `folder_public_key`, `ephemeral_private_key`, `header_hash`, `file_key`, `link_secret`, `child_folder_private_key`, `child_folder_public_key`        | `folder_file_stanza`, `folder_link_secret_stanza`, `parent_folder_stanza`. Each stanza has its own ephemeral key: `file_ephemeral_private_key`, `link_secret_ephemeral_private_key`, `parent_ephemeral_private_key` replace `ephemeral_private_key` in the input |
| `tag`               | `account_private_key`, `account_public_key`, `nonce`, `tag_metadata_text`                                                                            | `tag_key`, `sealed_tag_metadata`                                                                                                                                                                                                                                 |
| `encode_record`     | `record`                                                                                                                                             | `stored_record`                                                                                                                                                                                                                                                  |

The `file` procedure needs these values of `plaintext_length`: `0`, `1`, `65535`,
`65536`, `65537`, `131072`, `200000`.

Each procedure that wraps or opens a stanza needs one more vector with the
name `rejects ...` and an `output` of `{ "error": true }` for these inputs: a
public key that is not canonical, and a stanza with one changed byte. The
`file` procedure has no vector for a zero-length final chunk after a full
chunk; the `file_chunk` procedure has one with `"error": true` in a
`decrypt_rejects` vector: `input` holds `file_key`, `nonce_prefix`,
`chunk_index`, `is_final`, `stored_chunk`, and `output` is `{ "error": true }`.

The `sealed_keyring` procedure has no vector with an empty list.

The `sign_in_signature` procedure has one more output, `identifier_normalized_text`.
