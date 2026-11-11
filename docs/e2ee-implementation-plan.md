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

## State on 2026-11-10

Phases 1 to 7 are implemented on `feat/e2ee`. The pull request is a draft
and no person has reviewed the cryptography or the code.

| Phase | State                                                                                                                                                                     |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Done. 137 shared vectors. The TypeScript library, the Python reference and the Rust client agree on the vectors of the procedures that each implements.                   |
| 2     | Done.                                                                                                                                                                     |
| 3     | Done.                                                                                                                                                                     |
| 4     | Done.                                                                                                                                                                     |
| 5     | Done. Tested in Chromium only.                                                                                                                                            |
| 6     | Done. The program is built and tested on Linux x86_64 only. The workflow for the other platforms has not run.                                                             |
| 7     | Done for accounts, tokens and files. The files of an account that does not come back stay plain (specification, section 14.3).                                            |
| 8     | Done in Chromium on a desktop processor (below). Not done: a measurement on a real phone. The Argon2id times for slower devices are estimates from a slowed-down browser. |

A security review in two passes read the branch on 2026-11-10. Draft 23 of
the specification records its results. Section 15 of the specification
lists the questions that it left open (questions 3 to 6).

### Measurements

On a virtual machine with 4 cores of an AMD Ryzen 9 5950X, with headless
Chromium, local storage and the production build.

**Large files** (`scripts/e2ee/measure-media.cjs`):

| What                                                | Result                                        |
| --------------------------------------------------- | --------------------------------------------- |
| Upload of a 2 GiB file from the browser             | 182 s. Peak memory of the browser: 975 MiB.   |
| Download of a 2 GiB file through the service worker | 148 s.                                        |
| Seek to the middle of a 2-hour video of 1,445 MiB   | 0.67 s. 7.2 MiB of ciphertext in 15 requests. |

**A large library** (`scripts/e2ee/measure-library.cjs`): one account with
20,000 encrypted files, 1,000 of them images with about 700 bytes of sealed
image text each. Specification, section 9.8.

| What                                                             | Result                                |
| ---------------------------------------------------------------- | ------------------------------------- |
| First files on the page after sign-in                            | 1.2 s                                 |
| First sync of the search cache                                   | 41 requests, 17.3 MiB, done at 13.2 s |
| Every file can be found, first visit                             | 13.7 s after sign-in                  |
| Size of the cache in the browser (ciphertext)                    | 17.4 MiB                              |
| Every file can be found, later visit (2 requests, cache on disk) | 4.6 s                                 |
| One search, from the last key to the result on the page          | 0.91 s median, 1.05 s slowest of 12   |
| Memory of all browser processes                                  | 539 MiB after the sync, 667 MiB peak  |

The library shows files before the cache is complete. A search during the
first sync gives its result when the record arrives. The time of one search
contains the delay of the search field and one request to the server for
the rows. The memory contains what the test tool keeps of each answer.

**Argon2id** (`scripts/e2ee/measure-argon2.cjs`): 64 MiB, 3 passes, 4 lanes,
with the WebAssembly code of the browser client, 5 runs for each row.
Specification, section 4.3.

| Processor of the page      | Median | Slowest |
| -------------------------- | ------ | ------- |
| As it is                   | 0.24 s | 0.26 s  |
| Slowed down by a factor 2  | 0.47 s | 0.51 s  |
| Slowed down by a factor 4  | 1.09 s | 1.24 s  |
| Slowed down by a factor 6  | 1.54 s | 1.73 s  |
| Slowed down by a factor 10 | 2.78 s | 3.08 s  |

The rows with a factor are estimates. Chromium slows the processor of the
page; it does not make the memory slower, and it does not show if a phone
can give 64 MiB to one page. A sign-in or an unlock does this calculation
one time. A measurement on a real phone is still to do: sign in on the
phone and note the time between the passphrase and the library.

Firefox, Safari, mobile browsers and S3 storage are not measured.

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
