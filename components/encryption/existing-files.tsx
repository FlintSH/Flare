'use client'

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertCircle, Loader2, ShieldCheck, X } from 'lucide-react'

import { useAccountKeys } from '@/components/providers/account-keys-provider'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import {
  EXISTING_FILES_QUERY,
  type ExistingFilesChoice,
  type ExistingFilesStatus,
  FAILURE_TEXT,
  activeJobs,
  choiceCounts,
  chooseExistingFiles,
  encryptFiles,
  encryptionConsequences,
  existingFilesRequests,
  fetchExistingFiles,
  openExistingFilesChoice,
  shouldAsk,
} from '@/lib/files/existing-client'
import {
  libraryMaintenance,
  requestMaintenance,
} from '@/lib/library/browser-maintenance'
import { libraryChanged } from '@/lib/library/changes'
import { cn } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

/** How often the page asks for progress while the server works. */
const PROGRESS_MS = 2_500
const LATER_KEY = 'flare.existing-files.later'

const files = (count: number) =>
  `${count.toLocaleString()} ${count === 1 ? 'file' : 'files'}`

/**
 * The state of the existing files of the signed-in account. It loads for an
 * account that has keys, and follows the progress while the server works.
 */
export function useExistingFiles() {
  const { state } = useAccountKeys()
  const hasKeys = state.status === 'unlocked' || state.status === 'locked'
  return useQuery({
    queryKey: EXISTING_FILES_QUERY,
    queryFn: fetchExistingFiles,
    enabled: hasKeys,
    staleTime: 30_000,
    refetchInterval: (query) =>
      activeJobs(query.state.data) > 0 ? PROGRESS_MS : false,
  })
}

const ROWS = [
  {
    kind: 'private',
    label: 'Private',
    result: 'Nothing you will notice. No link exists that can break.',
  },
  {
    kind: 'public',
    label: 'Public',
    result:
      'The link you shared stops working. You copy a new link from the library.',
  },
  {
    kind: 'password',
    label: 'With a password',
    result:
      'The password cannot be kept. The file becomes private until you set a password again.',
  },
] as const

