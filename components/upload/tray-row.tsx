import Image from 'next/image'

import {
  AlertCircle,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  EyeOff,
  File as FileIcon,
  KeyRound,
  Loader2,
  Lock,
  MoreHorizontal,
  RotateCw,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { openFileSheet } from '@/lib/client/file-sheet'
import { allows } from '@/lib/permissions/actions'
import {
  LINK_FORMATS,
  LINK_FORMAT_NAMES,
  type LinkFormat,
} from '@/lib/uploads/link-formats'
import { formatTransfer } from '@/lib/uploads/speed'
import type { TrayFile } from '@/lib/uploads/tray'
import { cn, formatBytes } from '@/lib/utils'

import { usePermissions } from '@/hooks/use-permissions'

/** The link without its scheme, as people read it. */
export const readable = (url: string) => url.replace(/^https?:\/\//, '')

/**
 * One file on the Upload page, from waiting to its link. While it is sent
 * the row itself fills.
 */
export function TrayRow({
  file,
  format,
  copied,
  onCopy,
  onCancel,
  onRetry,
  onRemove,
  onDelete,
  onMakePrivate,
}: {
  file: TrayFile
  format: LinkFormat
  copied: boolean
  onCopy: (format: LinkFormat) => void
  onCancel: () => void
  onRetry: () => void
  onRemove: () => void
  /** Missing when the role can't delete files or the server sent no ID. */
  onDelete?: () => void
  /** Missing unless the file is public and the role can change that. */
  onMakePrivate?: () => void
}) {
  const { status, name, result } = file
  // Its sheet when this account can open it (it reads the library); else
  // the link opens its share page.
  const { user } = usePermissions()
  const sheetId = allows(user, 'viewFiles') ? result?.id : undefined
  const sending = status === 'sending'
  // Every byte is out and the server is storing it: too late to cancel
  // without leaving a file behind, so it finishes.
  const finishing = sending && file.uploaded >= file.size
  const going = status === 'waiting' || status === 'held' || sending

  return (
    <li
      className={cn(
        'relative flex min-h-[4rem] items-center gap-3 overflow-hidden px-3 py-2.5',
        status === 'failed' && 'bg-destructive/5'
      )}
    >
      {sending && (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 left-0 bg-primary/[0.07] transition-[width] duration-300 ease-out motion-reduce:transition-none"
          style={{ width: `${file.progress}%` }}
        />
      )}
      <Thumb file={file} />
      <div className="relative min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {result ? (
            <a
              href={result.link}
              target="_blank"
              rel="noopener noreferrer"
              title={name}
              // Its sheet, where everything about it can change; a modified
              // click opens its page instead.
              onClick={(event) => {
                if (
                  !sheetId ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                )
                  return
                event.preventDefault()
                openFileSheet(sheetId)
              }}
              className="truncate rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {name}
            </a>
          ) : (
            <p className="truncate text-sm font-medium" title={name}>
              {name}
            </p>
          )}
          <Badges file={file} />
        </div>
        {status === 'failed' ? (
          <p className="mt-0.5 flex items-start gap-1.5 text-xs text-destructive">
            <AlertCircle
              className="mt-px h-3.5 w-3.5 shrink-0"
              aria-hidden="true"
            />
            {file.reason}
          </p>
        ) : result ? (
          <p
            className="mt-0.5 truncate font-mono text-xs text-muted-foreground"
            title={result.link}
          >
            {readable(result.link)}
          </p>
        ) : (
          <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
            {finishing
              ? 'Finishing…'
              : sending
                ? formatTransfer(file.uploaded, file.size, file.speed)
                : `${formatBytes(file.size)} · waiting`}
          </p>
        )}
        {sending && (
          <span
            role="progressbar"
            aria-label={`Upload progress for ${name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={file.progress}
            className="sr-only"
          />
        )}
      </div>

      <div className="relative flex shrink-0 items-center gap-1">
        {going && (
          <>
            {sending && (
              <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">
                {file.progress}%
              </span>
            )}
            {finishing ? (
              <span className="flex h-8 w-8 items-center justify-center">
                <Loader2
                  className="h-4 w-4 animate-spin text-muted-foreground"
                  aria-hidden="true"
                />
              </span>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                aria-label={`Cancel ${name}`}
                title="Cancel"
                onClick={onCancel}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
        {status === 'failed' && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label={`Remove ${name}`}
              title="Remove"
              onClick={onRemove}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </>
        )}
        {result && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Copy ${LINK_FORMAT_NAMES[format].toLowerCase()} for ${name}`}
              onClick={() => onCopy(format)}
              className="gap-1.5"
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {copied ? 'Copied' : 'Copy'}
              </span>
            </Button>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 data-[state=open]:bg-accent"
                  aria-label={`More for ${name}`}
                >
                  <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {/* What it was uploaded as, readable on touch too. */}
                {file.outcome && (
                  <>
                    <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                      {describe(file.outcome)}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem asChild>
                  <a
                    href={result.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                    Open
                  </a>
                </DropdownMenuItem>
                {LINK_FORMATS.filter((choice) => choice !== format).map(
                  (choice) => (
                    <DropdownMenuItem
                      key={choice}
                      onSelect={() => onCopy(choice)}
                    >
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      Copy {LINK_FORMAT_NAMES[choice].toLowerCase()}
                    </DropdownMenuItem>
                  )
                )}
                {onMakePrivate && (
                  <DropdownMenuItem onSelect={onMakePrivate}>
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                    Make private
                  </DropdownMenuItem>
                )}
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={onDelete}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      Delete…
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>
    </li>
  )
}

/** What the file was uploaded as, when that's more than public for good. */
function Badges({ file }: { file: TrayFile }) {
  const outcome = file.outcome
  if (!outcome) return null
  const badges = [
    outcome.visibility === 'PRIVATE' && { icon: Lock, label: 'Private' },
    outcome.password && { icon: KeyRound, label: 'Password' },
    outcome.expires && { icon: Clock, label: outcome.expires },
  ].filter((badge) => !!badge)
  if (!badges.length) return null
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {badges.map(({ icon: Icon, label }) => (
        <span key={label} title={label} className="inline-flex">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      ))}
    </span>
  )
}

/** "Public · never expires", "Private · deleted after 1 day · password". */
function describe(outcome: NonNullable<TrayFile['outcome']>) {
  return [
    outcome.visibility === 'PUBLIC' ? 'Public' : 'Private',
    outcome.expires ?? 'Never expires',
    ...(outcome.password ? ['Password'] : []),
    ...(outcome.folder ? [outcome.folder.name] : []),
  ].join(' · ')
}

function Thumb({ file }: { file: TrayFile }) {
  const done = file.status === 'done'
  return (
    <div className="relative h-10 w-10 shrink-0">
      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-md bg-muted">
        {file.preview ? (
          <Image
            src={file.preview}
            alt=""
            width={40}
            height={40}
            unoptimized
            className={cn(
              'h-10 w-10 object-cover transition-opacity motion-reduce:transition-none',
              !done && 'opacity-60'
            )}
          />
        ) : (
          <FileIcon
            className="h-5 w-5 text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      {done && (
        <span className="absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
          <Check className="h-2.5 w-2.5" strokeWidth={3} aria-hidden="true" />
          <span className="sr-only">Uploaded</span>
        </span>
      )}
    </div>
  )
}
