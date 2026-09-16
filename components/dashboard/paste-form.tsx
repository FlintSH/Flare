'use client'

import { useState } from 'react'

import Link from 'next/link'

import { ArrowUpRight, Check, Copy, Loader2 } from 'lucide-react'

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
        url: data?.pageUrl || data?.url || '',
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
            {content.length.toLocaleString()} characters
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
          <p id="filename-help" className="text-xs text-muted-foreground">
            Add an extension such as .js, .py, or .md for syntax highlighting.
          </p>
        </div>
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
      </div>
      <div className="space-y-2">
        <Label htmlFor="paste-password">
          Password protection{' '}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id="paste-password"
          type="password"
          autoComplete="new-password"
          placeholder="Leave empty for no password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          disabled={isSubmitting}
        />
      </div>
      {error && (
        <p
          id="paste-error"
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={isSubmitting || !content.trim()}
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {isSubmitting ? 'Creating paste…' : 'Create Paste'}
      </Button>
    </form>
  )
}
