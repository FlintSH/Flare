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

import { cn } from '@/lib/utils'

const baseRoutes = [
  {
    href: '/dashboard',
    label: 'Files',
    icon: FolderOpen,
  },
  {
    href: '/dashboard/upload',
    label: 'Upload',
    icon: Upload,
  },
  {
    href: '/dashboard/paste',
    label: 'Paste',
    icon: FileText,
  },
  {
    href: '/dashboard/urls',
    label: 'Links',
    icon: LinkIcon,
  },
  {
    href: '/dashboard/profile',
    label: 'Profile',
    icon: UserRound,
  },
]

const adminRoutes = [
  {
    href: '/dashboard/users',
    label: 'Users',
    icon: Users,
  },
  {
    href: '/dashboard/settings',
    label: 'Settings',
    icon: Settings,
  },
]

export function DashboardNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { data: session } = useSession()

  const routes =
    session?.user?.role === 'ADMIN'
      ? [...baseRoutes, ...adminRoutes]
      : baseRoutes

  const activeRoute = routes.find((route) => route.href === pathname)

  return (
    <nav
      aria-label="Main navigation"
      className="flex min-w-0 flex-1 items-center gap-4"
    >
      <Link
        href="/dashboard"
        aria-label="Go to your files"
        className="flex min-w-0 max-w-[180px] shrink items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:max-w-[220px]"
      >
        <InstanceBrand iconClassName="h-6 w-6 text-primary" />
      </Link>

      <div className="ml-auto flex items-center gap-2 xl:hidden">
        <span className="hidden text-sm text-muted-foreground sm:inline">
          {activeRoute?.label}
        </span>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="overflow-y-auto">
            <SheetTitle className="flex items-center gap-2">
              <InstanceBrand />
            </SheetTitle>
            <SheetDescription className="mt-3">
              Your files, tools, and preferences.
            </SheetDescription>
            <div className="mt-8 space-y-6">
              {[
                { label: 'Workspace', items: baseRoutes.slice(0, 4) },
                { label: 'Account', items: baseRoutes.slice(4) },
                ...(session?.user?.role === 'ADMIN'
                  ? [{ label: 'Administration', items: adminRoutes }]
                  : []),
              ].map((group) => (
                <div key={group.label}>
                  <p className="mb-2 px-3 text-[10px] font-medium uppercase tracking-[.18em] text-muted-foreground">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((route) => (
                      <Button
                        key={route.href}
                        variant="ghost"
                        asChild
                        className={cn(
                          'h-12 w-full justify-start gap-3 rounded-xl',
                          pathname === route.href &&
                            'bg-primary/10 text-foreground'
                        )}
                      >
                        <Link
                          href={route.href}
                          onClick={() => setOpen(false)}
                          aria-current={
                            pathname === route.href ? 'page' : undefined
                          }
                        >
                          <route.icon className="h-4 w-4" aria-hidden="true" />
                          {route.label}
                        </Link>
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden min-w-0 flex-1 justify-center xl:flex">
        <div className="flex items-center gap-1">
          {routes.map((route) => {
            const isActive = pathname === route.href
            return (
              <Button
                key={route.href}
                variant="ghost"
                className={cn(
                  'h-10 gap-2 rounded-xl px-3.5 text-sm font-medium text-muted-foreground',
                  isActive && 'bg-muted text-foreground'
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
