import type { Metadata } from 'next'
import localFont from 'next/font/local'

import { CustomHead } from '@/components/layout/custom-head'
import { AuthProvider } from '@/components/providers/auth-provider'
import { QueryProvider } from '@/components/providers/query-provider'
import { SetupChecker } from '@/components/setup-checker'
import { ThemeInitializer } from '@/components/theme/theme-initializer'
import { ThemeProvider } from '@/components/theme/theme-provider'
import { Toaster } from '@/components/ui/toaster'

import { getConfig } from '@/lib/config'

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

// This needs to be dynamic because config isn't always available during build
export const dynamic = 'force-dynamic'

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const config = await getConfig()
  const hasCustomFont =
    config.settings.advanced.customCSS.includes('font-family')

  // Update metadata icons if custom favicon exists
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
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <ThemeInitializer />
        <CustomHead />
      </head>
      <body
        className={`${!hasCustomFont ? inter.variable + ' font-sans' : ''} min-h-screen flex flex-col`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme={config.settings.appearance.theme}
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <AuthProvider>
              <SetupChecker>
                <div className="flex-1">{children}</div>
              </SetupChecker>
            </AuthProvider>
          </QueryProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
