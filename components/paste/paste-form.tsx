'use client'

import {
  type ReactNode,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'

import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'

import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileCode2,
  Link2,
  Loader2,
  Plus,
  ShieldAlert,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { copyText, copyWhenReady } from '@/lib/client/clipboard'
import { handOff, takeHandoff } from '@/lib/client/handoff'
import { detectLanguage, suggestPasteName } from '@/lib/files/detect-language'
import {
  LANGUAGES,
  type Language,
  extensionOf,
  languageExtension,
  languageFromFilename,
  languageName,
  namesLanguage,
} from '@/lib/files/file-kind'
import { renameForLanguage } from '@/lib/files/paste-name'
import { findSecret, loneLink } from '@/lib/paste/insights'
import { expiryLabel } from '@/lib/uploads/choices'
import { uploadPaste } from '@/lib/uploads/client'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'
import { cn } from '@/lib/utils'

import { useHydrated } from '@/hooks/use-hydrated'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'

import { UploadOptionsBar } from '../upload/options-bar'
import { useUploadOptions } from '../upload/use-upload-options'
import { type PasteDraft, clearDraft, readDraft, writeDraft } from './draft'

const PasteEditor = dynamic(
  () => import('./paste-editor').then((module) => module.PasteEditor),
  {
    ssr: false,
    loading: () => (
      <div
        className="h-[14rem] animate-pulse bg-muted/20 sm:h-[18rem]"
        aria-hidden="true"
      />
    ),
  }
)

/** Plain text first, then every highlighted language by name. */
const LANGUAGE_CHOICES = [...LANGUAGES].sort((a, b) =>
  a === 'text'
    ? -1
    : b === 'text'
      ? 1
      : languageName(a).localeCompare(languageName(b))
)

type Created = {
  name: string
  url: string
  content: string
  language: Language
  summary: string
  /** Whether the link went to the clipboard as the paste was made. */
  copied: boolean
}

/** The language detected after typing pauses, or at once for a paste. */
function useDetectedLanguage(content: string) {
  const deferred = useDeferredValue(content)
  const [detected, setDetected] = useState<Language>(() =>
    content.trim() ? detectLanguage(content) : 'text'
  )
  const last = useRef(deferred)
  useEffect(() => {
    const jump = Math.abs(deferred.length - last.current.length) > 24
    last.current = deferred
    if (!deferred.trim()) {
      setDetected('text')
      return
    }
    // A paste reads at once; typing waits for a pause, so colours don't
    // flicker between languages with each key.
    const timer = setTimeout(
      () => setDetected(detectLanguage(deferred)),
      jump ? 0 : 500
    )
    return () => clearTimeout(timer)
  }, [deferred])
  return detected
}

/**
 * The Paste page: the text in the share page's own code view, read as it
 * arrives (its language, a name, a credential that shouldn't be public, a
 * lone link) and saved as a file with the same options as an upload.
 * Creating it copies its link.
 */
export function PasteForm({
  saved,
  owner,
}: {
  saved: SavedUploadSettings
  /** The signed-in account, whose draft this page keeps. */
  owner: string
}) {
  const hydrated = useHydrated()
  const options = useUploadOptions(saved)
  const { can } = usePermissions()
  const router = useRouter()
  const [draft, setDraft] = useState<PasteDraft>(() => readDraft(owner))
  const { toast } = useToast()
  // Text handed over by Upload, taken once the page is on screen. A draft
  // already here is kept, with the new text after it.
  useEffect(() => {
    const handed = takeHandoff('text')
    if (!handed) return
    const kept = readDraft(owner)
    const next = kept.content.trim()
      ? {
          ...kept,
          content: `${kept.content.replace(/\s+$/, '')}\n\n${handed.text}`,
        }
      : { content: handed.text, name: '' }
    writeDraft(owner, next)
    setDraft(next)
    if (kept.content.trim()) toast({ title: 'Added to the end of your draft' })
  }, [owner, toast])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)
  const [passwordRequest, setPasswordRequest] = useState(0)
  const hintId = useId()

  const update = (next: Partial<PasteDraft>) =>
    setDraft((current) => {
      const value = { ...current, ...next }
      writeDraft(owner, value)
      return value
    })

  const detected = useDetectedLanguage(draft.content)
  const typed = draft.name.trim()
  const named = !!typed && namesLanguage(extensionOf(typed))
  const auto = !named && !draft.language
  const { language, fileName, suffix } = settle(draft, detected)

  const empty = !draft.content.trim()
  const blocked = submitting || empty || !!options.problem || options.pending

  const publicWithoutPassword =
    options.effective.visibility === 'PUBLIC' && !options.passwordSet
  // Read behind typing, so a long paste never slows a key press.
  const reading = useDeferredValue(draft.content)
  const secret = useMemo(
    () => (publicWithoutPassword ? findSecret(reading) : null),
    [publicWithoutPassword, reading]
  )
  const link = useMemo(() => loneLink(reading), [reading])

  const create = () => {
    if (blocked) {
      if (empty) setError('Add some text first.')
      return
    }
    setSubmitting(true)
    setError('')
    const submitted = draft
    // What was typed a moment ago is read now, not after the pause the
    // page waits for while typing.
    const final = settle(draft, detectLanguage(draft.content))
    const language = final.language
    const file = new File([draft.content], final.fileName, {
      type: 'text/plain',
    })
    const { effective } = options
    const summary = [
      languageName(language),
      effective.visibility === 'PUBLIC' ? 'Public' : 'Private',
      ...(options.passwordSet ? ['Password'] : []),
      expiryLabel(effective.expiry, effective.expiryAction),
    ].join(' · ')
    const making = uploadPaste(file, options.options)
    // Asked for within the click or key press, written once the link exists.
    const copying = copyWhenReady(
      making.then((paste) => paste.pageUrl || paste.url)
    )
    making.then(
      async (paste) => {
        const copiedNow = await copying
        setCreated({
          name: paste.name,
          url: paste.pageUrl || paste.url,
          content: submitted.content,
          language,
          summary,
          copied: copiedNow,
        })
        setCopied(copiedNow)
        toast({ title: copiedNow ? 'Link copied' : 'Paste created' })
        clearDraft(submitted)
        setDraft({ content: '', name: '' })
        options.clearPassword()
        setSubmitting(false)
      },
      (failure) => {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not create the paste. Your text is still here; try again.'
        )
        setSubmitting(false)
      }
    )
  }

  const copyLink = async () => {
    if (!created) return
    if (await copyText(created.url)) {
      setCopied(true)
      toast({ title: 'Link copied' })
    } else
      toast({
        title: 'Could not copy the link',
        description: 'Select the link and copy it yourself.',
        variant: 'destructive',
      })
  }

  const mac = hydrated && /Mac|iPhone|iPad/.test(navigator.userAgent)

  if (created)
    return (
      <div className="overflow-hidden rounded-xl border bg-background/40">
        <div
          role="status"
          className="flex flex-col gap-3 border-b border-border/60 p-3 sm:flex-row sm:items-center sm:px-4"
        >
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <CheckCircle2
              className="h-5 w-5 shrink-0 text-success"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <a
                href={created.url}
                target="_blank"
                rel="noopener noreferrer"
                className="block truncate font-mono text-sm underline-offset-4 hover:underline"
              >
                {created.url.replace(/^https?:\/\//, '')}
              </a>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {created.name} · {created.summary}
              </p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
            <Button
              onClick={() => void copyLink()}
              className="col-span-2 sm:col-span-1"
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button asChild variant="outline">
              <a href={created.url} target="_blank" rel="noopener noreferrer">
                Open
                <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
              </a>
            </Button>
            <Button variant="ghost" onClick={() => setCreated(null)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              New paste
            </Button>
          </div>
        </div>
        {/* What was shared, as recipients see it. */}
        <PasteEditor
          value={created.content}
          onChange={() => {}}
          language={created.language}
          onSubmit={() => {}}
          disabled
          describedBy={hintId}
          label="Shared paste"
        />
      </div>
    )

  const notes: ReactNode[] = []
  if (secret)
    notes.push(
      <Note
        key="secret"
        icon={ShieldAlert}
        tone="warning"
        actions={
          options.can.share
            ? [
                {
                  label: 'Add a password',
                  run: () => setPasswordRequest((count) => count + 1),
                },
                {
                  label: 'Make private',
                  run: () =>
                    options.setChoices((current) => ({
                      ...current,
                      visibility: 'PRIVATE',
                    })),
                },
              ]
            : []
        }
      >
        This looks like it has {secret} in it, and anyone with the link could
        read it.
      </Note>
    )
  if (link && can('links.create'))
    notes.push(
      <Note
        key="link"
        icon={Link2}
        actions={[
          {
            label: 'Shorten it instead',
            run: () => {
              handOff({ kind: 'link', url: link })
              router.push('/dashboard/urls')
            },
          },
        ]}
      >
        This is a single link.
      </Note>
    )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        create()
      }}
      className="space-y-4"
    >
      <div
        className="overflow-hidden rounded-xl border bg-background/40 transition-colors focus-within:border-ring"
        onPasteCapture={(event) => {
          // A copied file or screenshot is an upload, not text.
          const files = Array.from(event.clipboardData.files)
          if (!files.length || event.clipboardData.getData('text/plain')) return
          event.preventDefault()
          if (!can('files.upload')) return
          toast({
            title: files.length === 1 ? 'That’s a file' : 'Those are files',
            action: (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  handOff({ kind: 'files', files })
                  router.push('/dashboard/upload')
                }}
              >
                Upload {files.length === 1 ? 'it' : 'them'}
              </Button>
            ),
          })
        }}
      >
        <div className="flex items-center gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
          <FileCode2
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div className="relative min-w-0 flex-1">
            <input
              aria-label="Filename"
              placeholder={fileName}
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              disabled={submitting}
              spellCheck={false}
              autoComplete="off"
              className="h-8 w-full min-w-0 bg-transparent px-1 font-mono text-sm outline-none placeholder:text-muted-foreground"
            />
            {/* The extension that will be added, after what was typed. */}
            {suffix && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-1 flex items-center overflow-hidden whitespace-pre font-mono text-sm"
              >
                <span className="invisible">{draft.name}</span>
                <span className="text-muted-foreground">{suffix}</span>
              </span>
            )}
          </div>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild disabled={submitting}>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Language: ${languageName(language)}${auto ? ', detected' : ''}`}
                className="h-8 shrink-0 gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent"
              >
                {languageName(language)}
                {auto && !empty && (
                  <span className="rounded border border-border/80 px-1 text-[10px] leading-4 text-muted-foreground">
                    Auto
                  </span>
                )}
                <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-56 overflow-y-auto"
            >
              <DropdownMenuRadioGroup
                value={auto ? 'auto' : language}
                onValueChange={(next) => {
                  if (next === 'auto') {
                    update({ language: undefined })
                    return
                  }
                  const chosen = next as Language
                  // A typed name follows the language; otherwise the choice
                  // is kept apart, and the name is suggested from it.
                  if (typed)
                    update({
                      name: renameForLanguage(draft.name, chosen),
                      language: undefined,
                    })
                  else update({ language: chosen })
                }}
              >
                {!named && (
                  <>
                    <DropdownMenuRadioItem value="auto">
                      <span>
                        <span className="block">Detect automatically</span>
                        {!empty && (
                          <span className="block text-xs text-muted-foreground">
                            {languageName(detected)}
                          </span>
                        )}
                      </span>
                    </DropdownMenuRadioItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {LANGUAGE_CHOICES.map((choice) => (
                  <DropdownMenuRadioItem key={choice} value={choice}>
                    {languageName(choice)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <PasteEditor
          value={draft.content}
          onChange={(content) => {
            if (error) setError('')
            update({ content })
          }}
          language={language}
          onSubmit={create}
          disabled={submitting}
          describedBy={hintId}
        />
        {notes.length > 0 && (
          <div className="space-y-1 border-t border-border/60 px-3 py-2 sm:px-4">
            {notes}
          </div>
        )}
        <div className="border-t border-border/60 bg-muted/20 p-2.5 sm:p-3">
          <UploadOptionsBar
            state={options}
            disabled={submitting}
            passwordId="paste-password"
            passwordRequest={passwordRequest}
          >
            <Button type="submit" disabled={blocked}>
              {submitting && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {submitting ? 'Creating…' : 'Create paste'}
              {!submitting && (
                <kbd className="ml-1 hidden rounded border border-current/30 px-1 font-sans text-[11px] leading-4 opacity-70 [@media(pointer:fine)]:sm:inline">
                  {mac ? '⌘' : 'Ctrl'} ↵
                </kbd>
              )}
            </Button>
          </UploadOptionsBar>
        </div>
      </div>
      <p id={hintId} className="sr-only">
        Tab indents. Press Escape, then Tab, to leave the editor.{' '}
        {mac ? 'Command' : 'Control'} and Enter creates the paste and copies its
        link.
      </p>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}

/**
 * The language a draft is saved in and the name it gets: a typed extension
 * decides, then a chosen language, then the detected one. A typed name keeps
 * its words and gains the language's extension when it names none, so the
 * share page colours it the same way.
 */
function settle(draft: PasteDraft, detected: Language) {
  const typed = draft.name.trim()
  const named = !!typed && namesLanguage(extensionOf(typed))
  const language: Language = named
    ? languageFromFilename(typed)
    : (draft.language ?? detected)
  const suffix =
    typed && !named && language !== 'text'
      ? `.${languageExtension(language)}`
      : ''
  const fileName = named
    ? typed
    : typed
      ? `${typed}${suffix}`
      : suggestPasteName(draft.content, language)
  return { language, fileName, suffix }
}

/** One thing noticed about the text, with what to do about it. */
function Note({
  icon: Icon,
  tone,
  actions = [],
  children,
}: {
  icon: typeof Link2
  tone?: 'warning'
  actions?: readonly { label: string; run: () => void }[]
  children: ReactNode
}) {
  return (
    <p
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 text-sm',
        tone === 'warning' ? 'text-warning' : 'text-muted-foreground'
      )}
      role={tone === 'warning' ? 'alert' : undefined}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{children}</span>
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.run}
          className="rounded-sm font-medium text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {action.label}
        </button>
      ))}
    </p>
  )
}
