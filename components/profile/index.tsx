'use client'

import {
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'

import { useRouter } from 'next/navigation'

import { ProfileClientProps } from '@/types/components/profile'
import {
  ChevronDown,
  Database,
  Plug,
  Upload,
  UserPlus,
  UserRound,
} from 'lucide-react'

import { PersonalAppearanceSettings } from '@/components/customization/personal-appearance-settings'
import { IntegrationsPanel } from '@/components/integrations/integrations-panel'
import { InviteManager } from '@/components/invites/invite-manager'
import {
  PreferencesMobileNavigation,
  PreferencesPanel,
  PreferencesShell,
  mobilePreferenceSelectClassName,
} from '@/components/preferences/preferences-shell'
import { PermissionGate } from '@/components/roles/permission-gate'
import { RoleBadges } from '@/components/roles/role-badges'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ProfileManager } from '@/components/upload-profiles/profile-manager'

import { allows } from '@/lib/permissions/actions'
import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_ALIASES,
  resolvePreferenceUrl,
} from '@/lib/preferences/navigation'

import { usePermissions } from '@/hooks/use-permissions'
import { usePreferenceSection } from '@/hooks/use-preference-section'

import { ProfileAccount } from './account'
import { ProfileExport } from './export'
import { LogoutButton } from './logout-button'
import { ProfileDeleteAccount } from './profile-delete-account'
import { ProfileUploadDefaults } from './profile-upload-defaults'
import { ProfileSecurity } from './security'
import { ProfileSessions } from './security/profile-sessions'
import { SignInSecurity } from './security/sign-in-security'
import { ProfileStorage } from './storage'
import { ProfileTools } from './tools'

const sections = [
  {
    id: 'account',
    hint: 'Identity, password, and theme',
    title: 'Account',
    description:
      'Manage your identity, sign-in details, and workspace preference.',
    icon: UserRound,
  },
  {
    id: 'uploads',
    hint: 'Screenshot tools and defaults',
    title: 'Uploads',
    description:
      'Your upload defaults, reusable profiles, and screenshot tools.',
    icon: Upload,
  },
  {
    id: 'integrations',
    hint: 'API tokens and webhooks',
    title: 'Integrations',
    description: 'Connect your apps with personal API tokens and webhooks.',
    icon: Plug,
  },
  {
    id: 'invites',
    hint: 'Invite people to join',
    title: 'Invites',
    description:
      'Create invite links so the people you choose can make an account here.',
    icon: UserPlus,
  },
  {
    id: 'data',
    hint: 'Storage, exports, and account',
    title: 'Your data',
    description: 'Review storage, export your files, or manage your account.',
    icon: Database,
  },
] as const

