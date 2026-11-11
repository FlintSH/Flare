'use client'

import { type MouseEvent, useCallback } from 'react'

import { useRouter } from 'next/navigation'

import { ProfileClientProps } from '@/types/components/profile'
import { Database, Plug, Upload, UserPlus, UserRound } from 'lucide-react'

import { PersonalAppearanceSettings } from '@/components/customization/personal-appearance-settings'
import { IntegrationsPanel } from '@/components/integrations/integrations-panel'
import { InviteManager } from '@/components/invites/invite-manager'
import {
  PreferencesPanel,
  PreferencesShell,
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
import { ProfileManager } from '@/components/upload-profiles/profile-manager'

import { allows } from '@/lib/permissions/actions'
import {
  PROFILE_SECTIONS,
  PROFILE_SECTION_ALIASES,
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
  const [activeSection, setSection] = usePreferenceSection(
    PROFILE_SECTIONS,
    initialSection,
    PROFILE_SECTION_ALIASES
  )
  const handleRefresh = useCallback(() => router.refresh(), [router])
  const accountShortcuts = [
    ...(can('profile.update')
      ? [{ title: 'Identity', anchor: 'profile-identity' }]
      : []),
    { title: 'Sign-in security', anchor: 'sign-in-security' },
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
    >
      <PreferencesPanel active={displayedSection === 'account'}>
        <nav aria-label="Account shortcuts" className="flex flex-wrap gap-2">
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
        <Card>
          <CardHeader>
            <CardTitle>Your roles</CardTitle>
            <CardDescription>
              Your access combines Everyone with the roles assigned to you.
              Contact an administrator to request changes.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RoleBadges roles={user.roles} />
          </CardContent>
        </Card>
        <PermissionGate permission="profile.update">
          <Card
            id="profile-identity"
            tabIndex={-1}
            className="scroll-mt-28 outline-none"
          >
            <CardHeader>
              <CardTitle>A little about you</CardTitle>
              <CardDescription>
                The name and photo people see when you share.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileAccount user={user} onUpdate={handleRefresh} />
            </CardContent>
          </Card>
        </PermissionGate>
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
            <PersonalAppearanceSettings initialPreference={initialPreference} />
          </div>
        </PermissionGate>
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
