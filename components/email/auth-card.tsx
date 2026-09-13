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
    <AuthShell title={title} description={description}>
      {children}
    </AuthShell>
  )
}
