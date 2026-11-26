import { type ComponentPropsWithoutRef, forwardRef } from 'react'

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

/** The part of a link people tell apart: its last segment. */
const endingOf = (url: string) => {
  let path = url.replace(/^https?:\/\/[^/]+/, '')
  try {
    path = decodeURI(new URL(url).pathname)
  } catch {
    /* Shown as sent. */
  }
  return path.split('/').filter(Boolean).pop() ?? path
}

const extension = (name: string) => {
  const dot = name.lastIndexOf('.')
  return dot > 0 && dot < name.length - 1
    ? name
        .slice(dot + 1)
        .toUpperCase()
        .slice(0, 5)
    : null
}

/**
 * A button over the picture: small to look at, with a larger target around
 * it, so it covers little of the picture on a phone.
 */
const OverlayButton = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'> & { icon: typeof X }
>(function OverlayButton({ icon: Icon, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      className={cn(
        'group/overlay -m-1.5 flex h-10 w-10 items-center justify-center rounded-full outline-none',
        className
      )}
      {...props}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border/40 bg-background/85 shadow-sm backdrop-blur-sm transition-colors group-hover/overlay:bg-background group-focus-visible/overlay:ring-2 group-focus-visible/overlay:ring-ring group-data-[state=open]/overlay:bg-accent motion-reduce:transition-none">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
    </button>
  )
})

/**
 * A link's ending, cut at its start, so the suffix that tells two apart and
 * the extension stay in view.
 */
function EndFirst({ text }: { text: string }) {
  return (
    <span className="min-w-0 truncate [direction:rtl]">
      <bdi dir="ltr">{text}</bdi>
    </span>
  )
}

/** Over the picture, in the same style as the library's cards. */
const overlayChip =
  'inline-flex h-6 items-center gap-1 rounded-md border border-border/40 bg-background/90 px-1.5 text-[11px] font-medium tracking-normal tabular-nums backdrop-blur-sm'

/**
 * One file on the Upload page, as a card like the library's: its picture,
 * then its name and link. While it is sent a bar runs along the picture.
 */
