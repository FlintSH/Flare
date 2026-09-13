import { redirect } from 'next/navigation'

import { getPageSession } from '@/lib/auth/page-session'
import { prisma } from '@/lib/database/prisma'

export default async function CustomizePage({
  searchParams,
}: {
  searchParams: Promise<{ recovery?: string }>
}) {
  const session = await getPageSession()
  if (!session?.user) redirect('/auth/login')
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  })
  if (!user) redirect('/auth/login')
  if (user.role !== 'ADMIN') redirect('/dashboard/profile?section=appearance')

  const { recovery } = await searchParams
  redirect(
    `/dashboard/settings?section=appearance${recovery === '1' ? '&recovery=1' : ''}`
  )
}
