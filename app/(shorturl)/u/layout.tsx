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
  metadataBase: null,
  applicationName: '',
  authors: null,
  generator: '',
  keywords: '',
  referrer: null,
  creator: '',
  publisher: '',
  category: '',
  classification: '',
  formatDetection: null,
  verification: {},
  appleWebApp: null,
  alternates: {},
  archives: null,
  assets: null,
  bookmarks: null,
  colorScheme: null,
  itunes: null,
}

export default function ShortUrlLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return <div className="min-h-screen">{children}</div>
}
