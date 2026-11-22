import type { ComponentType, ReactNode } from 'react'

import Link from 'next/link'

import { ArrowUpRight, Camera, SlidersHorizontal, X } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { cn } from '@/lib/utils'

/** Which tips the Upload page shows, before the account hides them. */
export type UploadTipsShown = {
  /** The role can choose upload profiles. */
  profiles: boolean
  /** It can, and the account has none yet. */
  createProfile: boolean
  /** The role can download the screenshot tools. */
  tools: boolean
}

/**
 * What makes uploading automatic, under an empty Upload page: saving choices
 * as a profile, and the tools that upload with them. Hiding it is for good.
 */
export function UploadTips({
  shown,
  onHide,
}: {
  shown: UploadTipsShown
  onHide: () => void
}) {
  const both = shown.createProfile && shown.tools
  return (
    <aside
      aria-label="Upload tips"
      className="relative rounded-xl border bg-muted/20 p-4 pr-12 text-sm"
    >
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-8 w-8 text-muted-foreground"
        aria-label="Hide these tips"
        title="Hide these tips"
        onClick={onHide}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
      <ul className={cn('grid gap-4', both && 'sm:grid-cols-2 sm:gap-8')}>
        {shown.createProfile && (
          <UploadTip
            icon={SlidersHorizontal}
            title="Upload profiles"
            href="/dashboard/profile?section=uploads#upload-profiles"
            action="Create a profile"
          >
            Save the visibility, expiry, tags and naming you reuse, then pick
            them here in one step.
          </UploadTip>
        )}
        {shown.tools && (
          <UploadTip
            icon={Camera}
            title="Screenshot tools"
            href="/dashboard/profile?section=uploads#upload-tools"
            action="Set up a tool"
          >
            Upload straight from ShareX, iTake, Flameshot, Spectacle or a
            terminal, with your{' '}
            {shown.profiles ? 'default profile' : 'upload settings'} applied.
          </UploadTip>
        )}
      </ul>
    </aside>
  )
}

function UploadTip({
  icon: Icon,
  title,
  href,
  action,
  children,
}: {
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  title: string
  href: string
  action: string
  children: ReactNode
}) {
  return (
    <li className="flex min-w-0 gap-3">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden
      />
      <div className="min-w-0 space-y-1">
        <h2 className="font-medium">{title}</h2>
        <p className="text-pretty text-muted-foreground">{children}</p>
        <Link
          href={href}
          className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {action}
          <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </li>
  )
}
