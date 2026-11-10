'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  Check,
  Copy,
  Download,
  FileDown,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

import { DERIVING_FILE_KEY } from '@/components/encryption/file-password'
import { UnlockDialog } from '@/components/encryption/unlock-dialog'
import { setEncryptedFileTitle } from '@/components/file/encrypted-title'
import { PreviewPlaceholder } from '@/components/file/viewer/components/preview-placeholder'
import { TextView } from '@/components/file/viewer/components/text-content'
import { AudioViewer } from '@/components/file/viewer/viewers/audio-viewer'
import { ImageViewer } from '@/components/file/viewer/viewers/image-viewer'
import { PdfViewer } from '@/components/file/viewer/viewers/pdf-viewer'
import { VideoPlayer } from '@/components/file/viewer/viewers/video-viewer'
import { useAccountKeys } from '@/components/providers/account-keys-provider'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'

import { workerArgon2id } from '@/lib/e2ee/client/argon2-worker'
import {
  CiphertextRefused,
  type DecryptedContent,
} from '@/lib/e2ee/client/file-worker'
import {
  type EncryptedRecordsWire,
  type OpenedFile,
  createAccountUnwrapper,
  openWithFileKey,
  openWithPassword,
  shareSecretOf,
} from '@/lib/e2ee/client/files'
import {
  type LocalAddress,
  localAddresses,
} from '@/lib/e2ee/client/local-address'
import { isE2eeError } from '@/lib/e2ee/errors'
import { E2eeError } from '@/lib/e2ee/errors'
import { parseShareFragment, shareLink } from '@/lib/e2ee/link'
import type { LinkSecret } from '@/lib/e2ee/types'
import {
  decryptionProblem,
  downloadDecrypted,
  fetchDecrypted,
  localFileSource,
  plaintextSize,
  saveDecrypted,
} from '@/lib/files/encrypted-client'
import {
  INLINE_PREVIEW_MAX_BYTES,
  type SafeRendering,
  canPreviewSandboxedPdf,
  safeFileName,
  safeRendering,
} from '@/lib/files/safe-render'
import { fileUrls } from '@/lib/files/urls'
import { cn, formatBytes } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

export interface EncryptedSharedFile {
  id: string
  urlPath: string
  /** The size of the ciphertext. */
  sizeBytes: number
  records: EncryptedRecordsWire
  /** The signed-in visitor owns the file, so the account key can open it. */
  isOwner: boolean
  /** The visitor sees the file as a moderator, who has no key for it. */
  isModerator: boolean
  showFilename: boolean
}

type Access =
  | { step: 'reading' }
  | { step: 'missing-key' }
  | { step: 'wrong-key' }
  | { step: 'update' }
  | { step: 'locked' }
  | { step: 'moderator' }
  | { step: 'password'; linkSecret: LinkSecret; problem: string | null }
  | { step: 'deriving'; linkSecret: LinkSecret }
  | { step: 'open'; opened: OpenedFile }

type Preview =
  | { status: 'idle' }
  | { status: 'loading'; loaded: number; total: number | null }
  | { status: 'failed'; message: string }
  | { status: 'too-large' }
  | { status: 'download-only' }
  | { status: 'pdf-unavailable' }
  | { status: 'ready'; view: View }

type View =
  | { renderer: 'image'; src: string }
  | { renderer: 'svg'; src: string }
  | { renderer: 'video'; src: string; type: string }
  | { renderer: 'audio'; src: string; type: string }
  /** `local`: the address of the service worker, which sandboxes its answer. */
  | { renderer: 'pdf'; src: string; local: boolean }
  | {
      renderer: 'text'
      text: string
      language: Extract<SafeRendering, { renderer: 'text' }>['language']
    }

function wrongKey(error: unknown) {
  return isE2eeError(error)
}

