import {
  type MutableRefObject,
  type ReactNode,
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
} from 'react'

type Lifetime = MutableRefObject<AbortController>
const RequestLifetimeContext = createContext<Lifetime | null>(null)

/** Virtual cards inherit the library lifetime, so scrolling is not cancellation. */
export function RequestLifetimeProvider({
  lifetime,
  children,
}: {
  lifetime: Lifetime
  children: ReactNode
}) {
  return createElement(
    RequestLifetimeContext.Provider,
    { value: lifetime },
    children
  )
}

/** Capture its signal when an action starts; never continue an unmounted action. */
export function useRequestLifetime() {
  const inherited = useContext(RequestLifetimeContext)
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    if (lifetime.current.signal.aborted)
      lifetime.current = new AbortController()
    const controller = lifetime.current
    return () => controller.abort()
  }, [])
  return inherited ?? lifetime
}
