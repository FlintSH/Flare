'use client'

import { type FormEvent, useState } from 'react'

import { Check, Copy, ExternalLink, Share2 } from 'lucide-react'

import { MetaLine } from '@/components/profile/meta-line'
import {
  formDialogBodyClassName,
  formDialogClassName,
  formDialogFooterClassName,
} from '@/components/settings/form-styles'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { useUploadProfiles } from '@/components/upload-profiles/profile-picker'

import {
  FILE_REQUEST_EXPIRY_OPTIONS,
  FILE_REQUEST_MESSAGE_MAX,
  FILE_REQUEST_TITLE_MAX,
  type FileRequestPolicyView,
  type FileRequestView,
  SENDER_NAME_LABELS,
  SENDER_NAME_MODES,
  type SenderNameMode,
} from '@/lib/file-requests/policy'
import { folderPath } from '@/lib/folders/navigation'
import {
  UPLOAD_DEFAULTS,
  type UploadProfileOptions,
} from '@/lib/uploads/schema'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { useFolders } from '@/hooks/use-folders'
import { usePermissions } from '@/hooks/use-permissions'

import { absolute, jsonBody, requestJson, requestLink } from './shared'

const GB = 1024 ** 3
const MB = 1024 ** 2

function sizeFields(bytes: number | null) {
  if (bytes === null) return { value: '', unit: 'GB' }
  return bytes % GB === 0
    ? { value: String(bytes / GB), unit: 'GB' }
    : { value: String(Math.round(bytes / MB)), unit: 'MB' }
}

/** What received files get, in the words the upload form uses. */
function receivedSummary(options: Required<UploadProfileOptions>) {
  const expires =
    options.expiration === 'DISABLED' || options.expiryAction === 'SET_PRIVATE'
      ? 'kept until you delete them'
      : `deleted after ${{ HOUR: '1 hour', DAY: '1 day', WEEK: '1 week', MONTH: '1 month' }[options.expiration]}`
  const tags = options.tagIds.length
  return `Received files arrive private and are ${expires}. ${options.randomizeFileUrls ? 'Random' : 'Original'} filenames${tags ? ` · ${tags} ${tags === 1 ? 'tag' : 'tags'}` : ''}.`
}

export function RequestFormDialog({
  open,
  onOpenChange,
  policy,
  editing,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy: FileRequestPolicyView
  /** Edit this request instead of creating one. */
  editing?: FileRequestView | null
  onSaved: (request: FileRequestView) => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
      }}
    >
      {open && (
        <RequestForm
          key={editing?.id ?? 'new'}
          policy={policy}
          editing={editing ?? null}
          onClose={() => onOpenChange(false)}
          onSaved={onSaved}
        />
      )}
    </Dialog>
  )
}

