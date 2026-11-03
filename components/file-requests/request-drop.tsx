'use client'

import { useEffect, useRef, useState } from 'react'

import {
  AlertCircle,
  CheckCircle2,
  File as FileIcon,
  Inbox,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import { useDropzone } from 'react-dropzone'

import { pagePanelClassName } from '@/components/layout/page-header'
import { MetaLine } from '@/components/profile/meta-line'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Textarea } from '@/components/ui/textarea'

import {
  type PublicFileRequestView,
  SENDER_NAME_MAX,
  SENDER_NOTE_MAX,
  formatRequestBytes,
} from '@/lib/file-requests/policy'
import { cn } from '@/lib/utils'

type ItemStatus = 'queued' | 'uploading' | 'sent' | 'failed'
type Item = {
  id: string
  file: File
  status: ItemStatus
  uploaded: number
  error?: string
  /** An object URL for image thumbnails, revoked when the item goes. */
  preview?: string
}

const KEY_HEADER = 'X-Flare-Submission-Key'
/** These mean no further file can be sent through this link right now. */
const STOP_CODES = new Set([
  'invalid',
  'closed',
  'expired',
  'full',
  'paused',
  'invalid_session',
])

class SendError extends Error {
  constructor(
    message: string,
    public code = 'unknown'
  ) {
    super(message)
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
function retryDelay(attempt: number, retryAfter: string | null) {
  const seconds = Number(retryAfter)
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(seconds, 60) * 1000
    : 1000 * 2 ** attempt
}

/** JSON calls retry rate limits, server errors, and dropped connections. */
async function call<T>(
  url: string,
  init: RequestInit,
  attempt = 0
): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', ...init })
  } catch {
    if (attempt < 3) {
      await wait(retryDelay(attempt, null))
      return call(url, init, attempt + 1)
    }
    throw new SendError(
      'The connection dropped. Check your network and try again.',
      'network'
    )
  }
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await wait(retryDelay(attempt, response.headers.get('retry-after')))
    return call(url, init, attempt + 1)
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new SendError(
      body.error || 'Something went wrong. Try again.',
      body.code
    )
  return body as T
}

/** One part as a raw body, with upload progress and the same retries. */
/** Parts of one file in flight; a failure aborts the rest. */
type PartRun = { failed: boolean; requests: Set<XMLHttpRequest> }

function putPart(
  url: string,
  key: string,
  blob: Blob,
  onProgress: (loaded: number) => void,
  run: PartRun,
  attempt = 0
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (run.failed) {
      reject(new SendError('This file stopped.', 'aborted'))
      return
    }
    const xhr = new XMLHttpRequest()
    run.requests.add(xhr)
    xhr.addEventListener('loadend', () => run.requests.delete(xhr))
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded)
    })
    xhr.addEventListener('abort', () =>
      reject(new SendError('This file stopped.', 'aborted'))
    )
    const retry = (retryAfter: string | null) => {
      onProgress(0)
      wait(retryDelay(attempt, retryAfter))
        .then(() => putPart(url, key, blob, onProgress, run, attempt + 1))
        .then(resolve, reject)
    }
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(blob.size)
        resolve()
        return
      }
      if ((xhr.status === 429 || xhr.status >= 500) && attempt < 3) {
        retry(xhr.getResponseHeader('retry-after'))
        return
      }
      let body: { error?: string; code?: string } = {}
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // A proxy error page is not the application's JSON.
      }
      reject(
        new SendError(
          body.error ||
            (xhr.status === 413
              ? 'A part of this file was too large for the server. Ask the person who sent the link to check their proxy settings.'
              : 'Part of this file could not be sent.'),
          body.code
        )
      )
    })
    xhr.addEventListener('error', () => {
      if (attempt < 3) retry(null)
      else
        reject(
          new SendError(
            'The connection dropped. Check your network and try again.',
            'network'
          )
        )
    })
    xhr.open('PUT', url)
    xhr.setRequestHeader(KEY_HEADER, key)
    xhr.send(blob)
  })
}

