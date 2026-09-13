import type { Metadata } from 'next'
import localFont from 'next/font/local'

import { AppearanceProvider } from '@/components/customization/appearance-provider'
import { CustomHead } from '@/components/layout/custom-head'
import { AuthProvider } from '@/components/providers/auth-provider'
import { MeticulousContext } from '@/components/providers/meticulous-context'
import { QueryProvider } from '@/components/providers/query-provider'
import { SetupChecker } from '@/components/setup-checker'
import { ThemeInitializer } from '@/components/theme/theme-initializer'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/toaster'

import { getConfig } from '@/lib/config'
import { isAppearanceRecovery } from '@/lib/customization/recovery'
import { DEFAULT_APPEARANCE } from '@/lib/customization/schema'

import './globals.css'

const inter = localFont({
  src: [
    {
      path: '../public/fonts/inter/Inter-VariableFont_opsz,wght.ttf',
      weight: '100 900',
      style: 'normal',
    },
    {
      path: '../public/fonts/inter/Inter-Italic-VariableFont_opsz,wght.ttf',
      weight: '100 900',
      style: 'italic',
    },
  ],
  display: 'swap',
  variable: '--font-inter',
})

export const metadata: Metadata = {
  title: null,
  description: null,
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
  },
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
  const config = await getConfig()
  const recovery = await isAppearanceRecovery()
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
  const hasCustomFont =
    !recovery && config.settings.advanced.customCSS.includes('font-family')

  if (config.settings.appearance.favicon) {
    metadata.icons = {
      icon: [
        { url: '/api/favicon', type: 'image/png', sizes: '32x32' },
        { url: '/icon.svg', type: 'image/svg+xml' },
      ],
    }
  }

  return (
    <html lang="en" suppressHydrationWarning>
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
        className={`${!hasCustomFont ? inter.variable + ' font-sans' : ''} min-h-screen flex flex-col`}
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
            <AuthProvider>
              <AppearanceProvider
                appearance={appearance}
                legacyTheme={config.settings.appearance.theme}
              >
                {recordMeticulous && (
                  <MeticulousContext
                    flags={collectBooleanFlags(config.settings.general)}
                  />
                )}
                <SetupChecker>
                  <div className="flex-1">{children}</div>
                </SetupChecker>
              </AppearanceProvider>
            </AuthProvider>
          </QueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
