/**
 * TEST ONLY. Paths that skip a rule of the protocol so that tests and test
 * vectors can be cheap or can fix an intermediate value:
 *
 * - Argon2id with explicit parameters. Protocol version 1 has one fixed
 *   parameter set (section 4.3), and the production functions take no
 *   parameter argument.
 * - a chunk of any length with any `final_flag`.
 *
 * Application code must not import this module. `index.ts` does not export
 * these functions.
 */
export { derivePassphraseKeysWithParametersForTestsOnly } from './account'
export { encryptChunkUnchecked } from './file'
export { stretchSecretTextWithParametersForTestsOnly } from './kdf'
export {
  unwrapPasswordStanzaWithParametersForTestsOnly,
  wrapPasswordStanzaWithParametersForTestsOnly,
} from './stanza'
