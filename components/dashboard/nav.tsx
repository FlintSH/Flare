'use client'

import { useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  FileText,
  FolderOpen,
  LinkIcon,
  Menu,
  Settings,
  Shield,
  Upload,
  UserRound,
  Users,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { type Permission, hasPermission } from '@/lib/permissions/catalog'
import { cn } from '@/lib/utils'

const baseRoutes = [
  {
    href: '/dashboard',
    label: 'Files',
    icon: FolderOpen,
    permission: 'files.read',
  },
  {
    href: '/dashboard/upload',
    label: 'Upload',
    icon: Upload,
    permission: 'files.upload',
  },
  {
    href: '/dashboard/paste',
    label: 'Paste',
    icon: FileText,
    permission: 'pastes.create',
  },
  {
    href: '/dashboard/urls',
    label: 'Links',
    icon: LinkIcon,
    permission: 'links.read',
  },
  {
    href: '/dashboard/profile',
    label: 'Profile',
    icon: UserRound,
    permission: null,
  },
]

const managementRoutes = [
  {
    href: '/dashboard/roles',
    label: 'Roles',
    icon: Shield,
    permission: 'roles.manage',
  },
  {
    href: '/dashboard/users',
    label: 'Users',
    icon: Users,
    permission: 'users.read',
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
    permission: 'settings.read',
  },
]

export function DashboardNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { data: session } = useSession()

  const routes = [...baseRoutes, ...managementRoutes].filter(
    (route) =>
      !route.permission ||
      (hasPermission(session?.user, route.permission as Permission) &&
        (route.permission !== 'pastes.create' ||
          hasPermission(session?.user, 'files.upload')))
  )

  return (
    <nav
      aria-label="Main navigation"
      className="flex min-w-0 flex-1 items-center gap-4"
    >
      <Link
        href={
          hasPermission(session?.user, 'files.read')
            ? '/dashboard'
            : '/dashboard/profile'
        }
        aria-label="Go to your dashboard"
        className="flex min-w-0 max-w-[180px] shrink items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:max-w-[220px]"
      >
        <InstanceBrand iconClassName="h-6 w-6 text-primary" />
      </Link>

      <div className="ml-auto flex items-center gap-2 xl:hidden">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="overflow-y-auto">
            <SheetTitle>Navigation</SheetTitle>
            <SheetDescription className="sr-only">
              Navigate your files, tools, and preferences.
            </SheetDescription>
            <div className="mt-4 space-y-1">
              {routes.map((route) => (
                <Button
                  key={route.href}
                  variant={pathname === route.href ? 'default' : 'ghost'}
                  asChild
                  className="h-10 w-full justify-start gap-2 rounded-lg"
                >
                  <Link
                    href={route.href}
                    onClick={() => setOpen(false)}
                    aria-current={pathname === route.href ? 'page' : undefined}
                  >
                    <route.icon className="h-4 w-4" aria-hidden="true" />
                    {route.label}
                  </Link>
                </Button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden min-w-0 flex-1 justify-center xl:flex">
        <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/25 p-1">
          {routes.map((route) => {
            const isActive = pathname === route.href
            return (
              <Button
                key={route.href}
                variant="ghost"
                className={cn(
                  'h-9 gap-2 rounded-lg border border-transparent px-3.5 text-sm font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground',
                  isActive &&
                    'border-border/60 bg-background text-foreground shadow-sm'
                )}
                asChild
              >
                <Link
                  href={route.href}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <route.icon
                    className={cn('h-4 w-4', isActive && 'text-primary')}
                    aria-hidden="true"
                  />
                  {route.label}
                </Link>
              </Button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
