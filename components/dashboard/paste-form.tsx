'use client'

import { useState } from 'react'

import Link from 'next/link'

import { AlertCircle, ArrowUpRight, Check, Copy, Loader2 } from 'lucide-react'

import {
  EncryptionChoice,
  type EncryptionMode,
} from '@/components/encryption/encryption-choice'
import {
  DERIVING_FILE_KEY,
  FilePasswordStrength,
  useFilePasswordStrength,
} from '@/components/encryption/file-password'
import {
  FilePasswordHint,
  filePasswordFieldProps,
} from '@/components/file/file-password-hint'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ProfilePicker } from '@/components/upload-profiles/profile-picker'

import { filePasswordHint } from '@/lib/files/password-policy'
import { allows } from '@/lib/permissions/actions'
import { uploadPaste } from '@/lib/uploads/client'

import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { useUploadLibrary } from '@/hooks/use-upload-library'
import { useUploadEncryption } from '@/hooks/use-upload-queue'

export function PasteForm() {
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('')
  const canShare = allows(usePermissions().user, 'shareFiles')
  const [visibility, setVisibility] = useState('inherit')
  const [profileId, setProfileId] = useState<string | null | undefined>(
    undefined
  )
  const [password, setPassword] = useState('')
  const [encryption, setEncryption] = useState<EncryptionMode>('encrypted')
  const encrypted = encryption === 'encrypted'
  const keys = useUploadEncryption()
  const libraryFor = useUploadLibrary()
  const passwordStrength = useFilePasswordStrength(password, encrypted)
  const passwordProblem = encrypted
    ? passwordStrength.problem
    : password
      ? filePasswordHint(password)
      : null
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{
    name: string
    pagePath: string
    url: string
  } | null>(null)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isSubmitting) return
    if (!content.trim()) {
      setError('Add some text or code before creating your paste.')
      return
    }
    if (passwordProblem) return
    if (encrypted && !keys.encryptFor) {
      setError('Unlock your encryption keys to create an encrypted paste.')
      return
    }
    setIsSubmitting(true)
    setError('')

    try {
      const file = new File([content], filename.trim() || 'paste.txt', {
        type: 'text/plain',
      })
      const paste = await uploadPaste(file, {
        profileId,
        visibility: !canShare
          ? 'PRIVATE'
          : visibility === 'PUBLIC' || visibility === 'PRIVATE'
            ? visibility
            : undefined,
        password,
        encryptFor: encrypted ? keys.encryptFor : undefined,
        // The tag rules of the owner run in this browser on the name.
        library: {
          ...libraryFor({}),
          // A paste is text: no thumbnail can be made for it.
          thumbnail: async () => null,
        },
      })
      const url = paste.pageUrl || paste.url
      setCreated({
        name: file.name,
        pagePath: new URL(url, window.location.origin).pathname,
        url,
      })
      toast({
        title: 'Paste created',
        description: 'Your text is saved and ready to share.',
      })
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not create your paste. Your text is still here; please try again.'
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const copyLink = async () => {
    if (!created?.url) return
    try {
      await navigator.clipboard.writeText(created.url)
      setCopied(true)
      toast({ title: 'Link copied' })
    } catch {
      toast({
        title: 'Could not copy link',
        description: 'Open the paste to copy its address.',
        variant: 'destructive',
      })
    }
  }

  if (created) {
    return (
      <div className="space-y-4">
        <p
          role="status"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Check className="h-4 w-4 text-primary" />
          Paste created: <span className="truncate">{created.name}</span>
        </p>
        {created.url && (
          <div className="space-y-2">
            <Label htmlFor="paste-created-link">Share link</Label>
            <Input
              id="paste-created-link"
              readOnly
              value={created.url}
              onFocus={(event) => event.target.select()}
              className="font-mono text-sm"
            />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {created.url && (
            <Button onClick={copyLink}>
              {copied ? (
                <Check className="h-4 w-4" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={created.pagePath}>
              Open paste
              <ArrowUpRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setCreated(null)
              setContent('')
              setFilename('')
              setPassword('')
              setCopied(false)
            }}
          >
            Create another paste
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <ProfilePicker
        value={profileId}
        onChange={setProfileId}
        disabled={isSubmitting}
      />
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="content">Content</Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            {/* One locale, so the server's markup matches the browser's. */}
            {content.length.toLocaleString('en-US')} characters
          </span>
        </div>
        <Textarea
          id="content"
          placeholder="Enter your text or code…"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          className="min-h-[300px] resize-y font-mono text-sm leading-6"
          spellCheck={false}
          required
          disabled={isSubmitting}
          aria-describedby={error ? 'paste-error' : undefined}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="filename">
            Filename{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="filename"
            placeholder="paste.txt"
            value={filename}
            onChange={(event) => setFilename(event.target.value)}
            disabled={isSubmitting}
            aria-describedby="filename-help"
          />
          <p
            id="filename-help"
            className="text-pretty text-xs text-muted-foreground"
          >
            Add an extension such as .js, .py, or .md for syntax highlighting.
          </p>
        </div>
        {canShare && (
          <div className="space-y-2">
            <Label htmlFor="paste-visibility">Visibility</Label>
            <Select
              value={visibility}
              onValueChange={setVisibility}
              disabled={isSubmitting}
            >
              <SelectTrigger id="paste-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">From upload profile</SelectItem>
                <SelectItem value="PUBLIC">
                  Public (anyone with the link)
                </SelectItem>
                <SelectItem value="PRIVATE">Private (only me)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {canShare && (
        <div className="space-y-2">
          <Label htmlFor="paste-password">
            Password protection{' '}
            <span className="font-normal text-muted-foreground">
              (optional)
            </span>
          </Label>
          <Input
            id="paste-password"
            type="password"
            autoComplete="new-password"
            placeholder="Leave empty for no password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={isSubmitting}
            {...(encrypted
              ? {
                  'aria-invalid': Boolean(
                    password && passwordStrength.strength?.acceptable === false
                  ),
                  'aria-describedby': 'paste-password-hint',
                }
              : filePasswordFieldProps('paste-password-hint', password))}
          />
          {encrypted ? (
            <FilePasswordStrength
              id="paste-password-hint"
              password={password}
              strength={passwordStrength.strength}
              failed={passwordStrength.failed}
              empty="With a password, the link alone does not open the paste. Flare never receives the password."
            />
          ) : (
            <FilePasswordHint id="paste-password-hint" password={password} />
          )}
        </div>
      )}
      <EncryptionChoice
        value={encryption}
        onChange={setEncryption}
        disabled={isSubmitting}
        locked={keys.locked}
        noun="paste"
      />
      {error && (
        <Alert id="paste-error" variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={
          isSubmitting ||
          !content.trim() ||
          Boolean(passwordProblem) ||
          (encrypted && !keys.encryptFor)
        }
      >
        {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
        {isSubmitting
          ? encrypted && password
            ? DERIVING_FILE_KEY
            : 'Creating paste…'
          : 'Create paste'}
      </Button>
    </form>
  )
}