export function TrayTile({
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
  const { user } = usePermissions()
  const sheetId = allows(user, 'viewFiles') ? result?.id : undefined
  const sending = status === 'sending'
  const finishing = sending && file.uploaded >= file.size
  const going = status === 'waiting' || status === 'held' || sending
  const failed = status === 'failed'
  const ext = extension(name)

  return (
    <li
      className={cn(
        'relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-shadow motion-reduce:transition-none',
        failed && 'border-destructive/60',
        copied && 'ring-2 ring-primary/50'
      )}
    >
      <div className="relative aspect-[4/3] shrink-0 overflow-hidden bg-muted/60">
        {file.preview ? (
          <Image
            src={file.preview}
            alt=""
            fill
            unoptimized
            sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
            className={cn(
              'object-cover transition-opacity motion-reduce:transition-none',
              !result && (sending ? 'opacity-70' : 'opacity-40')
            )}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2">
            <FileIcon
              className="h-9 w-9 text-muted-foreground"
              aria-hidden="true"
            />
            {ext && (
              <span className="rounded-md border border-border bg-background/60 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                {ext}
              </span>
            )}
          </div>
        )}

        {/* Top right: cancel while it goes, the file's menu once it's in. */}
        <div className="absolute right-2 top-2 flex gap-2">
          {going &&
            (finishing ? (
              <span className={overlayChip}>
                <Loader2
                  className="h-3.5 w-3.5 animate-spin"
                  aria-hidden="true"
                />
              </span>
            ) : (
              <OverlayButton
                icon={X}
                aria-label={`Cancel ${name}`}
                title="Cancel"
                onClick={onCancel}
              />
            ))}
          {failed && (
            <OverlayButton
              icon={X}
              aria-label={`Remove ${name}`}
              title="Remove from the list"
              onClick={onRemove}
            />
          )}
          {result && (
            <FileMenu
              file={file}
              format={format}
              onCopy={onCopy}
              onDelete={onDelete}
              onMakePrivate={onMakePrivate}
            />
          )}
        </div>

        {/* Bottom left: how far along, or what it went up as. */}
        <div className="pointer-events-none absolute bottom-2 left-2 flex gap-1">
          {sending && !finishing && (
            <span className={overlayChip}>{file.progress}%</span>
          )}
          {status === 'held' && (
            <span className={cn(overlayChip, 'text-muted-foreground')}>
              Not uploaded yet
            </span>
          )}
          {result && <Badges file={file} />}
        </div>

        {sending && (
          <>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-1 bg-background/60"
            />
            <span
              aria-hidden="true"
              className="absolute bottom-0 left-0 h-1 bg-primary transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: `${file.progress}%` }}
            />
            <span
              role="progressbar"
              aria-label={`Upload progress for ${name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={file.progress}
              className="sr-only"
            />
          </>
        )}
      </div>

      <div className="flex min-h-[3.75rem] flex-1 flex-col border-t border-border/40 px-2.5 py-2 sm:px-3">
        {result ? (
          <a
            href={result.link}
            target="_blank"
            rel="noopener noreferrer"
            title={name}
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

        {failed ? (
          <div className="mt-1 flex flex-col items-start gap-1.5">
            <p
              className="flex min-w-0 max-w-full items-start gap-1 text-xs leading-snug text-destructive"
              title={file.reason}
            >
              <AlertCircle
                className="mt-px h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              <Reason text={file.reason ?? ''} />
            </p>
            {/* Not for a refusal of its type or size: sending it again
                would only be refused again. */}
            {!file.final && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2"
                onClick={onRetry}
              >
                <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </Button>
            )}
          </div>
        ) : result ? (
          <div className="mt-0.5 flex min-w-0 items-center gap-1">
            <p
              className="flex min-w-0 flex-1 text-xs text-muted-foreground"
              title={result.link}
            >
              <EndFirst text={endingOf(result.link)} />
            </p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="-my-1 -mr-1 h-7 w-7 shrink-0"
              aria-label={`Copy ${LINK_FORMAT_NAMES[format].toLowerCase()} for ${name}`}
              title={copied ? 'Copied' : 'Copy'}
              onClick={() => onCopy(format)}
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        ) : (
          <p className="mt-0.5 truncate text-xs tabular-nums text-muted-foreground">
            {finishing
              ? 'Finishing…'
              : sending
                ? // The speed is said once, in the line above the cards.
                  formatTransfer(file.uploaded, file.size, null)
                : status === 'waiting'
                  ? `${formatBytes(file.size)} · waiting`
                  : formatBytes(file.size)}
          </p>
        )}
      </div>
    </li>
  )
}

/**
 * Why a file failed: the cause in red, any technical detail after its colon
 * quieter, so the file's name still leads its card.
 */
function Reason({ text }: { text: string }) {
  const colon = text.indexOf(': ')
  if (colon < 1) return <span className="min-w-0 break-words">{text}</span>
  return (
    <span className="min-w-0 break-words">
      {text.slice(0, colon + 1)}
      <span className="line-clamp-2 text-muted-foreground">
        {text.slice(colon + 2)}
      </span>
    </span>
  )
}

function FileMenu({
  file,
  format,
  onCopy,
  onDelete,
  onMakePrivate,
}: {
  file: TrayFile
  format: LinkFormat
  onCopy: (format: LinkFormat) => void
  onDelete?: () => void
  onMakePrivate?: () => void
}) {
  const link = file.result!.link
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <OverlayButton
          icon={MoreHorizontal}
          aria-label={`More for ${file.name}`}
        />
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
          <a href={link} target="_blank" rel="noopener noreferrer">
            <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            Open
          </a>
        </DropdownMenuItem>
        {LINK_FORMATS.filter((choice) => choice !== format).map((choice) => (
          <DropdownMenuItem key={choice} onSelect={() => onCopy(choice)}>
            <Copy className="h-4 w-4" aria-hidden="true" />
            Copy {LINK_FORMAT_NAMES[choice].toLowerCase()}
          </DropdownMenuItem>
        ))}
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
  return badges.map(({ icon: Icon, label }) => (
    <span
      key={label}
      title={label}
      className={cn(overlayChip, 'pointer-events-auto')}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  ))
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
