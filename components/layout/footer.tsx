'use client'

import Link from 'next/link'

import { Github } from 'lucide-react'

import { useAppearance } from '@/components/customization/appearance-provider'
import { Button } from '@/components/ui/button'

export function Footer() {
  const { brand } = useAppearance()
  return (
    <footer className="relative z-10 w-full px-4 py-6">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 rounded-2xl border border-border/50 bg-background/60 px-5 py-4 shadow-sm backdrop-blur-xl sm:flex-row sm:items-center sm:px-6">
        <p className="text-sm leading-relaxed text-muted-foreground">
          {brand.footerText}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 bg-background/60"
          asChild
        >
          <Link
            href="https://github.com/FlintSH/flare"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github className="mr-2 h-4 w-4" />
            View on GitHub
          </Link>
        </Button>
      </div>
    </footer>
  )
}