export function ProfileClient({
  user,
  quotasEnabled,
  formattedQuota,
  formattedUsed,
  usagePercentage,
  initialSection,
  initialPreference,
}: ProfileClientProps) {
  const { can, user: sessionUser } = usePermissions()
  const router = useRouter()
  const accountJumpId = useId()
  const accountJumpTarget = useRef<{
    target: HTMLElement
    pathname: string
    generation: number
  } | null>(null)
  const accountJumpFrame = useRef<number | null>(null)
  const accountHistoryFrame = useRef<number | null>(null)
  const accountHistoryDestination = useRef({ url: '', handled: false })
  const accountFocusGeneration = useRef(0)
  const accountStart = useRef<HTMLDivElement>(null)
  const focusAccountHistory = useRef(false)
  const cancelAccountJumpFrame = useCallback(() => {
    if (accountJumpFrame.current !== null)
      window.cancelAnimationFrame(accountJumpFrame.current)
    accountJumpFrame.current = null
  }, [])
  const cancelAccountHistoryFrame = useCallback(() => {
    if (accountHistoryFrame.current !== null)
      window.cancelAnimationFrame(accountHistoryFrame.current)
    accountHistoryFrame.current = null
  }, [])
  const [accountAnchor, setAccountAnchor] = useState('')
  const canEditProfile = can('profile.update')
  const canChooseAppearance = can('appearance.personal')
  const [activeSection, setSection] = usePreferenceSection(
    PROFILE_SECTIONS,
    initialSection,
    PROFILE_SECTION_ALIASES
  )
  const handleRefresh = useCallback(() => router.refresh(), [router])
  const accountShortcuts: {
    title: string
    anchor: string
    mobileTitle?: string
  }[] = [
    ...(can('profile.update')
      ? [{ title: 'Identity', anchor: 'profile-identity' }]
      : []),
    {
      title: 'Sign-in security',
      mobileTitle: 'Security',
      anchor: 'sign-in-security',
    },
    { title: 'Active sessions', anchor: 'active-sessions' },
    { title: 'Login history', anchor: 'login-history' },
    ...(can('profile.update')
      ? [{ title: 'Password', anchor: 'password' }]
      : []),
    ...(can('appearance.personal')
      ? [{ title: 'Appearance', anchor: 'workspace-appearance' }]
      : []),
  ]

  const focusAccountAnchor = (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    cancelAccountJumpFrame()
    cancelAccountHistoryFrame()
    accountFocusGeneration.current += 1
    // Native fragments keep bookmarkable URLs and Back/Forward behavior.
    // A target card also receives keyboard focus, rather than leaving focus
    // on a shortcut now several screens above the selected setting.
    const target = document.getElementById(event.currentTarget.hash.slice(1))
    if (!target) return
    target.tabIndex = -1
    target.focus({ preventScroll: true })
  }

  const visibleSections = sections.filter((section) =>
    section.id === 'uploads'
      ? can('files.upload') || can('uploadProfiles.manage')
      : section.id === 'integrations'
        ? can('tokens.manage') || can('webhooks.manage')
        : section.id === 'invites'
          ? can('invites.create')
          : true
  )
  const displayedSection = visibleSections.some(
    (section) => section.id === activeSection
  )
    ? activeSection
    : 'account'

  useEffect(() => {
    const pathname = window.location.pathname
    const syncAnchor = (event?: Event) => {
      const location = new URL(window.location.href)
      if (location.pathname !== pathname) {
        focusAccountHistory.current = false
        cancelAccountJumpFrame()
        cancelAccountHistoryFrame()
        return
      }
      const { section, url } = resolvePreferenceUrl(
        location,
        PROFILE_SECTIONS,
        'account',
        PROFILE_SECTION_ALIASES
      )
      let anchor = url.hash.slice(1)
      try {
        anchor = decodeURIComponent(anchor)
      } catch {
        // An invalid fragment has no destination to focus.
      }
      setAccountAnchor(anchor)
      if (accountHistoryDestination.current.url !== url.href) {
        cancelAccountHistoryFrame()
        accountHistoryDestination.current = { url: url.href, handled: false }
      }
      if (event) {
        cancelAccountJumpFrame()
        focusAccountHistory.current = section === 'account'
      }
      if (section !== 'account' || displayedSection !== 'account') return
      // One history step can dispatch both popstate and hashchange. Once its
      // destination has focus, the second event must not steal the next Tab.
      if (accountHistoryDestination.current.handled) {
        focusAccountHistory.current = false
        return
      }
      // Leave a normal initial visit alone. History without a fragment returns
      // to the start; bookmarks and native fragment changes focus their card.
      if (!anchor && !focusAccountHistory.current) return
      const restore = () => {
        if (
          window.location.href !== url.href ||
          accountHistoryDestination.current.url !== url.href ||
          accountHistoryDestination.current.handled
        )
          return
        const start = accountStart.current
        const target = anchor ? document.getElementById(anchor) : start
        if (!start || !target || !start.contains(target)) return
        if (target.closest('[hidden]')) return
        accountHistoryDestination.current.handled = true
        focusAccountHistory.current = false
        target.tabIndex = -1
        if (document.activeElement !== target)
          target.focus({ preventScroll: true })
        if (anchor) target.scrollIntoView({ block: 'start' })
        else window.scrollTo({ top: 0 })
      }
      const target = anchor
        ? document.getElementById(anchor)
        : accountStart.current
      if (target && document.activeElement === target) {
        restore()
      } else if (accountHistoryFrame.current === null) {
        accountHistoryFrame.current = window.requestAnimationFrame(() => {
          accountHistoryFrame.current = null
          restore()
        })
      }
    }
    const respectInteraction = () => {
      accountFocusGeneration.current += 1
      cancelAccountJumpFrame()
      cancelAccountHistoryFrame()
      focusAccountHistory.current = false
      accountHistoryDestination.current = {
        url: window.location.href,
        handled: true,
      }
    }
    syncAnchor()
    window.addEventListener('hashchange', syncAnchor)
    window.addEventListener('popstate', syncAnchor)
    window.addEventListener('keydown', respectInteraction, true)
    window.addEventListener('pointerdown', respectInteraction, true)
    return () => {
      cancelAccountJumpFrame()
      cancelAccountHistoryFrame()
      window.removeEventListener('hashchange', syncAnchor)
      window.removeEventListener('popstate', syncAnchor)
      window.removeEventListener('keydown', respectInteraction, true)
      window.removeEventListener('pointerdown', respectInteraction, true)
    }
  }, [cancelAccountJumpFrame, cancelAccountHistoryFrame, displayedSection])

  const selectedAccountShortcut = accountShortcuts.find(
    (shortcut) => shortcut.anchor === accountAnchor
  )

  return (
    <PreferencesShell
      eyebrow="Your space"
      title="Profile"
      description="Everything that makes Flare work your way, in one place."
      sections={visibleSections}
      activeSection={displayedSection}
      onSectionChange={setSection}
      actions={<LogoutButton />}
      asideNote="These settings belong to your account. Your preferences travel with you."
      compactSectionIntroOnMobile={displayedSection === 'account'}
    >
      <PreferencesPanel active={displayedSection === 'account'}>
        <div
          ref={accountStart}
          id="account-start"
          role="group"
          aria-label="Account settings"
          tabIndex={-1}
          className="space-y-[16px] outline-none sm:space-y-6"
        >
          <PreferencesMobileNavigation>
            <div className="min-w-0 space-y-[4px] sm:hidden">
              <Label
                htmlFor={accountJumpId}
                className="block text-xs leading-tight text-muted-foreground"
              >
                Jump to
              </Label>
              <Select
                value=""
                onValueChange={(anchor) => {
                  cancelAccountJumpFrame()
                  cancelAccountHistoryFrame()
                  accountFocusGeneration.current += 1
                  const target = document.getElementById(anchor)
                  if (!target) return
                  accountJumpTarget.current = {
                    target,
                    pathname: window.location.pathname,
                    generation: accountFocusGeneration.current,
                  }
                  window.location.hash = anchor
                  target.tabIndex = -1
                  target.focus({ preventScroll: true })
                }}
              >
                <SelectTrigger
                  id={accountJumpId}
                  aria-label="Jump to account setting"
                  aria-description={selectedAccountShortcut?.title}
                  // Keep the destination upright while the empty command
                  // value continues to allow selecting the same target again.
                  data-placeholder={selectedAccountShortcut ? undefined : ''}
                  className={mobilePreferenceSelectClassName}
                >
                  <SelectValue
                    placeholder={
                      selectedAccountShortcut?.mobileTitle ||
                      selectedAccountShortcut?.title ||
                      'Choose setting'
                    }
                  />
                </SelectTrigger>
                <SelectContent
                  onCloseAutoFocus={(event) => {
                    const selection = accountJumpTarget.current
                    if (!selection) return
                    event.preventDefault()
                    accountJumpTarget.current = null
                    cancelAccountJumpFrame()
                    accountJumpFrame.current = requestAnimationFrame(() => {
                      accountJumpFrame.current = null
                      const { target, pathname, generation } = selection
                      const location = new URL(window.location.href)
                      let anchor: string
                      try {
                        anchor = decodeURIComponent(location.hash.slice(1))
                      } catch {
                        return
                      }
                      if (
                        location.pathname !== pathname ||
                        generation !== accountFocusGeneration.current ||
                        anchor !== target.id ||
                        !target.isConnected ||
                        target.closest('[hidden],[inert]') ||
                        target.getClientRects().length === 0 ||
                        getComputedStyle(target).visibility === 'hidden'
                      )
                        return
                      target.focus({ preventScroll: true })
                      target.scrollIntoView({ block: 'start' })
                    })
                  }}
                >
                  {accountShortcuts.map((shortcut) => (
                    <SelectItem key={shortcut.anchor} value={shortcut.anchor}>
                      {shortcut.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </PreferencesMobileNavigation>
          <nav
            aria-label="Account shortcuts"
            className="hidden flex-wrap gap-2 sm:flex [&+*]:!mt-0 sm:[&+*]:!mt-4 lg:[&+*]:!mt-6"
          >
            {accountShortcuts.map((shortcut) => (
              <a
                key={shortcut.anchor}
                href={`#${shortcut.anchor}`}
                onClick={focusAccountAnchor}
                className="inline-flex min-h-11 items-center rounded-lg border border-border/70 px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:min-h-9"
              >
                {shortcut.title}
              </a>
            ))}
          </nav>
          {sessionUser && (!canEditProfile || !canChooseAppearance) && (
            <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-sm leading-relaxed text-muted-foreground">
              {!canEditProfile
                ? !canChooseAppearance
                  ? 'Your administrator manages profile details, the password editor, and personal appearance.'
                  : 'Your administrator manages profile details and the password editor.'
                : 'Your administrator manages personal appearance.'}{' '}
              Sign-in security and sessions remain available.
            </p>
          )}
          <PermissionGate permission="profile.update">
            <Card
              id="profile-identity"
              tabIndex={-1}
              className="scroll-mt-28 outline-none"
            >
              <CardHeader className="gap-[4px] space-y-0 py-[12px] sm:gap-0 sm:space-y-1.5 sm:py-6">
                <CardTitle>Identity</CardTitle>
                <CardDescription>Your name and photo.</CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileAccount user={user} onUpdate={handleRefresh} />
              </CardContent>
            </Card>
          </PermissionGate>
          <details className="group rounded-xl border border-border/60 bg-panel px-4 py-2">
            <summary
              data-flare-control=""
              className="grid min-h-11 cursor-pointer list-none grid-cols-[minmax(0,1fr)_1rem] items-center gap-3 rounded-md text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden"
            >
              <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
                <span className="shrink-0 font-medium">Your roles</span>
                <span className="min-w-0 max-w-full">
                  <RoleBadges roles={user.roles} />
                </span>
              </span>
              <ChevronDown
                className="h-4 w-4 text-muted-foreground group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ul
              aria-label="Assigned roles"
              className="space-y-1 pb-2 pt-3 text-sm"
            >
              {user.roles.map((role) => (
                <li key={role.id} className="break-words">
                  {role.name}
                </li>
              ))}
            </ul>
            <p className="pb-3 pt-2 text-sm leading-relaxed text-muted-foreground">
              Your access combines Everyone with the roles assigned to you.
              Contact an administrator to request changes.
            </p>
          </details>
          <SignInSecurity />
          <ProfileSessions />
          <PermissionGate permission="profile.update">
            <Card
              id="password"
              tabIndex={-1}
              className="scroll-mt-28 outline-none"
            >
              <CardHeader>
                <CardTitle>Change your password</CardTitle>
                <CardDescription>
                  Use a strong password that you do not use elsewhere.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileSecurity onUpdate={handleRefresh} />
              </CardContent>
            </Card>
          </PermissionGate>
          <PermissionGate permission="appearance.personal">
            <div
              id="workspace-appearance"
              tabIndex={-1}
              className="scroll-mt-28 outline-none"
            >
              <PersonalAppearanceSettings
                initialPreference={initialPreference}
              />
            </div>
          </PermissionGate>
        </div>
      </PreferencesPanel>

      <PreferencesPanel active={displayedSection === 'uploads'}>
        <div className="space-y-8">
          {allows(sessionUser, 'uploaderTools') && (
            <Card id="upload-tools" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Screenshot tools and scripts</CardTitle>
                <CardDescription className="text-pretty">
                  Choose your tool and download a ready-to-use configuration. It
                  includes your upload token, so there is no API key to create
                  or paste.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileTools
                  onOpenIntegrations={() =>
                    setSection('integrations', { updateHistory: false })
                  }
                />
              </CardContent>
            </Card>
          )}
          <PermissionGate permission="uploadProfiles.manage">
            <ProfileManager embedded />
          </PermissionGate>
          <PermissionGate permission="profile.update">
            <Card id="upload-defaults" className="scroll-mt-6">
              <CardHeader>
                <CardTitle>Account upload defaults</CardTitle>
                <CardDescription>
                  Choose the starting point for your uploads. A selected profile
                  or individual upload can override these choices.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileUploadDefaults user={user} onUpdate={handleRefresh} />
              </CardContent>
            </Card>
          </PermissionGate>
        </div>
      </PreferencesPanel>

      <PreferencesPanel active={displayedSection === 'integrations'}>
        <IntegrationsPanel
          embedded
          active={displayedSection === 'integrations'}
          onSetupTool={() => setSection('uploads', { updateHistory: false })}
        />
      </PreferencesPanel>

      <PreferencesPanel active={displayedSection === 'invites'}>
        <Card>
          <CardContent className="pt-6">
            <InviteManager context="profile" />
          </CardContent>
        </Card>
      </PreferencesPanel>

      <PreferencesPanel active={displayedSection === 'data'}>
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Room for your files</CardTitle>
              <CardDescription>
                Keep track of your files, links, and available storage.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileStorage
                quotasEnabled={quotasEnabled}
                formattedQuota={formattedQuota}
                formattedUsed={formattedUsed}
                usagePercentage={usagePercentage}
                fileCount={user.fileCount}
                shortUrlCount={user.shortUrlCount}
              />
            </CardContent>
          </Card>
          {allows(sessionUser, 'exportAccount') && (
            <Card>
              <CardHeader>
                <CardTitle>Take your files with you</CardTitle>
                <CardDescription>
                  Download a copy of your uploaded files and account
                  information.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileExport />
              </CardContent>
            </Card>
          )}
          <PermissionGate permission="profile.update">
            <Card className="border-danger/30">
              <CardHeader>
                <CardTitle>Delete your account</CardTitle>
                <CardDescription>
                  Permanently remove your account and its data. Export anything
                  you want to keep first.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProfileDeleteAccount />
              </CardContent>
            </Card>
          </PermissionGate>
        </div>
      </PreferencesPanel>
    </PreferencesShell>
  )
}
