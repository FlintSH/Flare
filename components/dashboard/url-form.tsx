'use client'

import { useState } from 'react'

import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useToast } from '@/hooks/use-toast'

const urlSchema = z.object({
  url: z.string().url('Please enter a valid URL'),
})

interface URLFormProps {
  onUrlAdded?: () => void
}

export function URLForm({ onUrlAdded }: URLFormProps) {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const validatedData = urlSchema.parse({ url })

      const response = await fetch('/api/urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: validatedData.url }),
      })

      if (!response.ok) {
        throw new Error('Failed to create shortened URL')
      }

      await response.json()

      toast({
        title: 'URL shortened',
        description: 'Your shortened URL has been created',
      })

      setUrl('')

      onUrlAdded?.()
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({
          title: 'Invalid URL',
          description: error.errors[0].message,
          variant: 'destructive',
        })
      } else {
        toast({
          title: 'Error',
          description: 'Failed to create shortened URL',
          variant: 'destructive',
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="url">URL to shorten</Label>
        <div className="flex gap-2">
          <Input
            id="url"
            type="url"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            required
          />
          <Button type="submit" disabled={isLoading}>
            {isLoading ? 'Creating...' : 'Shorten'}
          </Button>
        </div>
      </div>
    </form>
  )
}
