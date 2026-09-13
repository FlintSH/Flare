'use client'

import { useState } from 'react'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

import {
  ChevronDown,
  FileText,
  FolderOpen,
  LinkIcon,
  Menu,
  Paintbrush,
  Plug,
  Settings,
  SlidersHorizontal,
  Upload,
  Users,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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

const workspaceRoutes = [
  { href: '/dashboard/customize', label: 'Appearance', icon: Paintbrush },
  {
    href: '/dashboard/upload-profiles',
    label: 'Upload profiles',
    icon: SlidersHorizontal,
  },
  { href: '/dashboard/integrations', label: 'Integrations', icon: Plug },
]

export function DashboardNav() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const { data: session } = useSession()

  const routes =
    session?.user?.role === 'ADMIN'
      ? [...baseRoutes, ...adminRoutes]
      : baseRoutes
  const workspaceActive = workspaceRoutes.some(
    (route) => route.href === pathname
  )

  return (
    <nav className="flex items-center w-full">
      <div className="flex items-center">
        <Link href="/dashboard" className="flex items-center space-x-2.5">
          <InstanceBrand />
        </Link>
      </div>

      <div className="flex xl:hidden ml-auto mr-3">
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right">
            <SheetTitle>Navigation</SheetTitle>
            <div className="flex flex-col space-y-3 mt-4">
              {[
                ...baseRoutes,
                ...workspaceRoutes,
                ...(session?.user?.role === 'ADMIN' ? adminRoutes : []),
              ].map((route) => (
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

      <div className="hidden xl:flex flex-1 justify-center">
        <div className="flex items-center space-x-1 bg-muted/20 backdrop-blur-sm rounded-xl p-1 border border-border/30">
          {routes.map((route) => {
            const isActive = pathname === route.href
            return (
              <Button
                key={route.href}
                variant="ghost"
                className={`h-9 px-4 rounded-lg font-medium border transition-all duration-200 ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm border-border/50'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50 border-transparent'
                }`}
                asChild
              >
                <Link href={route.href}>
                  <route.icon
                    className={`mr-2 h-4 w-4 ${isActive ? 'text-primary' : ''}`}
                  />
                  {route.label}
                </Link>
              </Button>
            )
          })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className={`h-9 px-3 rounded-lg ${workspaceActive ? 'bg-background shadow-sm' : 'text-muted-foreground'}`}
              >
                <Paintbrush className="mr-2 h-4 w-4" />
                Workspace
                <ChevronDown className="ml-2 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {workspaceRoutes.map((route) => (
                <DropdownMenuItem key={route.href} asChild>
                  <Link
                    href={route.href}
                    aria-current={pathname === route.href ? 'page' : undefined}
                  >
                    <route.icon className="mr-2 h-4 w-4" />
                    {route.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  )
}
