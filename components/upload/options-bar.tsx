'use client'

import {
  type ComponentProps,
  Fragment,
  type ReactNode,
  forwardRef,
  useEffect,
  useRef,
  useState,
} from 'react'

import Link from 'next/link'

import { ExpiryAction as ExpiryActionEnum } from '@/types/events'
import {
  ChevronDown,
  Clock,
  Folder,
  FolderPlus,
  Globe,
  KeyRound,
  Lock,
  SlidersHorizontal,
  Tag,
} from 'lucide-react'

import {
  FolderDialog,
  TagManager,
} from '@/components/dashboard/library-dialogs'
import {
  FilePasswordHint,
  filePasswordFieldProps,
} from '@/components/file/file-password-hint'
import { ExpiryModal } from '@/components/shared/expiry-modal'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

import { folderPath } from '@/lib/folders/navigation'
import {
  type Expiry,
  type ExpiryAction,
  RELATIVE_EXPIRATIONS,
  type RelativeExpiration,
  type Visibility,
  accountDecidesExpiry,
  expiryLabel,
  permittedAction,
  profileSummary,
} from '@/lib/uploads/choices'
import { cn } from '@/lib/utils'

import { useSaveDefaults } from './save-defaults'
import type { UploadOptionsState } from './use-upload-options'

/**
 * One chip: an icon, the value in effect and a chevron. A value picked for
 * this upload, rather than saved, takes the library's active-filter look and
 * a dot, and says so to screen readers.
 */
const Chip = forwardRef<
  HTMLButtonElement,
  ComponentProps<typeof Button> & {
    icon: typeof Globe
    name: string
    value: string
    picked?: boolean
    invalid?: boolean
    /** Nothing is set (no profile, unfiled, no tags): the chip names itself. */
    empty?: boolean
    /** What an empty chip shows, when shorter than its name. */
    label?: string
  }
>(function Chip(
  {
    icon: Icon,
    name,
    value,
    picked,
    invalid,
    empty,
    label,
    className,
    ...props
  },
  ref
) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="outline"
      aria-label={`${name}: ${value}${picked ? ', changed for this upload' : ''}`}
      className={cn(
        'relative h-8 min-w-0 max-w-full gap-1.5 rounded-lg bg-background/70 px-2 text-[13px] font-normal data-[state=open]:bg-accent sm:h-9 sm:gap-2 sm:px-3 sm:text-sm',
        empty &&
          !picked &&
          'border-dashed bg-transparent text-muted-foreground hover:text-foreground',
        picked && 'border-primary bg-primary/10',
        invalid && 'border-danger bg-danger/10 text-destructive',
        className
      )}
      {...props}
    >
      <Icon
        className="h-3.5 w-3.5 text-muted-foreground sm:h-4 sm:w-4"
        aria-hidden="true"
      />
      {/* On phones an empty folder or tags chip is its icon, so the row
          stays short; a bare profile icon says too little. */}
      <span
        className={cn(
          'min-w-0 max-w-[10rem] truncate',
          empty && !picked && !label && 'max-sm:hidden'
        )}
      >
        {empty && !picked ? (label ?? name) : value}
      </span>
      <ChevronDown
        className="h-3.5 w-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      {picked && (
        <span
          aria-hidden="true"
          className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary"
        />
      )}
    </Button>
  )
})

/** "Use profile setting" ends each menu whose value was picked here. */
function ResetItem({
  saved,
  onSelect,
}: {
  saved: string
  onSelect: () => void
}) {
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSelect}>
        <span className="min-w-0">
          Use saved setting
          <span className="block truncate text-xs text-muted-foreground">
            {saved}
          </span>
        </span>
      </DropdownMenuItem>
    </>
  )
}

const VISIBILITY_LABELS: Record<Visibility, string> = {
  PUBLIC: 'Public',
  PRIVATE: 'Private',
}

