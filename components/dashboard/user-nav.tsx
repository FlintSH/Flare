'use client'

import { useId } from 'react'

import { usePathname } from 'next/navigation'

import { LogOut } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { GuardedLink } from '@/components/navigation/guarded-link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { cn } from '@/lib/utils'

import { useGuardedSignOut } from '@/hooks/use-draft-leave'

import { barMenuItemClassName, barMenuProps } from './nav'
import { PROFILE_ITEM, isCurrentPage } from './navigation'

/** The account menu: who is signed in, their profile, and signing out. */
export function UserNav() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const signOut = useGuardedSignOut()
  const user = session?.user
  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  const onProfile = isCurrentPage(pathname, PROFILE_ITEM.href)
  const accountId = useId()

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Account menu"
          aria-current={onProfile ? 'true' : undefined}
          className={cn(
            'relative h-[36px] w-[36px] rounded-full p-0 ring-offset-2 ring-offset-background focus-visible:ring-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
            // Profile has no place in the bar, so the avatar marks it instead,
            // separate from the outer keyboard outline so focus stays distinct.
            onProfile
              ? 'ring-1 ring-foreground/40'
              : 'data-[state=open]:ring-2 data-[state=open]:ring-border'
          )}
        >
          <Avatar className="h-[36px] w-[36px]">
            <AvatarImage src={user?.image || undefined} alt="" />
            {/* The edge keeps light initials from melting into a light bar. */}
            <AvatarFallback className="border border-border text-[14px]">
              {initials || 'F'}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      {/* Named after the account, so screen readers hear who is signed in. */}
      <DropdownMenuContent {...barMenuProps} aria-labelledby={accountId}>
        <DropdownMenuLabel
          id={accountId}
          className="flex flex-col px-2.5 py-2 font-normal"
        >
          <span
            className="truncate text-sm font-medium text-foreground"
            title={user?.name}
          >
            {user?.name}
          </span>
          <span
            className="truncate text-xs text-muted-foreground"
            title={user?.email}
          >
            {user?.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="-mx-1.5" />
        <DropdownMenuItem asChild className={barMenuItemClassName}>
          <GuardedLink
            href={PROFILE_ITEM.href}
            aria-current={onProfile ? 'page' : undefined}
          >
            <PROFILE_ITEM.icon
              className={cn(
                'text-muted-foreground',
                onProfile && 'text-primary'
              )}
              aria-hidden="true"
            />
            {PROFILE_ITEM.label}
          </GuardedLink>
        </DropdownMenuItem>
        <DropdownMenuSeparator className="-mx-1.5" />
        <DropdownMenuItem onSelect={signOut} className={barMenuItemClassName}>
          <LogOut className="text-muted-foreground" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
