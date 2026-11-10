'use client'

import { createContext, useContext, useState } from 'react'

import { Check, Copy, KeyRound, ShieldCheck, ShieldOff } from 'lucide-react'

import { UnlockDialog } from '@/components/encryption/unlock-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useUploadProfiles } from '@/components/upload-profiles/profile-picker'

import { RefusedRequest, apiRequest } from '@/lib/client/request'
import { CONNECTION_NAME_MAX_LENGTH } from '@/lib/integrations/limits'
import { allows } from '@/lib/permissions/actions'
import { UPLOAD_DEFAULTS, type UploadEncryption } from '@/lib/uploads/schema'
import {
  type UploaderConfiguration,
  folderPublicKeyForConfiguration,
} from '@/lib/uploads/uploader-clients/render'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'
import { useToast } from '@/hooks/use-toast'
import { useUploadEncryption } from '@/hooks/use-upload-queue'

/**
 * The configuration that the tool rows write their files from. It exists
 * only in this page: Flare shows the token one time and stores its hash.
 */
const UploaderConfigurationContext =
  createContext<UploaderConfiguration | null>(null)

export const UploaderConfigurationProvider =
  UploaderConfigurationContext.Provider

export function useUploaderConfiguration() {
  return useContext(UploaderConfigurationContext)
}

const DEFAULT_PROFILE = 'default'
const NO_FOLDER = 'none'

export function EncryptionBadge({
  encryption,
}: {
  encryption: UploadEncryption
}) {
  const Icon = encryption === 'encrypted' ? ShieldCheck : ShieldOff
  return (
    <Badge
      variant={encryption === 'encrypted' ? 'success' : 'warning'}
      className="gap-1 whitespace-nowrap"
      data-configuration-encryption={encryption}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {encryption === 'encrypted' ? 'Encrypted' : 'Plain'}
    </Badge>
  )
}

/**
 * Makes a configuration: a new token bound to the selected upload profile,
 * the public address of the server, and the account public key of the keys
 * that are unlocked in this browser (docs/e2ee-spec.md, section 10.2).
 */