/** `data:` and not `blob:`: see `safe-render.ts` for why an SVG gets no address of this origin. */
function svgDataUrl(content: DecryptedContent) {
  let binary = ''
  for (const part of content.parts)
    for (let index = 0; index < part.length; index += 0x8000)
      binary += String.fromCharCode(...part.subarray(index, index + 0x8000))
  return `data:image/svg+xml;base64,${btoa(binary)}`
}

function decodeText(content: DecryptedContent) {
  const decoder = new TextDecoder()
  let text = ''
  for (const part of content.parts)
    text += decoder.decode(part, { stream: true })
  return text + decoder.decode()
}

/**
 * The share page of an encrypted file (docs/e2ee-spec.md, section 10.3).
 * The server sent only what it has: the records and the size. The key comes
 * from the part of the address after `#`, which no request carries, or from
 * the owner's account key. Everything is decrypted here.
 */
export function EncryptedFile({ file }: { file: EncryptedSharedFile }) {
  const { state: keys } = useAccountKeys()
  const { toast } = useToast()
  const [access, setAccess] = useState<Access>({ step: 'reading' })
  const [preview, setPreview] = useState<Preview>({ status: 'idle' })
  const [password, setPassword] = useState('')
  const [unlocking, setUnlocking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const content = useRef<DecryptedContent | null>(null)
  // A player whose local address stopped answering asks for a new one.
  const [attempt, setAttempt] = useState(0)
  const recoveries = useRef(0)
  const { records } = file
  const accountKeys = keys.status === 'unlocked' ? keys.keys : null
  const keyStatus = keys.status

  // Step 1: find a key. The fragment first; without one, the owner's keys.
  useEffect(() => {
    let stale = false
    const settle = (next: Access) => {
      if (!stale) setAccess(next)
    }
    const fragment = parseShareFragment(window.location.hash)
    if (fragment.kind === 'file_key') {
      try {
        settle({
          step: 'open',
          opened: openWithFileKey(records, fragment.fileKey),
        })
      } catch {
        settle({ step: 'wrong-key' })
      }
    } else if (fragment.kind === 'link_secret') {
      settle(
        records.passwordStanza
          ? { step: 'password', linkSecret: fragment.linkSecret, problem: null }
          : // The password was removed, so this link's secret opens nothing.
            { step: 'wrong-key' }
      )
    } else if (fragment.kind === 'unknown_version') settle({ step: 'update' })
    else if (fragment.kind === 'malformed') settle({ step: 'wrong-key' })
    else if (file.isOwner && records.accountStanza) {
      if (keyStatus === 'loading') settle({ step: 'reading' })
      else if (!accountKeys) settle({ step: 'locked' })
      else
        void createAccountUnwrapper(accountKeys).then(async (unwrapper) => {
          try {
            settle({ step: 'open', opened: await unwrapper.unwrap(records) })
          } catch {
            settle({ step: 'wrong-key' })
          } finally {
            unwrapper.close()
          }
        })
    } else settle({ step: file.isModerator ? 'moderator' : 'missing-key' })
    return () => {
      stale = true
    }
  }, [records, file.isOwner, file.isModerator, accountKeys, keyStatus])

  const opened = access.step === 'open' ? access.opened : null
  const name = opened ? safeFileName(opened.name) : null
  const rendering = useMemo(
    () => (opened ? safeRendering(opened) : null),
    [opened]
  )

  useEffect(() => {
    setEncryptedFileTitle(file.showFilename ? name : null)
    return () => setEncryptedFileTitle(null)
  }, [name, file.showFilename])

  // Step 2: pick the renderer, then give it the content. A video, an audio
  // file and (where a sandboxed frame cannot show one) a PDF play from a
  // local address that a service worker answers with decrypted ranges
  // (docs/e2ee-spec.md, section 12.2). Each other file, and each browser
  // without a service worker, is fetched, verified and decrypted whole.
  useEffect(() => {
    if (!opened || !rendering) return
    content.current = null
    if (rendering.renderer === 'download') {
      setPreview({ status: 'download-only' })
      return
    }
    const { renderer } = rendering
    const sandboxedPdf =
      renderer === 'pdf' &&
      canPreviewSandboxedPdf({
        pdfViewerEnabled: navigator.pdfViewerEnabled,
        userAgent: navigator.userAgent,
        brands: (
          navigator as Navigator & {
            userAgentData?: { brands?: { brand: string }[] }
          }
        ).userAgentData?.brands,
      })
    const controller = new AbortController()
    let address: string | null = null
    let local: LocalAddress | null = null

    const wholeFile = () => {
      if (renderer === 'pdf' && !sandboxedPdf) {
        setPreview({ status: 'pdf-unavailable' })
        return
      }
      const limit = INLINE_PREVIEW_MAX_BYTES[renderer]
      const size = plaintextSize(file.sizeBytes)
      if (size !== null && size > limit) {
        setPreview({ status: 'too-large' })
        return
      }
      setPreview({ status: 'loading', loaded: 0, total: file.sizeBytes })
      fetchDecrypted(file, opened, {
        signal: controller.signal,
        // The server's size is not trusted: stop at the limit whatever it said.
        maxBytes: limit,
        onProgress: (loaded, total) => {
          if (!controller.signal.aborted)
            setPreview({
              status: 'loading',
              loaded,
              total: total ?? file.sizeBytes,
            })
        },
      }).then(
        (decrypted) => {
          if (controller.signal.aborted) return
          content.current = decrypted
          if (rendering.renderer === 'text') {
            setPreview({
              status: 'ready',
              view: {
                renderer: 'text',
                text: decodeText(decrypted),
                language: rendering.language,
              },
            })
            return
          }
          if (rendering.renderer === 'svg') {
            setPreview({
              status: 'ready',
              view: { renderer: 'svg', src: svgDataUrl(decrypted) },
            })
            return
          }
          // The Blob type is the fixed type of the renderer, never the type
          // the file claims.
          address = URL.createObjectURL(
            new Blob(decrypted.parts, { type: rendering.blobType })
          )
          setPreview({
            status: 'ready',
            view:
              rendering.renderer === 'video' || rendering.renderer === 'audio'
                ? {
                    renderer: rendering.renderer,
                    src: address,
                    type: rendering.blobType,
                  }
                : rendering.renderer === 'pdf'
                  ? { renderer: 'pdf', src: address, local: false }
                  : { renderer: rendering.renderer, src: address },
          })
        },
        (error: unknown) => {
          if (controller.signal.aborted) return
          setPreview(
            error instanceof RangeError
              ? { status: 'too-large' }
              : { status: 'failed', message: decryptionProblem(error) }
          )
        }
      )
    }

    if (
      rendering.renderer === 'video' ||
      rendering.renderer === 'audio' ||
      (rendering.renderer === 'pdf' && !sandboxedPdf)
    ) {
      const { blobType } = rendering
      setPreview({ status: 'idle' })
      void localAddresses().then((service) => {
        if (controller.signal.aborted) return
        if (!service) return wholeFile()
        const created = service.create({
          mode: renderer === 'pdf' ? 'frame' : 'media',
          contentType: blobType,
          source: localFileSource(
            {
              id: file.id,
              urlPath: file.urlPath,
              header: records.header,
              sizeBytes: file.sizeBytes,
            },
            opened
          ),
        })
        local = created
        created.watch((event) => {
          if (controller.signal.aborted || event.type !== 'failed') return
          // The worker says why it gave no bytes. A lost connection is left
          // to the player, which asks again.
          if (event.reason === 'integrity')
            setPreview({
              status: 'failed',
              message: decryptionProblem(new E2eeError('tag_mismatch', '')),
            })
          else if (event.reason === 'refused')
            setPreview({
              status: 'failed',
              message: decryptionProblem(new CiphertextRefused(404)),
            })
        })
        created.registered.then(
          () => {
            if (controller.signal.aborted) return
            setPreview({
              status: 'ready',
              view:
                renderer === 'pdf'
                  ? { renderer: 'pdf', src: created.url, local: true }
                  : {
                      renderer: renderer as 'video' | 'audio',
                      src: created.url,
                      type: blobType,
                    },
            })
          },
          () => {
            if (controller.signal.aborted) return
            created.release()
            local = null
            wholeFile()
          }
        )
      })
    } else wholeFile()

    return () => {
      controller.abort()
      if (address) URL.revokeObjectURL(address)
      local?.release()
    }
    // `file` is the page's own prop and does not change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, rendering, attempt])

  // A new address for a player whose address failed: at most two times in
  // a row, so a file that cannot play ends in the player's error.
  const recover = useCallback(() => {
    if (recoveries.current >= 2) return false
    recoveries.current++
    setAttempt((value) => value + 1)
    return true
  }, [])

  useEffect(() => {
    if (!copied) return
    const timeout = window.setTimeout(() => setCopied(false), 2500)
    return () => window.clearTimeout(timeout)
  }, [copied])

  const submitPassword = async (event: React.FormEvent) => {
    event.preventDefault()
    if (access.step !== 'password' || !password) return
    const { linkSecret } = access
    setAccess({ step: 'deriving', linkSecret })
    try {
      const result = await openWithPassword({
        records,
        linkSecret,
        password,
        argon2id: workerArgon2id,
      })
      setPassword('')
      setAccess({ step: 'open', opened: result })
    } catch (error) {
      setAccess({
        step: 'password',
        linkSecret,
        problem: wrongKey(error)
          ? 'That password does not open this file. Check it with the sender. If they changed the password, ask them for the new link.'
          : 'The password could not be checked in this browser. Reload the page and try again.',
      })
    }
  }

  const download = useCallback(async () => {
    if (!opened || saving) return
    setSaving(true)
    try {
      // What the preview decrypted is saved as it is. Each other file is
      // streamed to disk where a service worker can do that.
      if (content.current) saveDecrypted(content.current, opened.name)
      else
        await downloadDecrypted(
          {
            id: file.id,
            urlPath: file.urlPath,
            header: records.header,
            sizeBytes: file.sizeBytes,
          },
          opened
        )
    } catch (error) {
      toast({
        title: 'Couldn’t download this file',
        description: decryptionProblem(error),
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }, [file, records.header, opened, saving, toast])

  const copyLink = async () => {
    if (!opened) return
    try {
      await navigator.clipboard.writeText(
        // An opened link is copied as it is. The owner, who came without
        // one, gets the link their key can build.
        window.location.hash
          ? window.location.href
          : shareLink(
              fileUrls(file, { origin: window.location.origin }).page,
              shareSecretOf(opened, records.passwordStanza)
            )
      )
      setCopied(true)
    } catch {
      toast({
        title: 'Couldn’t copy the link',
        description: 'Copy the address from your browser instead.',
        variant: 'destructive',
      })
    }
  }

  const copyText = async () => {
    if (preview.status !== 'ready' || preview.view.renderer !== 'text') return
    try {
      await navigator.clipboard.writeText(preview.view.text)
      toast({
        title: 'Text copied',
        description: 'File content is ready to paste.',
      })
    } catch {
      toast({
        title: 'Couldn’t copy the text',
        description: 'Please try again.',
        variant: 'destructive',
      })
    }
  }

  if (access.step !== 'open' || !opened || !name)
    return (
      <div
        className="w-full min-w-0 px-6 pb-6 sm:w-[30rem]"
        data-encrypted-share={access.step}
      >
        {access.step === 'reading' && <Status message="Reading the key…" />}
        {access.step === 'missing-key' && (
          <PreviewPlaceholder
            role="alert"
            icon={KeyRound}
            title="This link is missing its key"
            titleAs="h2"
            description="This file is encrypted, and its key is the part of the link after #. That part is not here, so the file cannot be opened. Ask the sender for the complete link."
          />
        )}
        {access.step === 'wrong-key' && (
          <PreviewPlaceholder
            role="alert"
            icon={ShieldAlert}
            title="This key does not open this file"
            titleAs="h2"
            description="The part of the link after # is not the key of this file. The link may have been cut or changed, or the owner changed its password. Ask the sender for a new link."
          />
        )}
        {access.step === 'update' && (
          <PreviewPlaceholder
            role="alert"
            icon={ShieldAlert}
            title="This link needs a newer version of Flare"
            titleAs="h2"
            description="The link uses a format this page does not know. Reload the page. If it still does not open, the instance must be updated."
          />
        )}
        {access.step === 'moderator' && (
          <PreviewPlaceholder
            icon={LockKeyhole}
            title="This file is encrypted"
            titleAs="h2"
            description="Only people with its link can read it. As a moderator you can see its size, date and visibility and you can delete it, but Flare has no key to show you its name or content."
          />
        )}
        {access.step === 'locked' && (
          <PreviewPlaceholder
            icon={LockKeyhole}
            title="Your encryption keys are locked"
            titleAs="h2"
            description="Unlock them with your passphrase to open this file."
          >
            <Button
              size="sm"
              className="mt-2"
              onClick={() => setUnlocking(true)}
            >
              Unlock
            </Button>
            <UnlockDialog open={unlocking} onOpenChange={setUnlocking} />
          </PreviewPlaceholder>
        )}
        {(access.step === 'password' || access.step === 'deriving') && (
          <form className="flex flex-col gap-4" onSubmit={submitPassword}>
            <div className="space-y-1 text-center">
              <h2 className="text-sm font-medium">Password-protected file</h2>
              <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
                Enter the password from the sender. It is checked in your
                browser and is not sent to the server.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="encrypted-share-password">File password</Label>
              {/* No `name`: nothing here is ever part of a form submission. */}
              <Input
                id="encrypted-share-password"
                type="password"
                autoComplete="off"
                placeholder="Enter the file password"
                className="h-11"
                value={password}
                disabled={access.step === 'deriving'}
                onChange={(event) => setPassword(event.target.value)}
                aria-invalid={
                  access.step === 'password' && access.problem
                    ? true
                    : undefined
                }
                aria-describedby={
                  access.step === 'password' && access.problem
                    ? 'encrypted-share-password-error'
                    : undefined
                }
              />
              {access.step === 'password' && access.problem && (
                <p
                  id="encrypted-share-password-error"
                  role="alert"
                  className="text-pretty text-sm text-destructive"
                >
                  {access.problem}
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="h-11"
              disabled={access.step === 'deriving' || !password}
            >
              {access.step === 'deriving' && (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {access.step === 'deriving' ? DERIVING_FILE_KEY : 'Open file'}
            </Button>
          </form>
        )}
      </div>
    )

  const view = preview.status === 'ready' ? preview.view : null
  const buttonClassName = 'h-9 w-full sm:h-8 sm:w-auto'
  const showCopyText = view?.renderer === 'text'
  return (
    <div className="min-w-0 space-y-4" data-encrypted-share="open">
      <div className="flex min-w-0 items-center justify-center overflow-hidden">
        {preview.status === 'idle' && <Status message="Decrypting…" />}
        {preview.status === 'loading' && (
          <div className="w-full px-6 sm:w-[30rem]" role="status">
            <div className="flex items-center justify-center gap-3 pb-3 pt-6">
              <Loader2
                className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm text-muted-foreground">
                Downloading and decrypting…{' '}
                <span className="tabular-nums">
                  {formatBytes(preview.loaded)}
                  {preview.total ? ` of ${formatBytes(preview.total)}` : ''}
                </span>
              </p>
            </div>
            <Progress
              value={
                preview.total
                  ? Math.min(100, (preview.loaded / preview.total) * 100)
                  : 0
              }
              aria-label="Decryption progress"
              className="mb-6 h-1.5"
            />
          </div>
        )}
        {preview.status === 'failed' && (
          <div className="w-full px-6">
            <PreviewPlaceholder
              role="alert"
              icon={ShieldAlert}
              title="This file could not be opened"
              titleAs="h2"
              description={preview.message}
            />
          </div>
        )}
        {preview.status === 'too-large' && (
          <div className="w-full px-6">
            <PreviewPlaceholder
              icon={FileDown}
              title="Too large to preview here"
              titleAs="h2"
              description={`An encrypted file is decrypted in your browser’s memory before it can be shown, so previews stop at ${formatBytes(rendering && rendering.renderer !== 'download' ? INLINE_PREVIEW_MAX_BYTES[rendering.renderer] : 0)}. Download this file to open it.`}
            />
          </div>
        )}
        {preview.status === 'pdf-unavailable' && (
          <div className="w-full px-6">
            <PreviewPlaceholder
              icon={FileDown}
              title="PDF preview is not available in this browser"
              titleAs="h2"
              description="A decrypted PDF is only shown inside an isolated frame, and this browser does not open PDFs there. Download the file to read it."
            />
          </div>
        )}
        {preview.status === 'download-only' && (
          <div className="w-full px-6">
            <PreviewPlaceholder
              icon={FileDown}
              title="Preview not available"
              titleAs="h2"
              description="Download this file to open it with an app on your device."
            >
              <code className="mt-1 max-w-full break-all rounded-md border border-border/60 bg-background/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {opened.type.slice(0, 120)}
              </code>
            </PreviewPlaceholder>
          </div>
        )}
        {view?.renderer === 'text' && (
          <TextView name={name} text={view.text} language={view.language} />
        )}
        {(view?.renderer === 'image' || view?.renderer === 'svg') && (
          <ImageViewer file={{ id: file.id, name }} src={view.src} />
        )}
        {view?.renderer === 'video' && (
          <VideoPlayer
            file={{ name, mimeType: view.type }}
            src={view.src}
            recover={view.src.startsWith('blob:') ? undefined : recover}
          />
        )}
        {view?.renderer === 'audio' && (
          <AudioViewer
            file={{ name, mimeType: view.type }}
            src={view.src}
            recover={view.src.startsWith('blob:') ? undefined : recover}
          />
        )}
        {view?.renderer === 'pdf' && (
          <div className="min-w-0 max-w-full">
            {/* The answer of a local address carries its own sandbox policy,
                and Chromium shows no PDF in a frame with the attribute. */}
            <PdfViewer name={name} src={view.src} sandboxed={!view.local} />
            <p className="px-6 pt-2 text-center text-xs text-muted-foreground">
              If the preview stays empty, download the file to read it.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-3 px-6 pb-4">
        <div
          className={cn(
            'grid w-screen max-w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:justify-center'
          )}
          role="group"
          aria-label="File actions"
        >
          <Button
            size="sm"
            onClick={() => void download()}
            disabled={saving}
            className={cn(buttonClassName, showCopyText && 'col-span-2')}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {saving ? 'Decrypting…' : 'Download'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyLink()}
            className={buttonClassName}
            aria-live="polite"
          >
            {copied ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <LinkIcon className="h-4 w-4" aria-hidden="true" />
            )}
            {copied ? 'Link copied' : 'Copy link'}
          </Button>
          {showCopyText && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void copyText()}
              className={buttonClassName}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy text
            </Button>
          )}
        </div>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          End-to-end encrypted. Decrypted in your browser.
        </p>
      </div>
    </div>
  )
}

function Status({ message }: { message: string }) {
  return (
    <div
      className="flex w-full items-center justify-center gap-3 p-8 text-center"
      role="status"
    >
      <Loader2
        className="h-4 w-4 shrink-0 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
