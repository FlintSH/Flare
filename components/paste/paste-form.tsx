'use client'

import { useId, useState } from 'react'

import dynamic from 'next/dynamic'

import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  FileCode2,
  Loader2,
  Plus,
} from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { LANGUAGES, type Language, languageName } from '@/lib/files/file-kind'
import {
  DEFAULT_PASTE_NAME,
  pasteLanguage,
  pasteName,
  renameForLanguage,
} from '@/lib/files/paste-name'
import { expiryLabel } from '@/lib/uploads/choices'
import { uploadPaste } from '@/lib/uploads/client'
import type { SavedUploadSettings } from '@/lib/uploads/saved-settings'

import { useHydrated } from '@/hooks/use-hydrated'
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

type Created = { name: string; url: string; summary: string }

/**
 * The Paste page: text or code in the share page's own code view, saved as
 * a file in the library with the same options as an upload.
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
  const [draft, setDraft] = useState<PasteDraft>(() => readDraft(owner))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()
  const hintId = useId()

  const update = (next: Partial<PasteDraft>) =>
    setDraft((current) => {
      const value = { ...current, ...next }
      writeDraft(owner, value)
      return value
    })

  const language = pasteLanguage(draft.name)
  const empty = !draft.content.trim()
  const blocked = submitting || empty || !!options.problem || options.pending

  const create = async () => {
    if (blocked) {
      if (empty) setError('Add some text first.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const submitted = draft
      const name = pasteName(draft.name)
      const file = new File([draft.content], name, { type: 'text/plain' })
      const paste = await uploadPaste(file, options.options)
      const { effective } = options
      setCreated({
        name: paste.name,
        url: paste.pageUrl || paste.url,
        summary: [
          languageName(language),
          effective.visibility === 'PUBLIC' ? 'Public' : 'Private',
          ...(options.passwordSet ? ['Password'] : []),
          expiryLabel(effective.expiry, effective.expiryAction),
        ].join(' · '),
      })
      setCopied(false)
      clearDraft(submitted)
      setDraft({ content: '', name: '' })
      options.clearPassword()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not create the paste. Your text is still here; try again.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  const copyLink = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
      toast({ title: 'Link copied' })
    } catch {
      toast({
        title: 'Could not copy the link',
        description: 'Select the link and copy it yourself.',
        variant: 'destructive',
      })
    }
  }

  if (created)
    return (
      <div className="rounded-xl border bg-background/40 p-4 sm:p-6">
        <div role="status" className="flex items-start gap-3">
          <CheckCircle2
            className="mt-0.5 h-5 w-5 shrink-0 text-primary"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="truncate font-medium">{created.name}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {created.summary}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Input
            readOnly
            aria-label="Link to the paste"
            value={created.url}
            onFocus={(event) => event.target.select()}
            className="min-w-0 flex-1 bg-background font-mono text-sm"
          />
          <div className="flex gap-2">
            <Button
              onClick={() => void copyLink()}
              className="flex-1 sm:flex-initial"
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
          </div>
        </div>
        <Button
          variant="ghost"
          className="-ml-3 mt-3"
          onClick={() => setCreated(null)}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          New paste
        </Button>
      </div>
    )

  const mac = hydrated && /Mac|iPhone|iPad/.test(navigator.userAgent)

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
      className="space-y-4"
    >
      <div className="overflow-hidden rounded-xl border bg-background/40 transition-colors focus-within:border-ring">
        <div className="flex items-center gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
          <FileCode2
            className="h-4 w-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Filename"
            placeholder={DEFAULT_PASTE_NAME}
            value={draft.name}
            onChange={(event) => update({ name: event.target.value })}
            disabled={submitting}
            spellCheck={false}
            autoComplete="off"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-sm shadow-none focus-visible:ring-0"
          />
          <Select
            value={language}
            onValueChange={(next: Language) =>
              update({ name: renameForLanguage(draft.name, next) })
            }
            disabled={submitting}
          >
            <SelectTrigger
              aria-label="Language"
              className="h-8 w-auto shrink-0 gap-1.5 border-0 bg-transparent px-2 text-sm text-muted-foreground shadow-none hover:text-foreground data-[state=open]:bg-accent"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end" className="max-h-80">
              {LANGUAGE_CHOICES.map((choice) => (
                <SelectItem key={choice} value={choice}>
                  {languageName(choice)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <PasteEditor
          value={draft.content}
          onChange={(content) => {
            if (error) setError('')
            update({ content })
          }}
          language={language}
          onSubmit={() => void create()}
          disabled={submitting}
          describedBy={hintId}
        />
      </div>
      <p id={hintId} className="sr-only">
        Tab indents. Press Escape, then Tab, to leave the editor.{' '}
        {mac ? 'Command' : 'Control'} and Enter creates the paste.
      </p>

      <UploadOptionsBar
        state={options}
        disabled={submitting}
        passwordId="paste-password"
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

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </form>
  )
}
