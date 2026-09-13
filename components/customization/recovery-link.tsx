import type { ReactNode } from 'react'

export function RecoveryLink({
  href,
  className,
  children,
}: {
  href:
    | '/dashboard/customize'
    | '/dashboard/customize?recovery=1'
    | '/dashboard/settings?recovery=1'
    | '/dashboard/settings?section=appearance'
    | '/dashboard/settings?section=appearance&recovery=1'
    | '/dashboard/settings?section=advanced&recovery=1'
  className?: string
  children: ReactNode
}) {
  // A document navigation is intentional: recovery changes server-rendered
  // styles in the root layout, which client-side navigation would preserve.
  return (
    <a href={href} className={className}>
      {children}
    </a>
  )
}