/**
 * The options for an upload or paste as a row of chips, each showing what is
 * in effect, with the page's main action at the end. Chips for things the
 * role can't choose don't appear.
 */
export function UploadOptionsBar({
  state,
  disabled,
  passwordId,
  passwordRequest = 0,
  children,
}: {
  state: UploadOptionsState
  disabled?: boolean
  /** The password field's id, so a problem can point at it. */
  passwordId: string
  /** Changes when the page asks for the password field to open, focused. */
  passwordRequest?: number
  /** The main action, at the end of the row (its own row on phones). */
  children?: ReactNode
}) {
  const { choices, setChoices, effective, can, profiles, folders, tags } = state
  // What each chip goes back to: the profile's settings, nothing picked.
  const saved = state.unpicked
  const set = (change: Partial<typeof choices>) =>
    setChoices((current) => ({ ...current, ...change }))
  /** Unpicks these chips once their choice is saved, unless they changed. */
  const clearIfStill = (submitted: Partial<typeof choices>) => () =>
    setChoices((current) => {
      const keys = Object.keys(submitted) as (keyof typeof choices)[]
      return keys.every((key) => current[key] === submitted[key])
        ? {
            ...current,
            ...Object.fromEntries(keys.map((key) => [key, undefined])),
          }
        : current
    })

  const profileList = profiles.data?.profiles ?? []
  // The page says which lists exist, so chips don't appear as they load.
  // Each chip the role can use is always there, so profiles, folders and
  // tags can be found where they're used; empty, its menu makes the first.
  const showProfiles = can.chooseProfile
  const showFolders = can.chooseFolder
  const showTags = can.tag
  const sortedFolders = [...folders.folders].sort((a, b) =>
    folderPath(folders.folders, a.id).localeCompare(
      folderPath(folders.folders, b.id)
    )
  )

  // The default applies when nothing is picked; without one, no profile does.
  // The page's value stands in only until the list loads.
  const defaultProfile = profiles.data
    ? profiles.data.profiles.find(
        ({ id }) => id === profiles.data?.defaultProfileId
      )
    : state.saved.profile
  const profileId =
    choices.profileId === undefined
      ? (defaultProfile?.id ?? null)
      : choices.profileId
  const profileName = profileId
    ? (profileList.find(({ id }) => id === profileId)?.name ??
      defaultProfile?.name ??
      'Profile')
    : 'No profile'
  const accountOnly = state.account
  const defaults = useSaveDefaults()
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [managingTags, setManagingTags] = useState(false)
  const selectedProfile = profileId
    ? profileList.find(({ id }) => id === profileId)
    : undefined
  const accountExpiry =
    effective.expiry.kind === 'never'
      ? ('DISABLED' as const)
      : effective.expiry.kind === 'after'
        ? effective.expiry.after
        : null
  // Whether saving this expiry as the account's would change plain uploads,
  // the ones that pick nothing and so get the default profile over the
  // account's settings, or the default profile decides it. Unknown while
  // the profiles load.
  const defaultOptions = profiles.data
    ? (profiles.data.profiles.find(
        ({ id }) => id === profiles.data?.defaultProfileId
      )?.options ?? null)
    : state.saved.profile
      ? undefined
      : null
  const expirySource =
    defaultOptions === undefined || !accountExpiry
      ? null
      : accountDecidesExpiry(accountExpiry, defaultOptions)
        ? ({ kind: 'account' } as const)
        : ({
            kind: 'profile',
            name: defaultProfile?.name ?? null,
          } as const)
  // Saving is offered, or said to be the default profile's call, only for a
  // pick the role could save that differs from the account's default.
  const savable =
    can.saveDefaults &&
    !!accountExpiry &&
    (accountExpiry !== accountOnly.expiration ||
      (accountExpiry !== 'DISABLED' &&
        effective.expiryAction !== accountOnly.expiryAction))
  const expiryFooter = !savable ? null : expirySource?.kind === 'profile' ? (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link href="/dashboard/profile?section=uploads#upload-profiles">
          <span className="min-w-0 text-xs text-muted-foreground">
            {expirySource.name
              ? `Your default profile, ${expirySource.name}, decides expiry`
              : 'Your default profile decides expiry'}
          </span>
        </Link>
      </DropdownMenuItem>
    </>
  ) : expirySource?.kind === 'account' && accountExpiry ? (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={() =>
          void defaults.saveExpiry(
            {
              expiration: accountExpiry,
              action: effective.expiryAction,
              label: expiryLabel(effective.expiry, effective.expiryAction),
            },
            {
              expiration: accountOnly.expiration,
              action: accountOnly.expiryAction,
            },
            // Cleared only if it's still the choice that was saved.
            clearIfStill({
              expiry: choices.expiry,
              expiryAction: choices.expiryAction,
            })
          )
        }
      >
        Save as account default
      </DropdownMenuItem>
    </>
  ) : null

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        {/* Wraps, so every chip stays in view on phones too. */}
        <div
          role="group"
          aria-label="Upload options"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:gap-2"
        >
          {showProfiles && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild disabled={disabled}>
                <Chip
                  icon={SlidersHorizontal}
                  name="Upload profile"
                  value={profiles.error ? 'Profiles unavailable' : profileName}
                  empty={!profiles.error && !profileId}
                  label="Profile"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="w-80 max-w-[calc(100vw-2rem)]"
              >
                <DropdownMenuLabel>Upload profile</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={profileId ?? 'none'}
                  onValueChange={(value) =>
                    set({
                      profileId:
                        value === (defaultProfile?.id ?? 'none')
                          ? undefined
                          : value === 'none'
                            ? null
                            : value,
                    })
                  }
                >
                  {profileList.map((profile) => (
                    <ProfileOption
                      key={profile.id}
                      value={profile.id}
                      name={
                        profile.id === defaultProfile?.id
                          ? `${profile.name} (default)`
                          : profile.name
                      }
                      summary={profileSummary(
                        { ...accountOnly, ...profile.options },
                        can.share
                      )}
                    />
                  ))}
                  <ProfileOption
                    value="none"
                    name="No profile"
                    summary={profileSummary(accountOnly, can.share)}
                  />
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                {/* (A profile deleted elsewhere is no choice to save.) */}
                {(selectedProfile?.id ?? null) !==
                  (defaultProfile?.id ?? null) &&
                  (!profileId || Boolean(selectedProfile)) &&
                  profiles.data && (
                    <DropdownMenuItem
                      onSelect={() =>
                        void defaults.makeDefault(
                          selectedProfile
                            ? {
                                id: selectedProfile.id,
                                name: selectedProfile.name,
                              }
                            : null,
                          profiles.data?.defaultProfileId ?? null,
                          clearIfStill({ profileId: choices.profileId })
                        )
                      }
                    >
                      {selectedProfile
                        ? `Make ${selectedProfile.name} the default`
                        : 'Use no profile by default'}
                    </DropdownMenuItem>
                  )}
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/profile?section=uploads#upload-profiles">
                    {profileList.length || state.saved.has.profiles
                      ? 'Manage profiles'
                      : 'New profile…'}
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {can.share ? (
            <AccessChip
              passwordId={passwordId}
              visibility={effective.visibility}
              savedVisibility={saved.visibility}
              picked={effective.picked.visibility}
              password={choices.password}
              problem={state.passwordProblem}
              disabled={disabled}
              onVisibility={(visibility) => set({ visibility })}
              onPassword={(password) => set({ password })}
              openRequest={passwordRequest}
            />
          ) : (
            <span
              className="inline-flex h-9 items-center gap-2 px-1 text-sm text-muted-foreground"
              title="Your role can’t share files, so uploads are private."
            >
              <Lock className="h-4 w-4" aria-hidden="true" />
              Private
              <span className="sr-only">
                . Your role can’t share files, so uploads are private.
              </span>
            </span>
          )}

          <ExpiryChip
            expiry={effective.expiry}
            action={effective.expiryAction}
            picked={effective.picked.expiry}
            saved={expiryLabel(saved.expiry, saved.expiryAction)}
            disabled={disabled}
            canAct={can.act}
            onChange={(expiry, expiryAction) => set({ expiry, expiryAction })}
            onReset={() => set({ expiry: undefined, expiryAction: undefined })}
            footer={expiryFooter}
          />

          {showFolders && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild disabled={disabled}>
                <Chip
                  icon={Folder}
                  name="Folder"
                  value={
                    folders.missing
                      ? 'Folder unavailable'
                      : choices.folderId
                        ? (folders.selected?.name ??
                          (state.initialFolder?.id === choices.folderId
                            ? state.initialFolder.name
                            : 'Loading folder…'))
                        : 'Unfiled'
                  }
                  picked={!!choices.folderId && !folders.missing}
                  invalid={folders.missing}
                  empty={!choices.folderId && !folders.missing}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto"
              >
                <DropdownMenuRadioGroup
                  value={choices.folderId ?? ''}
                  onValueChange={(value) => set({ folderId: value || null })}
                >
                  <DropdownMenuRadioItem value="">
                    Unfiled
                  </DropdownMenuRadioItem>
                  {sortedFolders.map((folder) => (
                    <DropdownMenuRadioItem key={folder.id} value={folder.id}>
                      <span className="min-w-0 truncate">
                        {folderPath(folders.folders, folder.id)}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    FolderDialog.show(() => setCreatingFolder(true))
                  }
                >
                  <FolderPlus />
                  New folder…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {showTags && (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild disabled={disabled}>
                <Chip
                  icon={Tag}
                  name="Tags"
                  value={
                    effective.tagIds.length === 0
                      ? 'No tags'
                      : effective.tagIds.length === 1
                        ? (tags.tags.find(
                            ({ id }) => id === effective.tagIds[0]
                          )?.name ?? '1 tag')
                        : `${effective.tagIds.length} tags`
                  }
                  picked={effective.picked.tags}
                  empty={effective.tagIds.length === 0}
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-64 overflow-y-auto"
              >
                {tags.tags.map((tag) => {
                  const checked = effective.tagIds.includes(tag.id)
                  return (
                    <DropdownMenuCheckboxItem
                      key={tag.id}
                      checked={checked}
                      // Stay open, so several tags can be chosen at once.
                      onSelect={(event) => event.preventDefault()}
                      onCheckedChange={() =>
                        set({
                          tagIds: checked
                            ? effective.tagIds.filter((id) => id !== tag.id)
                            : [...effective.tagIds, tag.id],
                        })
                      }
                    >
                      <span className="min-w-0 truncate">{tag.name}</span>
                    </DropdownMenuCheckboxItem>
                  )
                })}
                {tags.tags.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  onSelect={() => TagManager.show(() => setManagingTags(true))}
                >
                  {tags.tags.length ? 'Manage tags…' : 'New tag…'}
                </DropdownMenuItem>
                {effective.picked.tags && (
                  <ResetItem
                    saved={
                      saved.tagIds.length
                        ? saved.tagIds
                            .map(
                              (id) =>
                                tags.tags.find((tag) => tag.id === id)?.name
                            )
                            .filter(Boolean)
                            .join(', ')
                        : 'No tags'
                    }
                    onSelect={() => set({ tagIds: undefined })}
                  />
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {children && (
          <div className="flex shrink-0 [&>*]:w-full sm:[&>*]:w-auto">
            {children}
          </div>
        )}
      </div>
      {folders.selected?.shareToken && effective.visibility === 'PUBLIC' && (
        <p className="text-xs text-muted-foreground">
          Public files in {folders.selected.name} also appear on its shared
          link.
        </p>
      )}
      {state.problem && (
        <p role="alert" className="text-sm text-destructive">
          {state.problem}
        </p>
      )}
      {creatingFolder && (
        <FolderDialog
          action={{ kind: 'create', parentId: null }}
          onClose={() => setCreatingFolder(false)}
          onCreated={(folder) => {
            setCreatingFolder(false)
            set({ folderId: folder.id })
          }}
          onDeleted={() => {}}
        />
      )}
      {managingTags && (
        <TagManager
          open
          onOpenChange={setManagingTags}
          onDeleted={(id) =>
            effective.tagIds.includes(id) &&
            set({ tagIds: effective.tagIds.filter((tag) => tag !== id) })
          }
        />
      )}
    </div>
  )
}

function ProfileOption({
  value,
  name,
  summary,
}: {
  value: string
  name: string
  summary: readonly string[]
}) {
  return (
    <DropdownMenuRadioItem value={value} className="items-start">
      <span className="min-w-0">
        <span className="block truncate">{name}</span>
        <span className="block text-xs leading-snug text-muted-foreground">
          {summary.map((part, index) => (
            <Fragment key={part}>
              {index > 0 && ' · '}
              <span className="whitespace-nowrap">{part}</span>
            </Fragment>
          ))}
        </span>
      </span>
    </DropdownMenuRadioItem>
  )
}

/**
 * Who can open the upload, in one place: public or private, and for a
 * public file the password recipients need.
 */
function AccessChip({
  passwordId,
  visibility,
  savedVisibility,
  picked,
  password,
  problem,
  disabled,
  onVisibility,
  onPassword,
  openRequest,
}: {
  passwordId: string
  visibility: Visibility
  savedVisibility: Visibility
  picked: boolean
  password: string
  problem: string | null
  disabled?: boolean
  onVisibility: (visibility: Visibility | undefined) => void
  onPassword: (password: string) => void
  openRequest: number
}) {
  const hintId = `${passwordId}-hint`
  const [open, setOpen] = useState(false)
  const [focusPassword, setFocusPassword] = useState(false)
  // The page can open this at the password, for a paste that holds a secret.
  useEffect(() => {
    if (!openRequest) return
    setFocusPassword(true)
    setOpen(true)
  }, [openRequest])
  const protectedLink = visibility === 'PUBLIC' && !!password
  const value =
    visibility === 'PRIVATE'
      ? 'Private'
      : problem && password
        ? 'Check password'
        : protectedLink
          ? 'Public · password'
          : 'Public'
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setFocusPassword(false)
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <Chip
          icon={
            visibility === 'PRIVATE' ? Lock : protectedLink ? KeyRound : Globe
          }
          name="Visibility"
          value={value}
          picked={picked || protectedLink}
          invalid={visibility === 'PUBLIC' && !!password && !!problem}
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] space-y-4"
        onOpenAutoFocus={(event) => {
          const field = document.getElementById(passwordId)
          if (!focusPassword || !field) return
          event.preventDefault()
          field.focus()
        }}
      >
        <RadioGroup
          aria-label="Visibility"
          value={visibility}
          onValueChange={(next) => onVisibility(next as Visibility)}
          className="gap-1"
        >
          {(
            [
              ['PUBLIC', 'Public', 'Anyone with the link'],
              ['PRIVATE', 'Private', 'Only you'],
            ] as const
          ).map(([option, label, detail]) => (
            <Label
              key={option}
              htmlFor={`${passwordId}-${option}`}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 font-normal hover:bg-accent"
            >
              <RadioGroupItem id={`${passwordId}-${option}`} value={option} />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted-foreground">
                  {detail}
                </span>
              </span>
            </Label>
          ))}
        </RadioGroup>
        {visibility === 'PUBLIC' && (
          <div className="space-y-2 border-t border-border/60 pt-4">
            <Label htmlFor={passwordId}>
              Password{' '}
              <span className="font-normal text-muted-foreground">
                (optional)
              </span>
            </Label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => onPassword(event.target.value)}
              {...filePasswordFieldProps(hintId, password)}
            />
            <FilePasswordHint id={hintId} password={password} />
            {!problem && (
              <p className="text-xs text-muted-foreground">
                People opening the link must enter it.
              </p>
            )}
          </div>
        )}
        {picked && (
          <button
            type="button"
            onClick={() => onVisibility(undefined)}
            className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Use saved setting ({VISIBILITY_LABELS[savedVisibility]})
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function ExpiryChip({
  expiry,
  action,
  picked,
  saved,
  disabled,
  canAct,
  onChange,
  onReset,
  footer,
}: {
  expiry: Expiry
  action: ExpiryAction
  picked: boolean
  saved: string
  disabled?: boolean
  canAct: (action: ExpiryAction) => boolean
  onChange: (expiry: Expiry, action: ExpiryAction) => void
  onReset: () => void
  /** Ends the menu: saving the choice as a default, or what decides it. */
  footer?: ReactNode
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [custom, setCustom] = useState(false)
  // A role that can neither delete nor make private can only pick Never.
  const schedulable = permittedAction(action, canAct) !== null
  const value =
    expiry.kind === 'never'
      ? 'never'
      : expiry.kind === 'after'
        ? expiry.after
        : 'custom'
  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <Chip
            ref={trigger}
            icon={Clock}
            name="Expiration"
            value={expiryLabel(expiry, action)}
            picked={picked}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Expires</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next) => {
              if (next === 'custom') return
              if (next === 'never') return onChange({ kind: 'never' }, action)
              // Keep an action the role may use, so the upload can't fail
              // on it after every byte is sent.
              const allowed = permittedAction(action, canAct)
              if (allowed)
                onChange(
                  { kind: 'after', after: next as RelativeExpiration },
                  allowed
                )
            }}
          >
            <DropdownMenuRadioItem value="never">Never</DropdownMenuRadioItem>
            {RELATIVE_EXPIRATIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                disabled={!schedulable}
              >
                After {option.label}
              </DropdownMenuRadioItem>
            ))}
            <DropdownMenuRadioItem
              value="custom"
              disabled={!schedulable}
              onSelect={() => setCustom(true)}
            >
              {expiry.kind === 'at'
                ? expiryLabel(expiry, action)
                : 'Pick a date…'}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          {expiry.kind !== 'never' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Then</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={action}
                onValueChange={(next) => onChange(expiry, next as ExpiryAction)}
              >
                <DropdownMenuRadioItem
                  value="DELETE"
                  disabled={!canAct('DELETE')}
                >
                  Delete it
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem
                  value="SET_PRIVATE"
                  disabled={!canAct('SET_PRIVATE')}
                >
                  Make it private
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </>
          )}
          {picked && <ResetItem saved={saved} onSelect={onReset} />}
          {footer}
        </DropdownMenuContent>
      </DropdownMenu>
      <ExpiryModal
        isOpen={custom}
        onOpenChange={(open) => {
          setCustom(open)
          // The menu item that opened the dialog is gone; return to the chip.
          if (!open) requestAnimationFrame(() => trigger.current?.focus())
        }}
        onConfirm={async (date, chosen) => {
          if (!date) return onChange({ kind: 'never' }, action)
          // The dialog only opens when some action is allowed.
          const allowed = permittedAction(
            (chosen as ExpiryAction | undefined) ?? action,
            canAct
          )
          if (allowed) onChange({ kind: 'at', at: date }, allowed)
        }}
        initialDate={expiry.kind === 'at' ? expiry.at : null}
        initialAction={action as ExpiryActionEnum}
        title="Choose when it expires"
        description="Pick a date and time, and what happens then."
      />
    </>
  )
}