export function RequestDrop({
  token,
  request,
}: {
  token: string
  request: PublicFileRequestView
}) {
  const base = `/api/r/${encodeURIComponent(token)}`
  const recipient = request.ownerName || 'the person who asked'
  const [items, setItems] = useState<Item[]>([])
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState('')
  const [stopped, setStopped] = useState('')
  const [remaining, setRemaining] = useState({
    files: request.filesRemaining,
    bytes: request.bytesRemaining,
  })
  const [delivered, setDelivered] = useState<{
    count: number
    bytes: number
    failed: number
  } | null>(null)
  const sendingRef = useRef(false)
  const nextId = useRef(0)
  const previews = useRef(new Map<string, string>())

  useEffect(() => {
    const live = new Set(items.map((item) => item.id))
    for (const [id, url] of previews.current)
      if (!live.has(id)) {
        URL.revokeObjectURL(url)
        previews.current.delete(id)
      }
  }, [items])
  useEffect(() => {
    const urls = previews.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }, [])

  useEffect(() => {
    if (!sending) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [sending])

  const fileLimit = Math.min(
    request.maxFileBytes,
    remaining.bytes ?? Number.POSITIVE_INFINITY
  )
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted, rejections) => {
      setItems((current) => [
        ...current,
        ...accepted.map((file) => {
          const id = String(nextId.current++)
          const preview = file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined
          if (preview) previews.current.set(id, preview)
          return { id, file, status: 'queued' as const, uploaded: 0, preview }
        }),
      ])
      setNotice(
        rejections.length
          ? `${rejections.length} ${rejections.length === 1 ? 'file is' : 'files are'} too large. Each file can be at most ${formatRequestBytes(fileLimit)}.`
          : ''
      )
    },
    maxSize: fileLimit,
    disabled: sending || Boolean(stopped),
  })

  const pending = items.filter((item) => item.status !== 'sent')
  const pendingBytes = pending.reduce((sum, item) => sum + item.file.size, 0)
  const tooMany = remaining.files !== null && pending.length > remaining.files
  const tooBig = remaining.bytes !== null && pendingBytes > remaining.bytes
  const nameMissing = request.senderName === 'required' && !name.trim()

  const patch = (id: string, change: Partial<Item>) =>
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...change } : item))
    )

  async function sendFile(item: Item, submission: { id: string; key: string }) {
    const headers = {
      'Content-Type': 'application/json',
      [KEY_HEADER]: submission.key,
    }
    const started = await call<{ uploadId: string; partSize: number }>(
      `${base}/uploads`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          submissionId: submission.id,
          filename: item.file.name,
          mimeType: item.file.type || 'application/octet-stream',
          size: item.file.size,
          // Retries of this request repeat the key, so a start whose
          // response was lost returns its upload instead of taking a slot.
          clientKey: crypto.randomUUID(),
        }),
      }
    )
    const count = Math.ceil(item.file.size / started.partSize)
    const progress = new Map<number, number>()
    const report = () =>
      patch(item.id, {
        uploaded: [...progress.values()].reduce((sum, value) => sum + value, 0),
      })
    let next = 1
    const run: PartRun = { failed: false, requests: new Set() }
    // Three parts in flight, like the dashboard's large uploads. The first
    // part that fails for good stops the others, so a failed file never keeps
    // uploading behind the next one.
    const worker = async () => {
      while (next <= count && !run.failed) {
        const part = next++
        const start = (part - 1) * started.partSize
        await putPart(
          `${base}/uploads/${started.uploadId}/parts/${part}`,
          submission.key,
          item.file.slice(
            start,
            Math.min(start + started.partSize, item.file.size)
          ),
          (loaded) => {
            progress.set(part, loaded)
            report()
          },
          run
        )
      }
    }
    try {
      await Promise.all(
        Array.from({ length: Math.min(3, count) }, () => worker())
      )
      return await call<{
        remaining: { files: number | null; bytes: number | null }
      }>(`${base}/uploads/${started.uploadId}/complete`, {
        method: 'POST',
        headers,
      })
    } catch (error) {
      // Stop this file's other parts and give its room back at once; the
      // request may have little left for the next file or a retry.
      run.failed = true
      for (const request of run.requests) request.abort()
      void fetch(`${base}/uploads/${started.uploadId}`, {
        method: 'DELETE',
        headers: { [KEY_HEADER]: submission.key },
      }).catch(() => {})
      throw error
    }
  }

  async function send() {
    if (sendingRef.current || !pending.length) return
    sendingRef.current = true
    setSending(true)
    setNotice('')
    const batch = pending.map((item) => ({
      ...item,
      status: 'queued' as const,
      uploaded: 0,
      error: undefined,
    }))
    setItems((current) => [
      ...current.filter((item) => item.status === 'sent'),
      ...batch,
    ])
    let count = 0
    let bytes = 0
    let failed = 0
    try {
      const { submission } = await call<{
        submission: { id: string; key: string }
      }>(`${base}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderName: name, note }),
      })
      for (const [index, item] of batch.entries()) {
        patch(item.id, { status: 'uploading', error: undefined })
        try {
          const result = await sendFile(item, submission)
          patch(item.id, { status: 'sent', uploaded: item.file.size })
          setRemaining(result.remaining)
          count++
          bytes += item.file.size
        } catch (error) {
          const failure =
            error instanceof SendError
              ? error
              : new SendError('This file could not be sent.')
          patch(item.id, { status: 'failed', error: failure.message })
          failed++
          if (STOP_CODES.has(failure.code)) {
            setStopped(failure.message)
            failed += batch.length - index - 1
            break
          }
        }
      }
      if (count)
        await call(`${base}/submissions/${submission.id}/complete`, {
          method: 'POST',
          headers: { [KEY_HEADER]: submission.key },
        }).catch(() => {
          // The files arrived; only the owner's notification may wait.
        })
      if (count) setDelivered({ count, bytes, failed })
    } catch (error) {
      const failure =
        error instanceof SendError
          ? error
          : new SendError('The files could not be sent. Try again.')
      if (STOP_CODES.has(failure.code)) setStopped(failure.message)
      else setNotice(failure.message)
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  const header = (
    <div className="flex items-start gap-4 border-b border-border/60 p-6 sm:gap-5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border bg-muted/30 sm:h-14 sm:w-14">
        <Inbox className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" />
      </div>
      <div className="min-w-0 space-y-1.5">
        <p className="text-xs font-medium uppercase tracking-[.2em] text-muted-foreground">
          File request
        </p>
        <h1 className="break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">
          {request.title}
        </h1>
        {request.ownerName && (
          <p className="text-sm text-muted-foreground">
            From{' '}
            <span className="font-medium text-foreground">
              {request.ownerName}
            </span>
          </p>
        )}
      </div>
    </div>
  )

  if (delivered && !sending)
    return (
      <section
        className={cn(pagePanelClassName, 'overflow-hidden p-0 sm:p-0')}
        data-flare-surface
      >
        {header}
        <div className="space-y-5 p-6 text-center sm:p-8">
          <CheckCircle2
            className="mx-auto h-10 w-10 text-success"
            aria-hidden="true"
          />
          <div className="space-y-1.5" role="status">
            <h2 className="text-lg font-semibold">
              {delivered.failed ? 'Some files were sent' : 'Files sent'}
            </h2>
            <p className="text-pretty text-sm text-muted-foreground">
              {delivered.count} {delivered.count === 1 ? 'file' : 'files'} (
              {formatRequestBytes(delivered.bytes)}) went to {recipient}.
              {delivered.failed
                ? ` ${delivered.failed} ${delivered.failed === 1 ? 'file' : 'files'} could not be sent.`
                : ' You can close this page.'}
            </p>
          </div>
          {stopped && (
            <Alert variant="warning" className="text-left">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{stopped}</AlertDescription>
            </Alert>
          )}
          {!stopped && remaining.files !== 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setDelivered(null)
                setItems((current) =>
                  current.filter((item) => item.status === 'failed')
                )
                setNote('')
              }}
            >
              <Upload aria-hidden="true" />
              {delivered.failed ? 'Try the rest again' : 'Send more files'}
            </Button>
          )}
        </div>
      </section>
    )

  return (
    <section
      className={cn(pagePanelClassName, 'overflow-hidden p-0 sm:p-0')}
      data-flare-surface
    >
      {header}
      <div className="space-y-6 p-6">
        {request.message && (
          <p className="whitespace-pre-line break-words text-sm leading-relaxed">
            {request.message}
          </p>
        )}
        <MetaLine
          className="text-xs text-muted-foreground"
          items={[
            {
              key: 'size',
              text: `Up to ${formatRequestBytes(request.maxFileBytes)} per file`,
            },
            ...(remaining.files !== null
              ? [
                  {
                    key: 'files',
                    text: `${remaining.files} ${remaining.files === 1 ? 'file' : 'files'} left`,
                  },
                ]
              : []),
            ...(remaining.bytes !== null
              ? [
                  {
                    key: 'bytes',
                    text: `${formatRequestBytes(remaining.bytes)} left`,
                  },
                ]
              : []),
            ...(request.expiresAt
              ? [
                  {
                    key: 'expires',
                    text: `Open until ${new Date(request.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`,
                  },
                ]
              : []),
          ]}
        />
        {stopped ? (
          <Alert variant="warning">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{stopped}</AlertDescription>
          </Alert>
        ) : (
          <>
            {request.senderName !== 'off' && (
              <div className="space-y-2">
                <Label htmlFor="sender-name">
                  Your name{' '}
                  <span className="font-normal text-muted-foreground">
                    (
                    {request.senderName === 'required'
                      ? 'required'
                      : 'optional'}
                    )
                  </span>
                </Label>
                <Input
                  id="sender-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={SENDER_NAME_MAX}
                  autoComplete="name"
                  disabled={sending}
                  required={request.senderName === 'required'}
                />
              </div>
            )}
            <div
              {...getRootProps({
                role: 'button',
                'aria-label': 'Choose files to send',
                'aria-disabled': sending,
              })}
              className={cn(
                'flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-control bg-muted/20 px-4 py-8 text-center outline-none transition-colors hover:border-primary hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                isDragActive && 'border-primary bg-primary/5',
                sending && 'pointer-events-none opacity-60'
              )}
            >
              <input {...getInputProps()} />
              <Upload
                className="mb-3 h-9 w-9 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-balance text-base font-medium">
                {isDragActive
                  ? 'Drop your files here'
                  : 'Choose files or drag them here'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Large files are fine. You can add as many as you need.
              </p>
            </div>
          </>
        )}
        {notice && (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {items.length > 0 && (
          <ul className="divide-y rounded-xl border" aria-label="Files to send">
            {items.map((item) => {
              const percent = item.file.size
                ? Math.min(
                    100,
                    Math.round((item.uploaded / item.file.size) * 100)
                  )
                : 100
              return (
                <li key={item.id} className="flex items-center gap-3 p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {item.status === 'sent' ? (
                      <CheckCircle2
                        className="h-5 w-5 text-success"
                        aria-hidden="true"
                      />
                    ) : item.status === 'failed' ? (
                      <AlertCircle
                        className="h-5 w-5 text-destructive"
                        aria-hidden="true"
                      />
                    ) : item.preview ? (
                      <img
                        src={item.preview}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        className="h-10 w-10 object-cover"
                      />
                    ) : (
                      <FileIcon
                        className="h-5 w-5 text-muted-foreground"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className="truncate text-sm font-medium"
                      title={item.file.name}
                    >
                      {item.file.name}
                    </p>
                    <p
                      className={cn(
                        'mt-0.5 text-xs text-muted-foreground',
                        item.status === 'failed' && 'text-destructive'
                      )}
                    >
                      {item.status === 'failed'
                        ? item.error
                        : item.status === 'uploading'
                          ? `${formatRequestBytes(item.uploaded)} of ${formatRequestBytes(item.file.size)}`
                          : item.status === 'sent'
                            ? `Sent · ${formatRequestBytes(item.file.size)}`
                            : formatRequestBytes(item.file.size)}
                    </p>
                    {item.status === 'uploading' && (
                      <Progress
                        value={percent}
                        aria-label={`Progress for ${item.file.name}`}
                        className="mt-2 h-1.5"
                      />
                    )}
                  </div>
                  {item.status === 'uploading' ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {percent}%
                    </span>
                  ) : (
                    item.status !== 'sent' &&
                    !sending && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove ${item.file.name}`}
                        onClick={() =>
                          setItems((current) =>
                            current.filter((entry) => entry.id !== item.id)
                          )
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {!stopped && (
          <>
            <div className="space-y-2">
              <Label htmlFor="sender-note">
                Note{' '}
                <span className="font-normal text-muted-foreground">
                  (optional)
                </span>
              </Label>
              <Textarea
                id="sender-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={SENDER_NOTE_MAX}
                rows={2}
                placeholder={`Anything ${recipient} should know`}
                disabled={sending}
              />
            </div>
            {(tooMany || tooBig) && (
              <p role="alert" className="text-sm text-destructive">
                {tooMany
                  ? `This request accepts ${remaining.files} more ${remaining.files === 1 ? 'file' : 'files'}. Remove ${pending.length - remaining.files!} to send.`
                  : `These files add up to ${formatRequestBytes(pendingBytes)}, more than the ${formatRequestBytes(remaining.bytes!)} left. Remove some to send.`}
              </p>
            )}
            <Button
              className="w-full"
              onClick={() => void send()}
              disabled={
                !pending.length || sending || tooMany || tooBig || nameMissing
              }
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Upload className="h-4 w-4" aria-hidden="true" />
              )}
              {sending
                ? 'Sending…'
                : pending.length
                  ? `Send ${pending.length} ${pending.length === 1 ? 'file' : 'files'}`
                  : 'Send files'}
            </Button>
            <p className="text-pretty text-center text-xs text-muted-foreground">
              Only {recipient} and the administrators of this site can see what
              you send.
            </p>
          </>
        )}
      </div>
    </section>
  )
}
