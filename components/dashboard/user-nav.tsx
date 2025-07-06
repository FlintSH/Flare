'use client'

import Link from 'next/link'

import { useSession } from 'next-auth/react'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

export function UserNav() {
  const { data: session } = useSession()
  const initials = session?.user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()

  return (
    <Button variant="ghost" className="relative h-8 w-8 rounded-full" asChild>
      <Link href="/dashboard/profile">
        <Avatar className="h-8 w-8">
          <AvatarImage
            src={session?.user?.image || undefined}
            alt={session?.user?.name || ''}
          />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </Link>
    </Button>
  )
}
