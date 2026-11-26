import Link from 'next/link'

import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'

/** Which tips the Upload page shows, before the account hides them. */
export type UploadTipsShown = {
  /** The role can choose upload profiles and the account has none yet. */
  createProfile: boolean
  /** The role can download the screenshot tools. */
  tools: boolean
}

const linkClassName =
  'rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

/**
 * What makes uploading automatic, at the foot of an empty Upload page: the
 * screenshot tools and saving choices as a profile. Hiding it is for good.
 * Not on phones, where the tools don't run.
 */
export function UploadTips({
  shown,
  onHide,
}: {
  shown: UploadTipsShown
  onHide: () => void
}) {
  return (
    <aside
      aria-label="Upload tips"
      className="mt-8 flex max-w-xl items-center gap-1 text-pretty text-xs text-muted-foreground max-sm:hidden"
    >
      <p>
        {shown.tools && (
          <>
            Upload from ShareX, Flameshot and other tools:{' '}
            <Link
              href="/dashboard/profile?section=uploads#upload-tools"
              className={linkClassName}
            >
              set one up
            </Link>
            {shown.createProfile ? '. ' : '.'}
          </>
        )}
        {shown.createProfile && (
          <>
            Save settings you reuse{' '}
            <Link
              href="/dashboard/profile?section=uploads#upload-profiles"
              className={linkClassName}
            >
              as a profile
            </Link>
            .
          </>
        )}
      </p>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        aria-label="Hide these tips"
        title="Hide these tips"
        onClick={onHide}
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </aside>
  )
}
