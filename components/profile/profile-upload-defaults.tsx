'use client'

import { useState } from 'react'

import { ProfileAccountProps } from '@/types/components/profile'

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
import { Switch } from '@/components/ui/switch'

import { useToast } from '@/hooks/use-toast'

export function ProfileUploadDefaults({ user, onUpdate }: ProfileAccountProps) {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [vanityId, setVanityId] = useState(user.vanityId || '')
  const [vanityError, setVanityError] = useState<string | null>(null)

  const handleValueChange = async (
    value: boolean | string,
    key: string,
    description: string
  ) => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          [key]: value,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update settings')
      }

      onUpdate()

      toast({
        title: 'Success',
        description: description,
      })
    } catch (error) {
      toast({
        title: 'Error',
        description:
          error instanceof Error ? error.message : 'Failed to update settings',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-background/40 p-4 sm:p-5">
        <div className="space-y-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="vanity-url">Vanity URL</Label>
            <p className="text-sm text-muted-foreground">
              Set a custom URL path for your uploads instead of the default ID.
              Your files will be accessible at{' '}
              <code className="break-all text-xs bg-muted px-1 py-0.5 rounded">
                /{vanityId || user.urlId}/filename
              </code>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <Input
                id="vanity-url"
                value={vanityId}
                onChange={(e) => {
                  const value = e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9-]/g, '')
                  setVanityId(value)
                  setVanityError(null)
                }}
                placeholder={`e.g. ${user.name?.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'my-name'}`}
                maxLength={32}
                disabled={isLoading}
              />
              {vanityError && (
                <p className="text-sm text-destructive mt-1">{vanityError}</p>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isLoading || vanityId === (user.vanityId || '')}
              onClick={async () => {
                setIsLoading(true)
                setVanityError(null)
                try {
                  const newVanityId = vanityId.trim() || null
                  const response = await fetch('/api/profile', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ vanityId: newVanityId }),
                  })
                  if (!response.ok) {
                    const data = await response.json()
                    setVanityError(data.error || 'Failed to update vanity URL')
                    return
                  }
                  onUpdate()
                  toast({
                    title: 'Success',
                    description: newVanityId
                      ? 'Vanity URL updated successfully'
                      : 'Vanity URL removed',
                  })
                } catch (error) {
                  setVanityError(
                    error instanceof Error
                      ? error.message
                      : 'Failed to update vanity URL'
                  )
                } finally {
                  setIsLoading(false)
                }
              }}
            >
              {isLoading ? 'Saving...' : 'Save'}
            </Button>
            {user.vanityId && (
              <Button
                type="button"
                variant="ghost"
                disabled={isLoading}
                onClick={async () => {
                  setIsLoading(true)
                  setVanityError(null)
                  try {
                    const response = await fetch('/api/profile', {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ vanityId: null }),
                    })
                    if (!response.ok) {
                      const data = await response.json()
                      setVanityError(
                        data.error || 'Failed to remove vanity URL'
                      )
                      return
                    }
                    setVanityId('')
                    onUpdate()
                    toast({
                      title: 'Success',
                      description: 'Vanity URL removed',
                    })
                  } catch (error) {
                    setVanityError(
                      error instanceof Error
                        ? error.message
                        : 'Failed to remove vanity URL'
                    )
                  } finally {
                    setIsLoading(false)
                  }
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="randomize-urls">Randomize File URLs</Label>
          <p className="text-sm text-muted-foreground">
            When enabled, new uploads use randomized URLs unless an upload
            profile or the upload form overrides this choice.
          </p>
        </div>
        <Switch
          id="randomize-urls"
          checked={user.randomizeFileUrls}
          onCheckedChange={(c) =>
            handleValueChange(
              c,
              'randomizeFileUrls',
              'File URL settings updated successfully'
            )
          }
          disabled={isLoading}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="default-expiry-action">When files expire</Label>
          <p className="text-sm text-muted-foreground">
            Set the default file expiry action when creating a new upload
          </p>
        </div>
        <div className="w-full sm:w-48 sm:shrink-0">
          <Select
            disabled={isLoading}
            value={user.defaultFileExpirationAction ?? 'DELETE'}
            onValueChange={(v) =>
              handleValueChange(
                v,
                'defaultFileExpirationAction',
                'Default file expiration action updated successfully'
              )
            }
          >
            <SelectTrigger id="default-expiry-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DELETE">Delete file</SelectItem>
              <SelectItem value="SET_PRIVATE">Set to private</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-background/40 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="default-expiry-time">Default expiration</Label>
          <p className="text-sm text-muted-foreground">
            Set the default relative time before an upload expires
          </p>
        </div>
        <div className="w-full sm:w-48 sm:shrink-0">
          <Select
            disabled={isLoading}
            value={user.defaultFileExpiration ?? 'DISABLED'}
            onValueChange={(v) =>
              handleValueChange(
                v,
                'defaultFileExpiration',
                'Default file expiration time updated successfully'
              )
            }
          >
            <SelectTrigger id="default-expiry-time">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="DISABLED">Disabled</SelectItem>
              <SelectItem value="HOUR">One hour</SelectItem>
              <SelectItem value="DAY">One day</SelectItem>
              <SelectItem value="WEEK">One week</SelectItem>
              <SelectItem value="MONTH">One month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