export function ConfigurationPanel({
  origin,
  configuration,
  onChange,
}: {
  origin: string | null
  configuration: UploaderConfiguration | null
  onChange: (configuration: UploaderConfiguration | null) => void
}) {
  const { user } = usePermissions()
  const { data, error } = useUploadProfiles()
  const { folders } = useFolders()
  const keys = useUploadEncryption()
  const { toast } = useToast()
  const [profileId, setProfileId] = useState(DEFAULT_PROFILE)
  const [folderId, setFolderId] = useState(NO_FOLDER)
  const [creating, setCreating] = useState(false)
  const [unlocking, setUnlocking] = useState(false)
  const [copied, setCopied] = useState(false)

  const followsDefault = profileId === DEFAULT_PROFILE
  const selected = followsDefault
    ? data?.profiles.find((profile) => profile.id === data.defaultProfileId)
    : data?.profiles.find((profile) => profile.id === profileId)
  const effective = {
    ...UPLOAD_DEFAULTS,
    ...data?.accountOptions,
    ...selected?.options,
  }
  const encryption = effective.encryption
  const canUseFolders = allows(user, 'fileIntoFolder') && folders.length > 0
  const locked = encryption === 'encrypted' && !keys.encryptFor
  // A configuration for a plain profile could not upload anything here.
  const plainForbidden =
    encryption === 'plain' && data?.plainUploadsForbidden === true

  async function create() {
    if (!origin || !data) return
    if (encryption === 'encrypted' && !keys.encryptFor) {
      setUnlocking(true)
      return
    }
    setCreating(true)
    try {
      // A token that follows the default profile is not bound to it, so it
      // keeps following the default when the user selects a different one.
      const bound = followsDefault ? null : (selected ?? null)
      const label = bound?.name ?? 'default profile'
      const created = await apiRequest<{ secret: string }>(
        '/api/integrations',
        {
          body: {
            action: 'create-token',
            name: `Upload tools: ${label}`.slice(0, CONNECTION_NAME_MAX_LENGTH),
            scopes: ['files:upload'],
            profileId: bound?.id ?? null,
          },
          fallback: 'Could not create the configuration.',
        }
      )
      const folder = folders.find((entry) => entry.id === folderId)
      onChange({
        origin,
        token: created.secret,
        profile: bound ? { id: bound.id, name: bound.name } : null,
        encryption,
        // From the unlocked keys of this browser, never from the server.
        accountPublicKey:
          encryption === 'encrypted' ? (keys.encryptFor ?? null) : null,
        folder: folder
          ? {
              id: folder.id,
              publicKey: folderPublicKeyForConfiguration(folder),
              visibility: allows(user, 'shareFiles')
                ? effective.visibility
                : 'PRIVATE',
            }
          : null,
      })
      setCopied(false)
    } catch (failure) {
      toast({
        title: 'Could not create the configuration',
        description:
          failure instanceof RefusedRequest
            ? failure.message
            : 'Check your connection and try again.',
        variant: 'destructive',
      })
    } finally {
      setCreating(false)
    }
  }

  async function copyToken() {
    if (!configuration) return
    try {
      await navigator.clipboard.writeText(configuration.token)
      setCopied(true)
    } catch {
      toast({
        title: 'Could not copy the token',
        description: 'Download a configuration file instead.',
        variant: 'destructive',
      })
    }
  }

  if (configuration)
    return (
      <div
        className="space-y-3 rounded-xl border border-primary/30 bg-primary/5 p-4"
        data-upload-configuration="ready"
      >
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <KeyRound
            className="h-4 w-4 shrink-0 text-primary"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 basis-56 text-sm font-medium">
            Configuration ready for{' '}
            {configuration.profile
              ? configuration.profile.name
              : 'your default profile'}
          </p>
          <EncryptionBadge encryption={configuration.encryption} />
        </div>
        <p className="text-pretty text-sm text-muted-foreground">
          Download what your tools need below. Each file holds the new upload
          token, which Flare shows only now: leave this page and you need a new
          configuration. Keep the files private.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void copyToken()}>
            {copied ? <Check /> : <Copy />}
            {copied ? 'Token copied' : 'Copy token'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
            Create another
          </Button>
        </div>
      </div>
    )

  return (
    <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="tool-profile">Upload profile</Label>
          <Select value={profileId} onValueChange={setProfileId}>
            <SelectTrigger id="tool-profile">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_PROFILE}>
                Follow my default profile
              </SelectItem>
              {data?.profiles.map((profile) => (
                <SelectItem key={profile.id} value={profile.id}>
                  {profile.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canUseFolders && (
          <div className="space-y-2">
            <Label htmlFor="tool-folder">Folder</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="tool-folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FOLDER}>No folder</SelectItem>
                {folders.map((folder) => (
                  <SelectItem key={folder.id} value={folder.id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <EncryptionBadge encryption={encryption} />
        <p className="min-w-0 flex-1 basis-56 text-pretty text-xs leading-relaxed text-muted-foreground">
          {plainForbidden
            ? 'This profile takes plain uploads, and plain uploads are turned off on this server. Set the profile to Encrypted, or choose another profile.'
            : encryption === 'encrypted'
              ? 'This profile takes encrypted uploads. Your tools encrypt each file with the flare-upload program before it leaves your machine.'
              : 'This profile takes plain uploads. The server can read each file, and links can show a preview on other sites.'}
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void create()}
          disabled={creating || !origin || !data || plainForbidden}
        >
          {creating ? 'Creating…' : 'Create configuration'}
        </Button>
        {locked && !keys.loading && (
          <p className="min-w-0 flex-1 basis-48 text-xs text-muted-foreground">
            Unlock your encryption keys first. The configuration pins the public
            key of your account from this browser.
          </p>
        )}
      </div>
      <UnlockDialog open={unlocking} onOpenChange={setUnlocking} />
    </div>
  )
}
