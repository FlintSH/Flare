/**
 * Zod tests once whether it may compile validators with `Function`. A
 * worker has the script policy of its page, which forbids that, and the
 * refused test would be reported as a violation. Import this first in a
 * worker that loads Zod, as the root layout does for pages.
 */
;(globalThis as { __zod_globalConfig?: unknown }).__zod_globalConfig = {
  jitless: true,
}

export {}
