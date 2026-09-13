'use client'

import { useState } from 'react'

import Link from 'next/link'

import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  FileCode2,
  Loader2,
  Plus,
  ShieldCheck,
} from 'lucide-react'

import {
  WorkspaceNote,
  WorkspacePanel,
} from '@/components/dashboard/page-shell'
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

import { useToast } from '@/hooks/use-toast'

export function PasteForm() {
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('')
  const [visibility, setVisibility] = useState('inherit')
  const [profileId, setProfileId] = useState<string | null | undefined>(
    undefined
  )
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [created, setCreated] = useState<{
    name: string
    pagePath: string
    copyText: string
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
    setIsSubmitting(true)
    setError('')

    try {
      const file = new File([content], filename.trim() || 'paste.txt', {
        type: 'text/plain',
      })
      const formData = new FormData()
      formData.append('file', file)
      if (visibility !== 'inherit') formData.append('visibility', visibility)
      if (password) formData.append('password', password)

      const response = await fetch('/api/files', {
        method: 'POST',
        headers:
          profileId !== undefined
            ? { 'X-Upload-Profile': profileId ?? 'none' }
            : undefined,
        body: formData,
      })
      const responseData = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(
          responseData?.error ||
            responseData?.message ||
            'Could not create your paste. Please try again.'
        )
      }

      const data = responseData?.data
      const pagePath = data?.pageUrl || data?.url
      setCreated({
        name: file.name,
        pagePath: pagePath
          ? new URL(pagePath, window.location.origin).pathname
          : '/dashboard',
        copyText: data?.copyText || data?.url || '',
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
    if (!created?.copyText) return
    try {
      await navigator.clipboard.writeText(created.copyText)
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
      <WorkspacePanel className="mx-auto max-w-3xl">
        <div className="flex flex-col items-center px-2 py-6 text-center sm:px-8 sm:py-10">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CheckCircle2 className="h-7 w-7" />
          </span>
          <h2 className="mt-5 text-2xl font-semibold tracking-tight">
            Your paste is ready
          </h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            <span className="break-all font-medium text-foreground">
              {created.name}
            </span>{' '}
            is saved in your file library. Open it to preview your text or share
            its link.
          </p>
          {created.copyText && (
            <div className="mt-6 w-full text-left">
              <Label htmlFor="paste-created-link">Share link</Label>
              <Input
                id="paste-created-link"
                readOnly
                value={created.copyText}
                onFocus={(event) => event.target.select()}
                className="mt-2 bg-muted/30 font-mono text-xs"
              />
            </div>
          )}
          <div className="mt-5 flex w-full flex-col justify-center gap-3 sm:flex-row">
            {created.copyText && (
              <Button onClick={copyLink}>
                {copied ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={created.pagePath}>
                Open paste
                <ArrowUpRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
          <div className="mt-8 w-full border-t pt-6">
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
              <Plus className="mr-2 h-4 w-4" />
              Create another paste
            </Button>
          </div>
        </div>
      </WorkspacePanel>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]"
    >
      <div className="min-w-0 space-y-6">
        <WorkspacePanel
          title="Write or paste your content"
          description="Share a snippet, a document, or a quick note. Everything stays together as a file."
        >
          <div className="space-y-5">
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
              <p id="filename-help" className="text-xs text-muted-foreground">
                Use a file extension such as .js, .py, or .md for syntax
                highlighting.
              </p>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="content">Content</Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {content.length.toLocaleString()} characters ·{' '}
                  {content ? content.split('\n').length : 0} lines
                </span>
              </div>
              <Textarea
                id="content"
                placeholder="Paste your code or write something worth sharing…"
                value={content}
                onChange={(event) => setContent(event.target.value)}
                className="min-h-[380px] resize-y rounded-xl bg-muted/20 p-4 font-mono text-sm leading-6 sm:min-h-[440px]"
                spellCheck={false}
                required
                disabled={isSubmitting}
                aria-describedby={error ? 'paste-error' : undefined}
              />
            </div>
            {error && (
              <p
                id="paste-error"
                role="alert"
                className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>
        </WorkspacePanel>
        <WorkspaceNote icon={FileCode2} title="A paste is a file, too">
          Find pastes alongside your uploads in the file library. The filename
          determines how your code is highlighted when someone opens it.
        </WorkspaceNote>
      </div>

      <WorkspacePanel
        title="Sharing & access"
        description="Choose your defaults before creating a shareable link."
        className="xl:sticky xl:top-24"
      >
        <div className="space-y-5">
          <ProfilePicker
            value={profileId}
            onChange={setProfileId}
            disabled={isSubmitting}
          />
          <div className="space-y-2 border-t pt-5">
            <Label htmlFor="paste-visibility">Who can open this paste?</Label>
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
                <SelectItem value="PUBLIC">Anyone with the link</SelectItem>
                <SelectItem value="PRIVATE">Only me</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Private pastes are only accessible while signed in to your
              account.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paste-password">
              Password{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id="paste-password"
              type="password"
              autoComplete="new-password"
              placeholder="Add a password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Share this password separately from your paste link.
            </p>
          </div>
          <div className="flex items-start gap-2 rounded-xl border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Your upload profile also controls expiration and link formatting.
          </div>
          <div className="border-t pt-5">
            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isSubmitting || !content.trim()}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="mr-2 h-4 w-4" />
              )}
              {isSubmitting ? 'Creating paste…' : 'Create paste'}
            </Button>
            <p className="mt-3 text-center text-xs text-muted-foreground">
              {content.trim()
                ? 'Your link will be ready as soon as you create it.'
                : 'Add your content to get started.'}
            </p>
          </div>
        </div>
      </WorkspacePanel>
    </form>
  )
}
