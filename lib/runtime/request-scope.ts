import { cache } from 'react'

import { AsyncLocalStorage } from 'node:async_hooks'

type Scope = Map<string, unknown>

// Route bundles each load their own copy of this module; they share one store.
const storeKey = Symbol.for('flare.runtime.request-scope')
const processState = globalThis as typeof globalThis & {
  [storeKey]?: AsyncLocalStorage<Scope>
}
const handlerScope = (processState[storeKey] ??= new AsyncLocalStorage<Scope>())

// React keeps a `cache` result for one server render, which for a page is one
// request: its layouts, metadata and components all get this map. Outside a
// render every call gets a new one.
const renderScope = cache((): Scope => new Map())

/** Runs a route handler as one request. Pages need no wrapper. */
export function withRequestScope<T>(run: () => T): T {
  return handlerScope.run(new Map(), run)
}

/**
 * `load()`'s result, shared by every caller that asks under `name` while the
 * same request is handled, so a request reads it once. Nothing outlives the
 * request, and outside one each call loads again.
 */
export function oncePerRequest<T>(name: string, load: () => T): T {
  const scope = handlerScope.getStore() ?? renderScope()
  if (!scope.has(name)) scope.set(name, load())
  return scope.get(name) as T
}
