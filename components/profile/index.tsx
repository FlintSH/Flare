'use client'

import { useCallback } from 'react'

import { useRouter } from 'next/navigation'

import { LogoutButton } from '@/app/(main)/dashboard/profile/logout-button'
import { ProfileClientProps } from '@/types/components/profile'
import {
  Database,
  Fingerprint,
  HardDrive,
  KeyRound,
  Palette,
  Plug,
  Shield,
  Trash2,
  Upload,
  UserRound,
} from 'lucide-react'

import { PersonalAppearanceSettings } from '@/components/customization/personal-appearance-settings'
import { IntegrationsPanel } from '@/components/integrations/integrations-panel'
import {
  PreferencesPanel,
  PreferencesShell,
} from '@/components/preferences/preferences-shell'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { ProfileManager } from '@/components/upload-profiles/profile-manager'

import { PROFILE_SECTIONS } from '@/lib/preferences/navigation'

import { usePreferenceSection } from '@/hooks/use-preference-section'

import { ProfileAccount } from './account'
import { ProfileExport } from './export'
import { ProfileDeleteAccount } from './profile-delete-account'
import { ProfileUploadDefaults } from './profile-upload-defaults'
import { ProfileSecurity } from './security'
import { ProfileStorage } from './storage'
import { ProfileTools } from './tools'

const sections = [
  {
    id: 'account',
    hint: 'Your identity and email',
    title: 'Account',
    description: 'Your identity, avatar, and email address.',
    icon: UserRound,
  },
  {
    id: 'appearance',
    hint: 'Your workspace theme',
    title: 'Appearance',
    description: 'Choose how Flare looks in your own workspace.',
    icon: Palette,
  },
  {
    id: 'uploads',
    hint: 'Defaults, profiles, and tools',
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
    id: 'security',
    hint: 'Password and sign-in',
    title: 'Security',
    description: 'Keep your account and sign-in details secure.',
    icon: Shield,
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
  const router = useRouter()
  const [activeSection, setSection] = usePreferenceSection(
    PROFILE_SECTIONS,
    initialSection
  )
  const handleRefresh = useCallback(() => router.refresh(), [router])

  return (
    <PreferencesShell
      eyebrow="Your space"
      title="Profile"
      description="Everything that makes Flare work your way, in one place. Meticulous visual check."
      sections={sections}
      activeSection={activeSection}
      onSectionChange={setSection}
      actions={<LogoutButton />}
      asideNote="These settings belong to your account. Your preferences travel with you."
    >
      <PreferencesPanel active={activeSection === 'account'}>
        <Card>
          <CardHeader className="space-y-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
              <Fingerprint className="h-5 w-5" />
            </span>
            <div className="space-y-1.5">
              <CardTitle>A little about you</CardTitle>
              <CardDescription>
                The name and photo people see when you share.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ProfileAccount user={user} onUpdate={handleRefresh} />
          </CardContent>
        </Card>
      </PreferencesPanel>

      <PreferencesPanel active={activeSection === 'appearance'}>
        <PersonalAppearanceSettings initialPreference={initialPreference} />
      </PreferencesPanel>

      <PreferencesPanel active={activeSection === 'uploads'}>
        <div className="space-y-8">
          <ProfileManager embedded />
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
          <Card id="upload-tools" className="scroll-mt-6">
            <CardHeader>
              <CardTitle>Screenshot tools and scripts</CardTitle>
              <CardDescription>
                Connect your favorite capture tool, then upload without opening
                a browser. Downloads here follow your default upload profile.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileTools />
            </CardContent>
          </Card>
        </div>
      </PreferencesPanel>

      <PreferencesPanel active={activeSection === 'integrations'}>
        <IntegrationsPanel embedded />
      </PreferencesPanel>

      <PreferencesPanel active={activeSection === 'security'}>
        <Card>
          <CardHeader className="space-y-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
              <KeyRound className="h-5 w-5" />
            </span>
            <div className="space-y-1.5">
              <CardTitle>Change your password</CardTitle>
              <CardDescription>
                Use a strong password that you do not use elsewhere.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <ProfileSecurity onUpdate={handleRefresh} />
          </CardContent>
        </Card>
      </PreferencesPanel>

      <PreferencesPanel active={activeSection === 'data'}>
        <div className="space-y-6">
          <Card>
            <CardHeader className="space-y-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border bg-muted/40">
                <HardDrive className="h-5 w-5" />
              </span>
              <div className="space-y-1.5">
                <CardTitle>Room for your files</CardTitle>
                <CardDescription>
                  Keep track of your files, links, and available storage.
                </CardDescription>
              </div>
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
          <Card>
            <CardHeader>
              <CardTitle>Take your files with you</CardTitle>
              <CardDescription>
                Download a copy of your uploaded files and account information.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProfileExport />
            </CardContent>
          </Card>
          <Card className="border-destructive/30">
            <CardHeader className="space-y-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 text-destructive">
                <Trash2 className="h-5 w-5" />
              </span>
              <div className="space-y-1.5">
                <CardTitle>Delete your account</CardTitle>
                <CardDescription>
                  Permanently remove your account and its data. Export anything
                  you want to keep first.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <ProfileDeleteAccount />
            </CardContent>
          </Card>
        </div>
      </PreferencesPanel>
    </PreferencesShell>
  )
}
