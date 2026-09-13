'use client'

import Link from 'next/link'

import { Github } from 'lucide-react'

import { useAppearance } from '@/components/customization/appearance-provider'
import { Button } from '@/components/ui/button'

export function Footer() {
  const { brand } = useAppearance()
  return (
    <footer className="relative z-10 w-full px-4 pb-6 pt-3 sm:px-6">
      <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 border-t border-border/60 pt-5 sm:flex-row sm:items-center">
        <p className="text-xs leading-relaxed text-muted-foreground">
          {brand.footerText}
        </p>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-xs text-muted-foreground"
          asChild
        >
          <Link
            href="https://github.com/FlintSH/flare"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github className="mr-2 h-3.5 w-3.5" />
            View on GitHub
          </Link>
        </Button>
      </div>
    </footer>
  )
}
