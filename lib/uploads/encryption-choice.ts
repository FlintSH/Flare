/**
 * The Encryption choice of an upload form (docs/e2ee-spec.md, section
 * 11.2). The form shows first what the selected upload profile says. A
 * choice that the person makes is explicit and wins, until they select a
 * different profile.
 *
 * The setting of a profile arrives from the server after the form is on
 * the page. A person can choose before that. Their choice must stay: a
 * late answer for the same profile changes nothing.
 */
export type UploadEncryptionMode = 'encrypted' | 'plain'

export interface EncryptionChoiceState {
  readonly mode: UploadEncryptionMode
  /** The profile for which the person chose. No entry: they did not choose. */
  readonly chosenFor: { readonly profileId: string | null | undefined } | null
}

export type EncryptionChoiceAction =
  /** The person selected a mode while this profile was selected. */
  | {
      readonly by: 'person'
      readonly mode: UploadEncryptionMode
      readonly profileId: string | null | undefined
    }
  /** The setting of the selected profile is known, or the selection changed. */
  | {
      readonly by: 'profile'
      readonly mode: UploadEncryptionMode
      readonly profileId: string | null | undefined
    }

export const INITIAL_ENCRYPTION_CHOICE: EncryptionChoiceState = {
  mode: 'encrypted',
  chosenFor: null,
}

export function encryptionChoice(
  state: EncryptionChoiceState,
  action: EncryptionChoiceAction
): EncryptionChoiceState {
  if (action.by === 'person')
    return { mode: action.mode, chosenFor: { profileId: action.profileId } }
  // The person chose for this profile: its setting does not replace that.
  if (state.chosenFor && state.chosenFor.profileId === action.profileId)
    return state
  if (state.mode === action.mode && !state.chosenFor) return state
  return { mode: action.mode, chosenFor: null }
}
