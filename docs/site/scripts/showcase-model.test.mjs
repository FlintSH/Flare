import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  advanceShowcase,
  initialShowcase,
  showcaseChapters,
  SHOWCASE_DURATION,
} from '../.vitepress/theme/components/showcase-model.mjs'

test('still preview starts complete and paused, including reduced-motion readers', () => {
  const state = initialShowcase()
  assert.equal(state.mode, 'paused')
  assert.equal(state.elapsed, SHOWCASE_DURATION)
  assert.equal(showcaseChapters[state.chapter].id, 'capture')
  assert.equal(advanceShowcase(state, 500), state)
})

test('playback crosses chapter and loop boundaries without losing elapsed time', () => {
  const state = {
    chapter: showcaseChapters.length - 1,
    elapsed: SHOWCASE_DURATION - 40,
    mode: 'playing',
  }
  const next = advanceShowcase(state, 100)
  assert.deepEqual(next, { chapter: 0, elapsed: 60, mode: 'playing' })
  assert.equal(state.elapsed, SHOWCASE_DURATION - 40)
  assert.deepEqual(advanceShowcase(next, SHOWCASE_DURATION * 2 + 20), {
    chapter: 2,
    elapsed: 80,
    mode: 'playing',
  })
})

test('paused playback and invalid clock deltas cannot advance the preview', () => {
  const state = { chapter: 2, elapsed: 900, mode: 'playing' }
  for (const delta of [0, -1, NaN, Infinity])
    assert.equal(advanceShowcase(state, delta), state)
  assert.equal(advanceShowcase({ ...state, mode: 'paused' }, 500).elapsed, 900)
})
