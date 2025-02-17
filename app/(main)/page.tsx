import { redirect } from 'next/navigation'

import { getServerSession } from 'next-auth/next'

import { authOptions } from '@/lib/auth'

export default async function HomePage() {
  const session = await getServerSession(authOptions)

  // just redirect to dashboard if already authed
  if (!session?.user) {
    redirect('/auth/login')
  }

  redirect('/dashboard')
}