function RequestForm({
  policy,
  editing,
  onClose,
  onSaved,
}: {
  policy: FileRequestPolicyView
  editing: FileRequestView | null
  onClose: () => void
  onSaved: (request: FileRequestView) => void
}) {
  const { can } = usePermissions()
  const profiles = useUploadProfiles()
  const { folders, loading: foldersLoading } = useFolders()
  const initialSize = sizeFields(editing?.maxBytes ?? null)
  const [title, setTitle] = useState(editing?.title ?? '')
  const [message, setMessage] = useState(editing?.message ?? '')
  const [profileId, setProfileId] = useState(editing?.profile?.id ?? 'default')
  const [folderId, setFolderId] = useState(editing?.folder?.id ?? 'unfiled')
  const [senderName, setSenderName] = useState<SenderNameMode>(
    editing?.senderName ?? 'optional'
  )
  // Editing keeps the current deadline unless a new one is chosen.
  const [expiry, setExpiry] = useState(editing ? 'keep' : '168')
  const [maxFiles, setMaxFiles] = useState(
    editing?.maxFiles === null || editing?.maxFiles === undefined
      ? ''
      : String(editing.maxFiles)
  )
  const [maxSize, setMaxSize] = useState(initialSize.value)
  const [sizeUnit, setSizeUnit] = useState(initialSize.unit)
  const [notify, setNotify] = useState(editing?.notify ?? false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<FileRequestView | null>(null)
  const [copied, setCopied] = useState(false)

  const data = profiles.data
  const selectedProfile = data?.profiles.find((entry) => entry.id === profileId)
  const defaultProfile = data?.profiles.find(
    (entry) => entry.id === data.defaultProfileId
  )
  const effective =
    profileId === 'default'
      ? data?.effective
      : selectedProfile
        ? {
            ...UPLOAD_DEFAULTS,
            ...data?.accountOptions,
            ...selectedProfile.options,
          }
        : undefined
  const canUseFolders = can('folders.manage')
  // Without folder access, a request that still saves to a folder can only
  // move to Unfiled.
  const showFolders =
    (canUseFolders && folders.length > 0) || folderId !== 'unfiled'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const files = maxFiles.trim() ? Number(maxFiles) : null
    const size = maxSize.trim() ? Number(maxSize) : null
    if (files !== null && (!Number.isInteger(files) || files < 1)) {
      setError('Enter a whole number of files, or leave it empty.')
      return
    }
    if (size !== null && (!Number.isFinite(size) || size <= 0)) {
      setError('Enter a total size, or leave it empty.')
      return
    }
    setSaving(true)
    setError('')
    const body = {
      title,
      message,
      senderName,
      // Edits send a destination only when it changes, so an unrelated edit
      // never fails on a profile or folder the owner can no longer use.
      ...(!editing ||
      (profileId === 'default' ? null : profileId) !==
        (editing.profile?.id ?? null)
        ? { profileId: profileId === 'default' ? null : profileId }
        : {}),
      ...(!editing ||
      (folderId === 'unfiled' ? null : folderId) !==
        (editing.folder?.id ?? null)
        ? { folderId: folderId === 'unfiled' ? null : folderId }
        : {}),
      maxFiles: files,
      maxBytes:
        size === null ? null : Math.round(size * (sizeUnit === 'GB' ? GB : MB)),
      // Without email, keep a saved choice rather than silently clearing it.
      ...(policy.canNotify ? { notify } : editing ? {} : { notify: false }),
      ...(expiry !== 'keep' && {
        expiresInHours: expiry === 'never' ? null : Number(expiry),
      }),
    }
    try {
      const result = await requestJson<{ request: FileRequestView }>(
        editing
          ? `/api/file-requests/${encodeURIComponent(editing.id)}`
          : '/api/file-requests',
        jsonBody(editing ? 'PATCH' : 'POST', body)
      )
      onSaved(result.request)
      if (editing) onClose()
      else setCreated(result.request)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'The request could not be saved.'
      )
    } finally {
      setSaving(false)
    }
  }

  if (created) {
    const link = requestLink(created)
    return (
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your request link is ready</DialogTitle>
          <DialogDescription>
            Send it to the people you need files from. They don’t need an
            account, and you can copy the link again from Requests.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label htmlFor="created-request-link">Request link</Label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id="created-request-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button
              className="shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link)
                  setCopied(true)
                } catch {
                  setError(
                    'Your browser blocked clipboard access. Select and copy it.'
                  )
                }
              }}
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy link'}
            </Button>
          </div>
          <MetaLine
            className="text-sm text-muted-foreground"
            items={[
              {
                key: 'expires',
                text: created.expiresAt
                  ? `Closes ${absolute(created.expiresAt)}`
                  : 'No deadline',
              },
              {
                key: 'destination',
                text: `Saves to ${created.folder?.name ?? 'Unfiled'}`,
              },
            ]}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          {typeof navigator !== 'undefined' &&
            typeof navigator.share === 'function' && (
              <Button
                variant="outline"
                onClick={() =>
                  void navigator
                    .share({ title: created.title, url: link })
                    .catch(() => {})
                }
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
                Share…
              </Button>
            )}
          <Button variant="outline" asChild>
            <a href={link} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              Preview
            </a>
          </Button>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    )
  }

  return (
    <DialogContent className={formDialogClassName}>
      <DialogHeader className="shrink-0">
        <DialogTitle>
          {editing ? 'Edit file request' : 'New file request'}
        </DialogTitle>
        <DialogDescription>
          {editing
            ? 'Changes apply to the next files people send.'
            : 'Anyone with the link can send you files, even without an account.'}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div ref={scrollFadeRef} className={formDialogBodyClassName}>
          <div className="space-y-2">
            <Label htmlFor="request-title">What are you asking for?</Label>
            <Input
              id="request-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={FILE_REQUEST_TITLE_MAX}
              placeholder="Photos from Saturday"
              autoComplete="off"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="request-message">
              Message for senders{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Textarea
              id="request-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={FILE_REQUEST_MESSAGE_MAX}
              placeholder="What to send, and anything they should know."
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="request-profile">Upload profile</Label>
            <Select value={profileId} onValueChange={setProfileId}>
              <SelectTrigger id="request-profile">
                <SelectValue placeholder="Account default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  Account default
                  {defaultProfile ? ` (${defaultProfile.name})` : ''}
                </SelectItem>
                {editing?.profile &&
                  data &&
                  !data.profiles.some(
                    (entry) => entry.id === editing.profile?.id
                  ) && (
                    <SelectItem value={editing.profile.id} disabled>
                      {editing.profile.name} (unavailable)
                    </SelectItem>
                  )}
                {data?.profiles.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-pretty text-xs text-muted-foreground">
              {profiles.error ||
                (effective
                  ? receivedSummary(effective)
                  : 'Received files arrive private. Your upload profile adds its tags, expiry, and naming.')}
            </p>
          </div>
          {showFolders && (
            <div className="space-y-2">
              <Label htmlFor="request-folder">Save to</Label>
              <Select
                value={folderId}
                onValueChange={setFolderId}
                disabled={foldersLoading}
              >
                <SelectTrigger id="request-folder">
                  <SelectValue placeholder="Unfiled" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unfiled">Unfiled</SelectItem>
                  {folderId !== 'unfiled' &&
                    (!canUseFolders ||
                      !folders.some((folder) => folder.id === folderId)) && (
                      <SelectItem value={folderId} disabled>
                        {canUseFolders && foldersLoading
                          ? 'Loading folder…'
                          : editing?.folder?.id === folderId
                            ? `${editing.folder.name} (unavailable)`
                            : 'Folder unavailable'}
                      </SelectItem>
                    )}
                  {canUseFolders &&
                    [...folders]
                      .sort((a, b) =>
                        folderPath(folders, a.id).localeCompare(
                          folderPath(folders, b.id)
                        )
                      )
                      .map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folderPath(folders, folder.id)}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="request-sender-name">Ask for their name</Label>
              <Select
                value={senderName}
                onValueChange={(value) =>
                  setSenderName(value as SenderNameMode)
                }
              >
                <SelectTrigger id="request-sender-name">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SENDER_NAME_MODES.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {SENDER_NAME_LABELS[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="request-expiry">Closes after</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="request-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {editing && (
                    <SelectItem value="keep">
                      {editing.expiresAt
                        ? `Keep (${absolute(editing.expiresAt)})`
                        : 'Keep (no deadline)'}
                    </SelectItem>
                  )}
                  {FILE_REQUEST_EXPIRY_OPTIONS.map((option) => (
                    <SelectItem
                      key={String(option.hours)}
                      value={
                        option.hours === null ? 'never' : String(option.hours)
                      }
                    >
                      {option.hours === null
                        ? 'No deadline'
                        : `${option.label}${editing ? ' from now' : ''}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">
              Limits{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label
                  htmlFor="request-max-files"
                  className="font-normal text-muted-foreground"
                >
                  Files in total
                </Label>
                <Input
                  id="request-max-files"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={10000}
                  value={maxFiles}
                  onChange={(event) => setMaxFiles(event.target.value)}
                  placeholder="No limit"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="request-max-size"
                  className="font-normal text-muted-foreground"
                >
                  Size in total
                </Label>
                <div className="flex gap-2">
                  <Input
                    id="request-max-size"
                    type="number"
                    inputMode="decimal"
                    min={1}
                    step="any"
                    value={maxSize}
                    onChange={(event) => setMaxSize(event.target.value)}
                    placeholder="No limit"
                    className="min-w-0"
                  />
                  <Select value={sizeUnit} onValueChange={setSizeUnit}>
                    <SelectTrigger
                      className="w-20 shrink-0"
                      aria-label="Size unit"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MB">MB</SelectItem>
                      <SelectItem value="GB">GB</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <p className="text-pretty text-xs text-muted-foreground">
              The request closes once it has received this much. Your storage
              quota and the instance’s file size limit always apply.
            </p>
          </fieldset>
          <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-4">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="request-notify">Email me when files arrive</Label>
              <p className="text-pretty text-xs text-muted-foreground">
                {policy.canNotify
                  ? 'At most one email every 10 minutes for this request.'
                  : 'Needs email delivery on this instance and a verified email address on your account.'}
              </p>
            </div>
            <Switch
              id="request-notify"
              checked={notify && policy.canNotify}
              onCheckedChange={setNotify}
              disabled={!policy.canNotify}
            />
          </div>
        </div>
        {error && (
          <p role="alert" className="mt-4 shrink-0 text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className={formDialogFooterClassName}>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={saving || !title.trim()}>
            {saving
              ? editing
                ? 'Saving…'
                : 'Creating…'
              : editing
                ? 'Save changes'
                : 'Create request link'}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
