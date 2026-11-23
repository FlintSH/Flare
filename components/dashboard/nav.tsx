'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { ChevronDown, LogOut, Menu, Search, Wrench, X } from 'lucide-react'
import { useSession } from 'next-auth/react'

import { InstanceBrand } from '@/components/customization/instance-brand'
import { TagManager } from '@/components/dashboard/library-dialogs'
import { onDemand } from '@/components/shared/on-demand'
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
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'

import { libraryHref } from '@/lib/library/contract'
import type { InstanceFeatures } from '@/lib/navigation/places'
import { cn } from '@/lib/utils'

import { useSignOut } from '@/hooks/use-sign-out'

import {
  type AdminNavigationItem,
  type NavigationItem,
  PROFILE_ITEM,
  dashboardHome,
  dashboardNavigation,
  isCurrentPage,
} from './navigation'

const pillClassName =
  'h-9 gap-2 rounded-lg border border-transparent px-3.5 text-sm font-medium text-muted-foreground hover:bg-background/60 hover:text-foreground'
const activePillClassName =
  'border-border bg-background text-foreground shadow-sm dark:border-border/60'

/**
 * Menus that open from the bar, aligned to their button's end. The offset is
 * the bar's padding below an h-9 control (14px) plus a 6px gap, so the menu
 * opens just below the bar's edge.
 */
export const barMenuProps = {
  align: 'end',
  sideOffset: 20,
  loop: true,
  className: 'w-64 p-1.5',
  // Closing hands focus back to the button, which shows its focus ring even
  // after a mouse choice. Keep that for keyboard use only (data-input comes
  // from components/providers/input-modality.tsx).
  onCloseAutoFocus: (event: Event) => {
    if (document.documentElement.dataset.input === 'pointer')
      event.preventDefault()
  },
} as const

export const barMenuItemClassName =
  'cursor-pointer gap-3 rounded-lg px-2.5 py-2'
const sheetItemClassName =
  'h-10 w-full justify-start gap-2 rounded-lg border border-transparent text-muted-foreground hover:text-foreground'
const sheetHeadingClassName =
  'mb-2 px-4 text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground'

function NavPill({
  item,
  pathname,
}: {
  item: NavigationItem
  pathname: string | null
}) {
  const isActive = isCurrentPage(pathname, item.href)
  return (
    <Button
      variant="ghost"
      className={cn(pillClassName, isActive && activePillClassName)}
      asChild
    >
      <Link href={item.href} aria-current={isActive ? 'page' : undefined}>
        <item.icon
          className={cn('h-4 w-4', isActive && 'text-primary')}
          aria-hidden="true"
        />
        {item.label}
      </Link>
    </Button>
  )
}

