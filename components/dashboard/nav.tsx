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
  Users,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

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

  return (
    <nav className="flex items-center w-full">
      <div className="flex items-center">
        <Link href="/dashboard" className="flex items-center space-x-2.5">
          <Icons.logo className="h-6 w-6" />
          <span className="flare-text text-lg">Flare</span>
        </Link>
      </div>

      <div className="flex md:hidden ml-auto pr-4">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetTitle>Navigation</SheetTitle>
            <div className="flex flex-col space-y-3 mt-4">
              {routes.map((route) => (
                <Link
                  key={route.href}
                  href={route.href}
                  onClick={() => setOpen(false)}
                >
                  <Button
                    variant={pathname === route.href ? 'default' : 'ghost'}
                    className="w-full justify-start"
                  >
                    <route.icon className="mr-2 h-4 w-4" />
                    {route.label}
                  </Button>
                </Link>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>

      <div className="hidden md:flex flex-1 justify-center">
        <div className="flex items-center space-x-2">
          {routes.map((route) => (
            <Button
              key={route.href}
              variant={pathname === route.href ? 'default' : 'ghost'}
              className="h-8"
              asChild
            >
              <Link href={route.href}>
                <route.icon className="mr-2 h-4 w-4" />
                {route.label}
              </Link>
            </Button>
          ))}
        </div>
      </div>
    </nav>
  )
}
