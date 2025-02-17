import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: '',
  description: '',
  robots: {
    index: false,
    follow: false,
  },
  icons: null,
  manifest: null,
  themeColor: null,
  viewport: null,
  other: {},
  openGraph: null,
  twitter: null,
}

export default function RawLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body>{children}</body>
    </html>
  )
}
