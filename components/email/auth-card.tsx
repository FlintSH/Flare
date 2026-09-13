import { AuthShell } from '@/components/auth/auth-shell'

export function EmailAuthCard({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <AuthShell eyebrow="Your account" title={title} description={description}>
      {children}
    </AuthShell>
  )
}
