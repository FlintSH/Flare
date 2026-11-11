import { describe, expect, it } from 'vitest'

import {
  INITIAL_ENCRYPTION_CHOICE,
  encryptionChoice,
} from '@/lib/uploads/encryption-choice'

describe('the Encryption choice of an upload form (section 11.2)', () => {
  it('shows what the selected profile says until the person chooses', () => {
    let state = INITIAL_ENCRYPTION_CHOICE
    expect(state.mode).toBe('encrypted')
    state = encryptionChoice(state, {
      by: 'profile',
      mode: 'plain',
      profileId: 'tools',
    })
    expect(state.mode).toBe('plain')
  })

  it('keeps a choice that was made before the setting of the profile arrived', () => {
    // The form is on the page. The profiles are still on their way.
    let state = encryptionChoice(INITIAL_ENCRYPTION_CHOICE, {
      by: 'person',
      mode: 'plain',
      profileId: undefined,
    })
    // The answer of the server for the same selection says "encrypted".
    state = encryptionChoice(state, {
      by: 'profile',
      mode: 'encrypted',
      profileId: undefined,
    })
    expect(state.mode).toBe('plain')
  })

  it('follows a different profile, and the first one again after that', () => {
    let state = encryptionChoice(INITIAL_ENCRYPTION_CHOICE, {
      by: 'person',
      mode: 'plain',
      profileId: 'a',
    })
    state = encryptionChoice(state, {
      by: 'profile',
      mode: 'encrypted',
      profileId: 'b',
    })
    expect(state).toEqual({ mode: 'encrypted', chosenFor: null })
    // Back at the first profile, its own setting shows: the earlier choice
    // ended when the person selected a different profile.
    state = encryptionChoice(state, {
      by: 'profile',
      mode: 'encrypted',
      profileId: 'a',
    })
    expect(state.mode).toBe('encrypted')
    state = encryptionChoice(state, {
      by: 'profile',
      mode: 'plain',
      profileId: 'c',
    })
    expect(state.mode).toBe('plain')
  })

  it('gives the same state back when nothing changes', () => {
    const state = encryptionChoice(INITIAL_ENCRYPTION_CHOICE, {
      by: 'profile',
      mode: 'encrypted',
      profileId: null,
    })
    expect(state).toBe(INITIAL_ENCRYPTION_CHOICE)
  })
})