/** One place in the bar for every administration page this person can open. */
function AdminMenu({
  items,
  pathname,
}: {
  items: readonly AdminNavigationItem[]
  pathname: string | null
}) {
  const inside = items.some((item) => isCurrentPage(pathname, item.href))
  const hintId = useId()
  return (
    // Not modal, so one click on another place in the bar closes the menu
    // and opens that place.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          aria-current={inside ? 'true' : undefined}
          className={cn(
            pillClassName,
            'group pr-2.5 data-[state=open]:text-foreground',
            // Open reads as engaged, not as the raised current page.
            inside
              ? activePillClassName
              : 'data-[state=open]:bg-foreground/[0.06]'
          )}
        >
          <Wrench
            className={cn('h-4 w-4', inside && 'text-primary')}
            aria-hidden="true"
          />
          Admin
          <ChevronDown
            className="!-ml-1 !size-3.5 opacity-60 transition-transform duration-200 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent {...barMenuProps}>
        {items.map((item, index) => {
          const isActive = isCurrentPage(pathname, item.href)
          return (
            <DropdownMenuItem
              key={item.href}
              asChild
              className={barMenuItemClassName}
            >
              {/* The label names the item; the hint is read as its
                  description rather than as part of the name. */}
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                aria-describedby={`${hintId}-${index}`}
              >
                {/* The current page's tile is raised like its pill would be. */}
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border/60 bg-background/60 text-muted-foreground',
                    isActive &&
                      'border-border bg-background text-primary shadow-sm'
                  )}
                >
                  <item.icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-foreground">
                    {item.label}
                  </span>
                  <span
                    id={`${hintId}-${index}`}
                    aria-hidden="true"
                    className="truncate text-xs text-muted-foreground"
                  >
                    {item.hint}
                  </span>
                </span>
              </Link>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SheetLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly NavigationItem[]
  pathname: string | null
  onNavigate: () => void
}) {
  return items.map((item) => {
    const isActive = isCurrentPage(pathname, item.href)
    return (
      <Button
        key={item.href}
        variant="ghost"
        asChild
        className={cn(
          sheetItemClassName,
          isActive && 'border-border/60 bg-accent text-accent-foreground'
        )}
      >
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={isActive ? 'page' : undefined}
        >
          <item.icon
            className={cn('h-4 w-4', isActive && 'text-primary')}
            aria-hidden="true"
          />
          {item.label}
        </Link>
      </Button>
    )
  })
}

const FindCommand = onDemand(() =>
  import('@/components/find/find-command').then((module) => module.FindCommand)
)

/** ⌘K on Apple keyboards, Ctrl K elsewhere. */
function useShortcutLabel() {
  const [label, setLabel] = useState('Ctrl K')
  useEffect(() => {
    if (/Mac|iPhone|iPad/.test(navigator.userAgent)) setLabel('⌘K')
  }, [])
  return label
}

export function DashboardNav({ features }: { features: InstanceFeatures }) {
  const pathname = usePathname()
  // On Files the bar is the library's search, and shows what it's searching.
  const params = useSearchParams()
  const librarySearch =
    pathname === libraryHref() ? (params.get('search') ?? '') : ''
  const router = useRouter()
  const clearLibrarySearch = () => {
    const next = new URLSearchParams(params.toString())
    next.delete('search')
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    })
  }
  // Find takes the place of the pills: the bar becomes where you type.
  const [finding, setFinding] = useState<'bar' | 'screen' | null>(null)
  const [managingTags, setManagingTags] = useState(false)
  const shortcut = useShortcutLabel()
  const findButton = useRef<HTMLButtonElement>(null)
  const startFinding = (layout: 'bar' | 'screen') =>
    FindCommand.show(() => setFinding(layout))
  const phoneFindButton = useRef<HTMLButtonElement>(null)
  // Focus goes back to the Find button you can see, unless Find closed
  // because you went somewhere or clicked something else.
  const stopFinding = useCallback((restoreFocus = true) => {
    setFinding(null)
    if (!restoreFocus) return
    requestAnimationFrame(() =>
      (findButton.current?.offsetParent
        ? findButton.current
        : phoneFindButton.current
      )?.focus()
    )
  }, [])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() !== 'k' ||
        !(event.metaKey || event.ctrlKey) ||
        event.altKey ||
        event.shiftKey ||
        event.isComposing ||
        // An editor that uses the keys itself (Paste's code editor) keeps them.
        event.defaultPrevented
      )
        return
      // A sheet or dialog has the page; Find waits until it's closed.
      event.preventDefault()
      if (
        !finding &&
        document.querySelector('[role="dialog"], [role="alertdialog"]')
      )
        return
      if (finding) stopFinding()
      else
        // The bar when its track is on screen (its width depends on how many
        // places the account has), full screen otherwise.
        startFinding(findButton.current?.offsetParent ? 'bar' : 'screen')
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const [open, setOpen] = useState(false)
  const { data: session, status } = useSession()
  const signOut = useSignOut()
  const { workspace, admin } = dashboardNavigation(session?.user)
  const close = () => setOpen(false)
  const headingId = useId()
  // However many pages it holds, administration takes one place in the bar.
  const places = workspace.length + Math.min(admin.length, 1)
  // Four places fit beside the brand from tablet width; more need 900px.
  const roomy = places <= 4
  // Keep the menu button in place while the session loads, so it doesn't
  // pop in on phones once permissions arrive.
  const showMenuButton = places > 0 || status === 'loading'

  return (
    <nav
      aria-label="Main navigation"
      className="flex min-w-0 flex-1 items-center gap-4"
    >
      <Link
        href={dashboardHome(session?.user)}
        aria-label="Go to your dashboard"
        className="flex min-w-0 max-w-[180px] shrink items-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background xl:max-w-[220px]"
      >
        <InstanceBrand iconClassName="h-6 w-6 text-primary" />
      </Link>

      {/* An account with no pages in the bar (profile only) still has
          Find, for its settings: its own button, full screen. */}
      {!showMenuButton && (
        <Button
          ref={phoneFindButton}
          variant="ghost"
          size="icon"
          className="ml-auto"
          aria-label="Find"
          aria-haspopup="dialog"
          onPointerEnter={FindCommand.preload}
          onClick={() => startFinding('screen')}
        >
          <Search className="h-5 w-5" />
        </Button>
      )}
      {showMenuButton && (
        <div
          className={cn(
            'ml-auto flex items-center gap-2',
            roomy ? 'md:hidden' : 'min-[900px]:hidden'
          )}
        >
          <Button
            variant="ghost"
            size="icon"
            ref={phoneFindButton}
            aria-label="Find"
            aria-haspopup="dialog"
            onPointerEnter={FindCommand.preload}
            onClick={() => startFinding('screen')}
          >
            <Search className="h-5 w-5" />
          </Button>
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Open navigation">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="overflow-y-auto">
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription className="sr-only">
                Navigate your files and tools, your account, and this
                instance&apos;s administration.
              </SheetDescription>
              <div className="mt-4 space-y-6">
                {workspace.length > 0 && (
                  <div className="space-y-1">
                    <SheetLinks
                      items={workspace}
                      pathname={pathname}
                      onNavigate={close}
                    />
                  </div>
                )}
                {admin.length > 0 && (
                  <section
                    aria-labelledby={`${headingId}-admin`}
                    className="space-y-1"
                  >
                    <h3
                      id={`${headingId}-admin`}
                      className={sheetHeadingClassName}
                    >
                      Admin
                    </h3>
                    <SheetLinks
                      items={admin}
                      pathname={pathname}
                      onNavigate={close}
                    />
                  </section>
                )}
                {/* The avatar's menu, repeated so the sheet lists everything. */}
                <section
                  aria-labelledby={`${headingId}-account`}
                  className="space-y-1"
                >
                  <h3
                    id={`${headingId}-account`}
                    className={sheetHeadingClassName}
                  >
                    Account
                  </h3>
                  <SheetLinks
                    items={[PROFILE_ITEM]}
                    pathname={pathname}
                    onNavigate={close}
                  />
                  <Button
                    variant="ghost"
                    className={sheetItemClassName}
                    onClick={signOut}
                  >
                    <LogOut className="h-4 w-4" aria-hidden="true" />
                    Sign out
                  </Button>
                </section>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      )}

      {places > 0 && (
        <div
          className={cn(
            'hidden min-w-0 flex-1 justify-center',
            roomy ? 'md:flex' : 'min-[900px]:flex'
          )}
        >
          {/* In light mode the track is a step darker, so the raised white
              pill of the current page stands out from it. */}
          <div
            className={cn(
              'flex items-center gap-1 rounded-xl border border-border/40 bg-muted/60 p-1 transition-[width] duration-200 dark:bg-muted/25 motion-reduce:transition-none',
              finding === 'bar' && 'w-[min(40rem,100%)]'
            )}
          >
            {finding === 'bar' ? (
              <FindCommand
                layout="bar"
                onClose={stopFinding}
                features={features}
                onManageTags={() =>
                  TagManager.show(() => setManagingTags(true))
                }
              />
            ) : (
              <>
                {workspace.map((item) => (
                  <NavPill key={item.href} item={item} pathname={pathname} />
                ))}
                {workspace.length > 0 && admin.length > 0 && (
                  <span
                    aria-hidden="true"
                    className="mx-1 h-5 w-px bg-border"
                  />
                )}
                {admin.length === 1 ? (
                  <NavPill item={admin[0]} pathname={pathname} />
                ) : (
                  admin.length > 1 && (
                    <AdminMenu items={admin} pathname={pathname} />
                  )
                )}
                <Button
                  ref={findButton}
                  variant="ghost"
                  // Its name includes the search it shows.
                  aria-label={librarySearch ? `Find: ${librarySearch}` : 'Find'}
                  aria-keyshortcuts="Meta+K Control+K"
                  aria-haspopup="listbox"
                  title={`Find (${shortcut})`}
                  onPointerEnter={FindCommand.preload}
                  onFocus={FindCommand.preload}
                  onClick={() => startFinding('bar')}
                  className={cn(
                    pillClassName,
                    // A search is a state of the page, not another page, so
                    // it isn't raised like the current one.
                    librarySearch
                      ? 'max-w-40 pl-2.5 pr-1 text-foreground'
                      : 'w-9 px-0'
                  )}
                >
                  <Search
                    className={cn('h-4 w-4', librarySearch && 'text-primary')}
                    aria-hidden="true"
                  />
                  {librarySearch && (
                    <span className="truncate">{librarySearch}</span>
                  )}
                </Button>
                {librarySearch && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Clear the search for ${librarySearch}`}
                    title="Clear search"
                    onClick={() => {
                      clearLibrarySearch()
                      // This button goes with the search; focus stays here.
                      requestAnimationFrame(() => findButton.current?.focus())
                    }}
                    className="-ml-1 h-9 w-7 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {finding === 'screen' && (
        <FindCommand
          layout="screen"
          onClose={stopFinding}
          features={features}
          onManageTags={() => TagManager.show(() => setManagingTags(true))}
        />
      )}
      {managingTags && (
        <TagManager
          open={managingTags}
          onOpenChange={setManagingTags}
          // Files filtered by a tag that's gone would show nothing.
          onDeleted={(id) => {
            if (pathname !== libraryHref() || params.get('tag') !== id) return
            const next = new URLSearchParams(params)
            next.delete('tag')
            const kept = next.toString()
            router.replace(kept ? `${pathname}?${kept}` : pathname)
          }}
        />
      )}
    </nav>
  )
}
