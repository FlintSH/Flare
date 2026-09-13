'use client'

import { useState } from 'react'

import { CreateUrlSchema } from '@/types/dto/url'
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
} from 'lucide-react'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useToast } from '@/hooks/use-toast'

interface URLFormProps {
  createdUrl: string
  onUrlAdded: (shortCode?: string) => void
}

export function URLForm({ createdUrl, onUrlAdded }: URLFormProps) {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (isLoading) return
    setIsLoading(true)
    setError('')

    try {
      const validatedData = CreateUrlSchema.parse({ url: url.trim() })
      const response = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validatedData.url }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok)
        throw new Error(
          data?.error || 'Could not create a short link. Please try again.'
        )
      setCopied(false)
      setUrl('')
      toast({
        title: 'Short link created',
        description: 'Your link is ready to share.',
      })
      onUrlAdded(data?.data?.shortCode)
    } catch (failure) {
      setError(
        failure instanceof z.ZodError
          ? failure.errors[0].message
          : failure instanceof Error
            ? failure.message
            : 'Could not create a short link. Please try again.'
      )
    } finally {
      setIsLoading(false)
    }
  }

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(createdUrl)
      setCopied(true)
      toast({ title: 'Link copied' })
    } catch {
      toast({
        title: 'Could not copy link',
        description: 'Select the link above and copy it manually.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-2">
        <Label htmlFor="url">Destination URL</Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            id="url"
            type="url"
            placeholder="https://example.com/something-worth-sharing"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            required
            disabled={isLoading}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'url-error' : 'url-help'}
            className="h-11 min-w-0 flex-1"
          />
          <Button
            type="submit"
            disabled={isLoading || !url.trim()}
            className="h-11 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-2 h-4 w-4" />
            )}
            {isLoading ? 'Creating…' : 'Create short link'}
          </Button>
        </div>
        {error ? (
          <p
            id="url-error"
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-foreground"
          >
            {error}
          </p>
        ) : (
          <p id="url-help" className="text-xs text-muted-foreground">
            Use a complete web address starting with https:// or http://.
          </p>
        )}
      </form>
      {createdUrl && (
        <div
          role="status"
          className="rounded-xl border border-primary/20 bg-primary/5 p-4"
        >
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Your short link is ready
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Input
              aria-label="New short link"
              readOnly
              value={createdUrl}
              onFocus={(event) => event.target.select()}
              className="min-w-0 flex-1 bg-background font-mono text-sm"
            />
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={copyLink}
                variant="outline"
                className="flex-1 sm:flex-initial"
              >
                {copied ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
              <Button asChild variant="ghost">
                <a href={createdUrl} target="_blank" rel="noopener noreferrer">
                  Open
                  <ArrowUpRight className="ml-2 h-4 w-4" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
