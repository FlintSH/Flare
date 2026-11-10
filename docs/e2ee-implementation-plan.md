# Flare E2EE implementation plan

This plan implements [the specification](e2ee-spec.md). The specification is
the source of truth. A phase changes the specification in the same commit if
the code shows that a rule is wrong or not complete.

All work is on the branch `feat/e2ee`. Each phase ends with passing tests and
can be reviewed alone. Nothing is visible to a user before phase 3.

## Rules for each phase

- The repository rules of `AGENTS.md` apply: handbook pages, API reference
  and visual evidence change together with the behaviour.
- Each cryptographic function is a pure function with explicit random
  inputs. Test vectors fix its output.
- Two implementations are made from the specification without sight of each
  other: the TypeScript library and a small reference program. They must
  agree on each vector. A difference is a defect in one of them or an
  ambiguity in the specification.
- No phase sends a passphrase, a private key, a file key or a link fragment
  to the server.

## Phases

| Phase | Content                                                                                                                                                | Spec sections                                                                   | Depends on |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ---------- |
| 1     | Crypto library `lib/e2ee`, reference program, test vectors                                                                                             | 1.5, 4, 5.1, 6.2, 6.6, 7, 8.1, 8.2, 8.3.3 (keyring), 8.4, 9.1, 9.5, 9.6.1, 12.1 | none       |
| 2     | Accounts: database fields, key setup, new sign-in, unlock after passkey or OIDC, key storage in the browser, rotation, recovery, reset, strength check | 5, 6, 8.3, 14.1                                                                 | 1          |
| 3     | Encrypted upload, download and view in the browser. Share links, password stanzas, generic link preview, script policy with nonce                      | 7, 8.1, 8.2, 9.1 to 9.3, 10, 11, 13                                             | 2          |
| 4     | Library: folders, tags, search with the local cache, thumbnails, text from images, work that waits for the browser                                     | 8.4, 9.4 to 9.8, 12.1                                                           | 3          |
| 5     | Video and audio through a service worker, archives, export                                                                                             | 12.2 to 12.4                                                                    | 3          |
| 6     | Program for script clients, upload profiles with the `encryption` setting, new configurations, webhook version 2                                       | 10.2, 10.4, 11.2, 12.7, 14.4                                                    | 3          |
| 7     | Migration of existing accounts, files and tokens                                                                                                       | 14                                                                              | 2, 3, 4    |
| 8     | Measurements: Argon2id on a slow phone, large libraries, large files                                                                                   | 4.3, 9.8                                                                        | 2, 4       |

## Phase 1 in detail

Dependencies, all pinned to exact versions:

| Package          | Use                                               |
| ---------------- | ------------------------------------------------- |
| `@noble/curves`  | Ed25519, X25519, Edwards to Montgomery conversion |
| `@noble/ciphers` | XChaCha20                                         |
| `@noble/hashes`  | BLAKE3, Argon2id for tests and for the server     |
| `@scure/bip39`   | Mnemonic                                          |
| `hash-wasm`      | Argon2id in the browser, through WebAssembly      |

Modules of `lib/e2ee`:

| Module       | Content                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `primitives` | `blake3_hash`, `blake3_keyed_hash`, `blake3_derive_key`, XChaCha20, X25519, Ed25519, key conversion, constant-time compare |
| `contexts`   | Each context string, in one table                                                                                          |
| `seal`       | `seal`, `open`                                                                                                             |
| `account`    | Key hierarchy, mnemonic, passphrase keys, `wrapped_root`, signatures for sign-in and for signed requests, keyring          |
| `file`       | Header, chunk encryption and decryption as a stream, read of a byte range                                                  |
| `stanza`     | `public_wrap`, account stanza, password stanza, folder stanzas                                                             |
| `records`    | Sealed metadata, tag records, folder records, image text, thumbnails, `record_version`                                     |
| `errors`     | One error type with a reason code. No error text that contains a secret                                                    |

The library has no dependency on Next.js, on the DOM or on Node.js modules.
It operates in a browser, in a worker, in a service worker and on the
server.

Phase 1 is complete when:

1. each vector of `lib/e2ee/vectors/v1.json` passes in the TypeScript
   library,
2. the reference program reproduces the same file from the specification,
3. each `open` and each decryption rejects a changed byte, a changed
   sequence, a truncation and data after the last chunk,
4. the repository checks pass: type check, lint, tests.
