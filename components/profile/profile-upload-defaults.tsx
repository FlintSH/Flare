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

import { type ProfilePatch, updateProfile } from '@/lib/client/account-request'

import { useToast } from '@/hooks/use-toast'

export function ProfileUploadDefaults({ user, onUpdate }: ProfileAccountProps) {
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [vanityId, setVanityId] = useState(user.vanityId || '')
  const [vanityError, setVanityError] = useState<string | null>(null)

  const handleValueChange = async (
    patch: ProfilePatch,
    description: string
  ) => {
    setIsLoading(true)
    try {
      await updateProfile(patch, 'Failed to update settings')

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
      <div className="rounded-xl border bg-muted/30 p-4">
        <div className="space-y-4">
          <div className="min-w-0 space-y-1">
            <Label htmlFor="vanity-url">Vanity URL</Label>
            <p className="text-pretty text-sm text-muted-foreground">
              Set a custom URL path for your uploads instead of the default ID.
              Your files will be accessible at{' '}
              {/* One chip: it moves to the next line whole, and only wraps
                  inside itself when it's longer than a line. */}
              <code className="inline-block max-w-full break-all rounded bg-muted px-1 py-0.5 text-xs">
                /{vanityId || user.urlId}/filename
              </code>
              .
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
            {/* A field's submit button is the filled default, like
                Shorten on Links. */}
            <Button
              type="button"
              disabled={isLoading || vanityId === (user.vanityId || '')}
              onClick={async () => {
                setIsLoading(true)
                setVanityError(null)
                try {
                  const newVanityId = vanityId.trim() || null
                  await updateProfile(
                    { vanityId: newVanityId },
                    'Failed to update vanity URL'
                  )
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
              {isLoading ? 'Saving…' : 'Save'}
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
                    await updateProfile(
                      { vanityId: null },
                      'Failed to remove vanity URL'
                    )
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

      <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 p-4">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor="randomize-urls">Randomize file URLs</Label>
          <p className="text-pretty text-sm text-muted-foreground">
            When enabled, new uploads use randomized URLs unless an upload
            profile or the upload form overrides this choice.
          </p>
        </div>
        <Switch
          id="randomize-urls"
          checked={user.randomizeFileUrls}
          onCheckedChange={(c) =>
            handleValueChange(
              { randomizeFileUrls: c },
              'File URL settings updated successfully'
            )
          }
          disabled={isLoading}
        />
      </div>

      <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="default-expiry-action">When files expire</Label>
          <p className="text-pretty text-sm text-muted-foreground">
            Set the default file expiry action when creating a new upload.
          </p>
        </div>
        <div className="w-full sm:w-48 sm:shrink-0">
          <Select
            disabled={isLoading}
            value={user.defaultFileExpirationAction ?? 'DELETE'}
            onValueChange={(v) =>
              handleValueChange(
                {
                  defaultFileExpirationAction:
                    v as ProfilePatch['defaultFileExpirationAction'],
                },
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

      <div className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-1">
          <Label htmlFor="default-expiry-time">Default expiration</Label>
          <p className="text-pretty text-sm text-muted-foreground">
            Set the default relative time before an upload expires.
          </p>
        </div>
        <div className="w-full sm:w-48 sm:shrink-0">
          <Select
            disabled={isLoading}
            value={user.defaultFileExpiration ?? 'DISABLED'}
            onValueChange={(v) =>
              handleValueChange(
                {
                  defaultFileExpiration:
                    v as ProfilePatch['defaultFileExpiration'],
                },
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
