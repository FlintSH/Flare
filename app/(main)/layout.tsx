import { Metadata } from 'next'

import { getConfig } from '@/lib/config'

export async function generateMetadata(): Promise<Metadata> {
  const { brand } = (await getConfig()).settings.customization.published
  return { title: brand.name, description: brand.tagline }
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
