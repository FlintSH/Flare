/**
 * TEST ONLY. Paths that skip a safety rule so that tests and test vectors
 * can be cheap or can fix an intermediate value:
 *
 * - Argon2id with parameters below the minimum of section 4.3,
 * - a chunk of any length with any `final_flag`.
 *
 * Application code must not import this module. `index.ts` does not export
 * these functions.
 */
export { derivePassphraseKeysForTestsOnly } from './account'
export { encryptChunkUnchecked } from './file'
export { stretchSecretTextForTestsOnly } from './kdf'
export {
  unwrapPasswordStanzaForTestsOnly,
  wrapPasswordStanzaForTestsOnly,
} from './stanza'
