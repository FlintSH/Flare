import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Flare',
  description: 'A free, modern, open source file upload platform',
}

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
