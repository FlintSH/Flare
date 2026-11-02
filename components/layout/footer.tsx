'use client'

import Link from 'next/link'

import { Github } from 'lucide-react'

import { useAppearance } from '@/components/customization/appearance-provider'
import { pagePanelClassName } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'

import { cn } from '@/lib/utils'

export function Footer() {
  const { brand } = useAppearance()
  // The bar shares the content column's width and gutters, on the dashboard
  // and on public pages alike, and uses the same surface as their panels.
  return (
    <footer className="relative z-10 mx-auto w-full max-w-7xl px-4 py-6">
      <div
        className={cn(
          pagePanelClassName,
          'flex flex-col items-start justify-between gap-3 px-6 py-4 sm:flex-row sm:items-center'
        )}
      >
        <p className="text-balance text-sm leading-relaxed text-muted-foreground">
          {brand.footerText}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="h-9 shrink-0 bg-background/60 sm:h-8"
          asChild
        >
          <Link
            href="https://github.com/FlintSH/flare"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github aria-hidden="true" />
            View on GitHub
          </Link>
        </Button>
      </div>
    </footer>
  )
}
