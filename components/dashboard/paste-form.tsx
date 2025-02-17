'use client'

import { useState } from 'react'

import { useRouter } from 'next/navigation'

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

import { useToast } from '@/hooks/use-toast'

export function PasteForm() {
  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('')
  const [visibility, setVisibility] = useState('PUBLIC')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!content.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter some content',
        variant: 'destructive',
      })
      return
    }

    setIsSubmitting(true)

    try {
      // Create a text file from the content
      const file = new File([content], filename || 'paste.txt', {
        type: 'text/plain',
      })

      const formData = new FormData()
      formData.append('file', file)
      formData.append('visibility', visibility)
      if (password) formData.append('password', password)

      const response = await fetch('/api/files', {
        method: 'POST',
        body: formData,
      })

      if (!response.ok) {
        throw new Error('Failed to create paste')
      }

      const responseData = await response.json()

      toast({
        title: 'Success',
        description: 'Paste created successfully',
      })

      // Extract the path from the full URL and redirect to it
      const urlPath = new URL(responseData.url).pathname
      router.push(urlPath)
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to create paste',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          placeholder="Enter your text here..."
          value={content}
          onChange={(e) => setContent(e.target.value)}
          className="min-h-[300px] font-mono"
          required
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="filename">Filename (Optional)</Label>
          <Input
            id="filename"
            placeholder="paste.txt"
            value={filename}
            onChange={(e) => setFilename(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Visibility</Label>
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Public</SelectItem>
              <SelectItem value="PRIVATE">Private (only me)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password Protection (Optional)</Label>
        <Input
          id="password"
          type="password"
          placeholder="Leave empty for no password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Creating paste...' : 'Create Paste'}
      </Button>
    </form>
  )
}
