import type { ZxcvbnFactory } from '@zxcvbn-ts/core'

/**
 * The strength check of docs/e2ee-spec.md, section 5.2.1. It runs only in
 * the client: the server never gets the secret. It protects a person from a
 * weak selection and is not a security boundary.
 */
export const MINIMUM_STRENGTH_SCORE = 3

/** zxcvbn becomes slow on long text, and the start of a secret decides its score. */
const MEASURED_CHARACTERS = 128

/** The longest passphrase that a form accepts. Argon2id takes any length. */
export const PASSPHRASE_MAX_LENGTH = 1024

export interface PassphraseStrength {
  /** 0 (trivial) to 4 (very strong). */
  readonly score: 0 | 1 | 2 | 3 | 4
  readonly acceptable: boolean
  /** Why the secret is weak, in a sentence, or null. */
  readonly warning: string | null
  readonly suggestions: readonly string[]
}

let loading: Promise<ZxcvbnFactory> | null = null

/**
 * The estimator with the common and the English dictionaries. They are about
 * 1.5 MB of JSON, so they load on the first use, in chunks of their own.
 */
function estimator(): Promise<ZxcvbnFactory> {
  loading ??= Promise.all([
    import('@zxcvbn-ts/core'),
    import('@zxcvbn-ts/language-common'),
    import('@zxcvbn-ts/language-en'),
  ])
    .then(
      ([core, common, english]) =>
        new core.ZxcvbnFactory({
          dictionary: { ...common.dictionary, ...english.dictionary },
          graphs: common.adjacencyGraphs,
          translations: english.translations,
        })
    )
    .catch((error) => {
      loading = null
      throw error
    })
  return loading
}

/** Starts the download of the dictionaries, for a form that will need them soon. */
export function preloadStrengthCheck(): void {
  void estimator().catch(() => undefined)
}

/** The parts of a value that a person might put in a secret: the value, and an address split at `@` and `.`. */
function userInputTerms(inputs: readonly (string | null | undefined)[]) {
  const terms = new Set<string>()
  for (const input of inputs) {
    const value = input?.trim()
    if (!value) continue
    terms.add(value)
    for (const part of value.split(/[@.\s_+-]+/)) {
      if (part.length >= 3) terms.add(part)
    }
  }
  return [...terms]
}

/**
 * Measures a new passphrase. `userInputs` are the account identifier, the
 * username and the instance name: a secret that contains them gets a lower
 * score.
 */
export async function measurePassphrase(
  passphrase: string,
  userInputs: readonly (string | null | undefined)[] = []
): Promise<PassphraseStrength> {
  const zxcvbn = await estimator()
  const result = zxcvbn.check(
    passphrase.normalize('NFKC').slice(0, MEASURED_CHARACTERS),
    userInputTerms(userInputs)
  )
  return {
    score: result.score,
    acceptable: result.score >= MINIMUM_STRENGTH_SCORE,
    warning: result.feedback.warning || null,
    suggestions: result.feedback.suggestions,
  }
}
