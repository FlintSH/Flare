import { cache } from 'react'

import type { Metadata } from 'next'
import localFont from 'next/font/local'

import { AppearanceProvider } from '@/components/customization/appearance-provider'
import { CustomHead } from '@/components/layout/custom-head'
import { AuthProvider } from '@/components/providers/auth-provider'
import { InputModality } from '@/components/providers/input-modality'
import { MeticulousContext } from '@/components/providers/meticulous-context'
import { QueryProvider } from '@/components/providers/query-provider'
import { SetupChecker } from '@/components/setup/setup-checker'
import { ThemeInitializer } from '@/components/theme/theme-initializer'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/toaster'

import { getRequestSession } from '@/lib/auth/page-session'
import { getConfigOrDefaults } from '@/lib/config'
import { faviconUrl } from '@/lib/customization/favicon'
import { isAppearanceRecovery } from '@/lib/customization/recovery'
import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'
import { pageSetupStatus } from '@/lib/setup/status'

import './globals.css'

// Keep commas out of font file names. Next.js 16 preloads such a file with the
// comma percent-encoded while the stylesheet requests it unencoded, so
// browsers download the font twice.
const inter = localFont({
  src: [
    {
      path: '../public/fonts/inter/Inter-VariableFont_opsz_wght.ttf',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../public/fonts/inter/Inter-Italic-VariableFont_opsz_wght.ttf',
      weight: '100 900',
      style: 'italic',
    },
  ],
  display: 'swap',
  variable: '--font-inter',
})

const requestConfig = cache(getConfigOrDefaults)

export async function generateMetadata(): Promise<Metadata> {
  const favicon = faviconUrl(
    (await requestConfig()).settings.appearance.favicon
  )
  return {
    title: null,
    description: null,
    icons: {
      icon: [
        ...(favicon
          ? [{ url: favicon, type: 'image/png', sizes: '32x32' }]
          : []),
        { url: '/icon.svg', type: 'image/svg+xml' },
      ],
    },
  }
}

export const dynamic = 'force-dynamic'

// Project only boolean controls; configuration also contains private credentials.
function collectBooleanFlags(
  values: Record<string, unknown>,
  prefix = ''
): Record<string, boolean> {
  const flags: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(values)) {
    const name = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'boolean') {
      flags[name] = value
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(
        flags,
        collectBooleanFlags(value as Record<string, unknown>, name)
      )
    }
  }
  return flags
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [config, recovery, setupComplete, session] = await Promise.all([
    requestConfig(),
    isAppearanceRecovery(),
    // Unknown while the database can't be read: the browser then asks again,
    // and the page shows its own error.
    pageSetupStatus(),
    // Left out when it can't be read, so the browser asks for it instead.
    getRequestSession().catch(() => undefined),
  ])
  const appearance = recovery
    ? {
        ...DEFAULT_APPEARANCE,
        theme: { ...DEFAULT_APPEARANCE.theme, enabled: true },
      }
    : config.settings.customization.published
  const recordMeticulous =
    (process.env.NODE_ENV === 'development' ||
      process.env.VERCEL_ENV === 'preview' ||
      process.env.METICULOUS_RECORDING_ENABLED === 'true') &&
    Boolean(process.env.NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN)
  // While custom CSS mentions font-family, body text follows the studio's
  // Typeface rule, which font-sans would outrank.
  const hasCustomFont =
    !recovery && config.settings.advanced.customCSS.includes('font-family')

  // Inter is defined on <html>, where the studio's Typeface reads --font-inter.
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Explicit opt-in also supports the isolated recording container. */}
        {recordMeticulous && (
          // eslint-disable-next-line @next/next/no-sync-scripts
          <script
            data-recording-token={
              process.env.NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN
            }
            data-is-production-environment="false"
            data-inject-session-id-header="true"
            src="https://snippet.meticulous.ai/v1/meticulous.js"
          />
        )}
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ThemeInitializer recovery={recovery} />
        <CustomHead recovery={recovery} />
      </head>
      <body
        className={`${hasCustomFont ? '' : 'font-sans '}min-h-screen flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme={
            appearance.theme.enabled
              ? appearance.theme.defaultMode
              : config.settings.appearance.theme
          }
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider session={session}>
              <AppearanceProvider
                appearance={appearance}
                legacyTheme={config.settings.appearance.theme}
              >
                {recordMeticulous && (
                  <MeticulousContext
                    flags={collectBooleanFlags(config.settings.general)}
                  />
                )}
                <SetupChecker completed={setupComplete} />
                <div className="flex-1">{children}</div>
              </AppearanceProvider>
            </AuthProvider>
          </QueryProvider>
          <Toaster />
          <InputModality />
        </ThemeProvider>
      </body>
    </html>
  )
}