function ConsequencesTable({ plain }: { plain: ExistingFilesStatus['plain'] }) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full text-left text-xs" data-existing-files-table="">
        <thead className="bg-muted/40 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Your files
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              When the server encrypts them
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {ROWS.map((row) => (
            <tr key={row.kind} className="align-top">
              <th
                scope="row"
                className="whitespace-nowrap px-3 py-2 font-medium text-foreground"
              >
                {row.label}
                <span className="block font-normal tabular-nums text-muted-foreground">
                  {files(plain[row.kind])}
                </span>
              </th>
              <td className="px-3 py-2 leading-relaxed text-muted-foreground">
                {row.result}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const OPTIONS: {
  value: ExistingFilesChoice
  label: string
  hint: (plain: ExistingFilesStatus['plain']) => string
}[] = [
  {
    value: 'private',
    label: 'Private files',
    hint: (plain) =>
      plain.public + plain.password > 0
        ? 'Recommended. Public files and files with a password stay as they are.'
        : 'Recommended. Nothing you shared changes.',
  },
  {
    value: 'all',
    label: 'All files',
    hint: (plain) => {
      const changes = [
        plain.public > 0 &&
          `${files(plain.public)} ${plain.public === 1 ? 'gets' : 'get'} a new link`,
        plain.password > 0 &&
          `${files(plain.password)} ${plain.password === 1 ? 'needs' : 'need'} a new password`,
      ].filter(Boolean)
      return changes.length
        ? `${changes.join(' and ')}.`
        : 'Every file from before encryption.'
    },
  },
  {
    value: 'none',
    label: 'None',
    hint: () => 'Keep them plain. You can decide later in Profile.',
  },
]

function FailedFiles({
  status,
  onRetry,
  retrying,
}: {
  status: ExistingFilesStatus
  onRetry: () => void
  retrying: boolean
}) {
  if (!status.failed.length) return null
  return (
    <div
      className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3"
      data-existing-files-failed=""
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <AlertCircle
            className="h-4 w-4 shrink-0 text-destructive"
            aria-hidden="true"
          />
          {files(status.jobs.failed)} could not be encrypted
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onRetry}
          disabled={retrying}
        >
          {retrying && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
          Try again
        </Button>
      </div>
      <ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
        {status.failed.map((failure) => (
          <li key={failure.fileId} className="flex min-w-0 gap-2">
            <span className="min-w-0 max-w-[45%] shrink-0 truncate font-medium">
              {failure.name ?? 'A file'}
            </span>
            <span className="min-w-0 text-muted-foreground">
              {FAILURE_TEXT[failure.code]}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        These files are unchanged and still plain.
      </p>
    </div>
  )
}

function ChoiceDialog({
  status,
  open,
  onOpenChange,
  onChanged,
}: {
  status: ExistingFilesStatus
  open: boolean
  onOpenChange: (open: boolean) => void
  onChanged: (status: ExistingFilesStatus) => void
}) {
  const id = useId()
  const { toast } = useToast()
  const [choice, setChoice] = useState<ExistingFilesChoice>(
    status.choice ?? 'private'
  )
  const [saving, setSaving] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const counts = choiceCounts(status.plain)
  const active = activeJobs(status)

  const save = async () => {
    setSaving(true)
    try {
      onChanged(await chooseExistingFiles(choice))
      onOpenChange(false)
    } catch (error) {
      toast({
        title: 'Couldn’t save your choice',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }
  const retry = async () => {
    setRetrying(true)
    try {
      await encryptFiles(status.failed.map((failure) => failure.fileId))
      onChanged(await fetchExistingFiles())
    } catch (error) {
      toast({
        title: 'Couldn’t try again',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        data-existing-files-dialog=""
      >
        <DialogHeader>
          <DialogTitle>Encrypt your existing files</DialogTitle>
          <DialogDescription>
            {status.plain.total > 0
              ? `${files(status.plain.total)} in your library ${status.plain.total === 1 ? 'is' : 'are'} from before encryption and stored readable. The server can encrypt ${status.plain.total === 1 ? 'it' : 'them'} for you without a download. After that, only your keys open ${status.plain.total === 1 ? 'it' : 'them'}.`
              : 'No plain file from before encryption is left.'}
          </DialogDescription>
        </DialogHeader>
        {active > 0 && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-xs"
          >
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            Encrypting {files(active)} now. You can keep using Flare.
          </p>
        )}
        <FailedFiles status={status} onRetry={retry} retrying={retrying} />
        {status.plain.total > 0 && (
          <>
            <ConsequencesTable plain={status.plain} />
            <RadioGroup
              value={choice}
              onValueChange={(value) => setChoice(value as ExistingFilesChoice)}
              aria-label="Which existing files to encrypt"
              className="gap-1.5"
            >
              {OPTIONS.map((option) => (
                <label
                  key={option.value}
                  htmlFor={`${id}-${option.value}`}
                  className={cn(
                    'flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 transition-colors',
                    choice === option.value
                      ? 'border-primary/60 bg-primary/5'
                      : 'border-border/60 hover:bg-muted/40'
                  )}
                >
                  <RadioGroupItem
                    id={`${id}-${option.value}`}
                    value={option.value}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium">{option.label}</span>
                    {option.value !== 'none' && (
                      <span className="ml-2 tabular-nums text-muted-foreground">
                        {files(counts[option.value])}
                      </span>
                    )}
                    <span className="block text-xs leading-relaxed text-muted-foreground">
                      {option.hint(status.plain)}
                    </span>
                  </span>
                </label>
              ))}
            </RadioGroup>
            <p className="text-xs leading-relaxed text-muted-foreground">
              This protects these files from now on. The server stored them
              readable until today, and backups from before may still contain
              them.
            </p>
          </>
        )}
        {/* On a phone the dialog scrolls, and the answer stays in view. */}
        <DialogFooter className="sticky bottom-0 -mx-5 -mb-5 gap-2 border-t border-border/60 bg-overlay px-5 pb-5 pt-3 sm:static sm:m-0 sm:gap-2 sm:border-0 sm:bg-transparent sm:p-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {status.plain.total > 0 ? 'Not now' : 'Close'}
          </Button>
          {status.plain.total > 0 && (
            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              data-existing-files-confirm=""
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {choice === 'none'
                ? 'Keep files plain'
                : `Encrypt ${files(counts[choice])}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EncryptFilesDialog({
  selected,
  onClose,
  onChanged,
}: {
  selected: NonNullable<ReturnType<typeof existingFilesRequests.get>> & {
    kind: 'files'
  }
  onClose: () => void
  onChanged: (status: ExistingFilesStatus) => void
}) {
  const { toast } = useToast()
  const [saving, setSaving] = useState(false)
  const count = selected.files.length
  const { password, shared } = encryptionConsequences(selected.files)
  const run = async () => {
    setSaving(true)
    try {
      await encryptFiles(selected.files.map((file) => file.id))
      onChanged(await fetchExistingFiles())
      onClose()
    } catch (error) {
      toast({
        title: 'Couldn’t start the encryption',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md" data-encrypt-files-dialog="">
        <DialogHeader>
          <DialogTitle>
            {count === 1 ? 'Encrypt this file?' : `Encrypt ${files(count)}?`}
          </DialogTitle>
          <DialogDescription>
            The server encrypts {count === 1 ? 'it' : 'them'} for your keys and
            deletes the readable {count === 1 ? 'copy' : 'copies'}. This cannot
            be undone.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5 text-sm">
          {shared > 0 && (
            <li data-encrypt-consequence="link">
              <span className="font-medium">
                {count === 1
                  ? 'Its link changes.'
                  : `${files(shared)} get a new link.`}
              </span>{' '}
              <span className="text-muted-foreground">
                The old link stops working. Copy the new one from the library.
              </span>
            </li>
          )}
          {password > 0 && (
            <li data-encrypt-consequence="password">
              <span className="font-medium">
                {count === 1
                  ? 'Its password is removed.'
                  : `${files(password)} lose their password.`}
              </span>{' '}
              <span className="text-muted-foreground">
                {count === 1 ? 'The file becomes' : 'They become'} private until
                you set a password again.
              </span>
            </li>
          )}
          {shared + password === 0 && (
            <li className="text-muted-foreground">
              {count === 1 ? 'It is' : 'They are'} private, so no link breaks.
              Tags, folders and dates stay.
            </li>
          )}
        </ul>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void run()}
            disabled={saving}
            data-encrypt-files-confirm=""
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Encrypt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Asks one time which existing files the server encrypts, and shows the
 * progress (docs/e2ee-spec.md, section 14.2). Nothing here is modal until
 * the person opens it: the question is a line above the page, and the
 * progress is a small status at its edge.
 */
export function ExistingFiles() {
  const client = useQueryClient()
  const { state: account } = useAccountKeys()
  const { data: status } = useExistingFiles()
  const request = useSyncExternalStore(
    existingFilesRequests.subscribe,
    existingFilesRequests.get,
    () => null
  )
  const maintenance = useSyncExternalStore(
    libraryMaintenance.subscribe,
    libraryMaintenance.getState,
    libraryMaintenance.getState
  )
  const [later, setLater] = useState(false)
  useEffect(() => {
    try {
      setLater(window.sessionStorage.getItem(LATER_KEY) === '1')
    } catch {
      // Without session storage the line shows again after a reload.
    }
  }, [])

  const setStatus = (next: ExistingFilesStatus) =>
    client.setQueryData(EXISTING_FILES_QUERY, next)

  // The server waits while folders or tags are not converted: this browser
  // does that work first (section 14.2, "Before the server starts").
  const waitsForBrowser =
    Boolean(status && !status.libraryReady && activeJobs(status) > 0) &&
    account.status === 'unlocked'
  useEffect(() => {
    if (waitsForBrowser) requestMaintenance('tags', 'folders')
  }, [waitsForBrowser, status])

  // Each file that became encrypted changes what the library lists.
  const encrypted = status?.jobs.encrypted
  const seen = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (encrypted === undefined) return
    if (seen.current !== undefined && encrypted > seen.current) {
      void libraryChanged(client)
      requestMaintenance('index', 'pending')
    }
    seen.current = encrypted
  }, [encrypted, client])

  if (!status?.hasKeys) return null
  const active = activeJobs(status)
  const total = active + status.jobs.encrypted + status.jobs.failed
  const asking = shouldAsk(status) && !later
  const dismiss = () => {
    setLater(true)
    try {
      window.sessionStorage.setItem(LATER_KEY, '1')
    } catch {
      // The line is hidden for this page view.
    }
  }

  return (
    <>
      {asking && (
        <div
          role="status"
          data-existing-files-prompt=""
          className="mb-4 flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-card/80 px-4 py-2.5 text-sm shadow-sm backdrop-blur-xl sm:items-center sm:gap-x-4"
        >
          <ShieldCheck
            className="mt-1 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0"
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 basis-56 leading-relaxed">
            {files(status.plain.total)} from before encryption{' '}
            {status.plain.total === 1 ? 'is' : 'are'} stored readable.{' '}
            <span className="text-muted-foreground">
              The server can encrypt {status.plain.total === 1 ? 'it' : 'them'}{' '}
              for you.
            </span>
          </p>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={openExistingFilesChoice}
            >
              Choose
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label="Decide later"
              title="Decide later"
              onClick={dismiss}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      {(active > 0 || status.jobs.failed > 0) && (
        <div
          role="status"
          aria-live="polite"
          data-existing-files-progress={active > 0 ? 'running' : 'failed'}
          className={cn(
            'pointer-events-none fixed inset-x-0 z-40 flex justify-center px-4 sm:inset-x-auto sm:left-4 sm:justify-start sm:px-0',
            // Above the status of the library's own background work.
            maintenance.progress ? 'bottom-14' : 'bottom-4'
          )}
        >
          <button
            type="button"
            onClick={openExistingFilesChoice}
            className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-overlay px-3 py-1.5 text-xs text-muted-foreground shadow-lg shadow-black/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {active > 0 ? (
              <Loader2
                className="h-3.5 w-3.5 shrink-0 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <AlertCircle
                className="h-3.5 w-3.5 shrink-0 text-destructive"
                aria-hidden="true"
              />
            )}
            <span className="min-w-0 truncate">
              {active > 0
                ? !status.libraryReady
                  ? 'Preparing folders and tags'
                  : `Encrypting existing files · ${(total - active).toLocaleString()} of ${total.toLocaleString()}`
                : `${files(status.jobs.failed)} could not be encrypted`}
            </span>
          </button>
        </div>
      )}
      {request?.kind === 'choice' && (
        <ChoiceDialog
          status={status}
          open
          onOpenChange={(open) => !open && existingFilesRequests.set(null)}
          onChanged={setStatus}
        />
      )}
      {request?.kind === 'files' && (
        <EncryptFilesDialog
          selected={request}
          onClose={() => existingFilesRequests.set(null)}
          onChanged={setStatus}
        />
      )}
    </>
  )
}

/** The entry in Profile: the same question, whenever the person wants it. */
export function ExistingFilesSettings() {
  const { data: status } = useExistingFiles()
  if (!status?.hasKeys) return null
  const active = activeJobs(status)
  const chosen =
    status.choice === 'private'
      ? 'You chose to encrypt private files.'
      : status.choice === 'all'
        ? 'You chose to encrypt all files.'
        : status.choice === 'none'
          ? 'You chose to keep them plain.'
          : 'You have not decided yet.'
  return (
    <Card data-existing-files-settings="">
      <CardHeader>
        <CardTitle>Files from before encryption</CardTitle>
        <CardDescription>
          {status.plain.total > 0
            ? `${files(status.plain.total)} ${status.plain.total === 1 ? 'is' : 'are'} stored readable: ${status.plain.private.toLocaleString()} private, ${status.plain.public.toLocaleString()} public, ${status.plain.password.toLocaleString()} with a password. ${chosen}`
            : 'No plain file from before encryption is left.'}
          {status.plainLater > 0 &&
            ` ${files(status.plainLater)} uploaded as plain since then ${status.plainLater === 1 ? 'stays' : 'stay'} plain. Choose Encrypt in the library to change that.`}
          {active > 0 && ` The server is encrypting ${files(active)} now.`}
          {status.jobs.failed > 0 &&
            ` ${files(status.jobs.failed)} could not be encrypted.`}
          {status.passwordPending > 0 &&
            ` ${files(status.passwordPending)} lost ${status.passwordPending === 1 ? 'its' : 'their'} password and ${status.passwordPending === 1 ? 'is' : 'are'} private until you set one again.`}
        </CardDescription>
      </CardHeader>
      {(status.plain.total > 0 || status.jobs.failed > 0) && (
        <CardContent>
          <Button
            type="button"
            variant="outline"
            onClick={openExistingFilesChoice}
          >
            {status.jobs.failed > 0
              ? 'Review'
              : status.choice
                ? 'Change what is encrypted'
                : 'Choose what to encrypt'}
          </Button>
        </CardContent>
      )}
    </Card>
  )
}
