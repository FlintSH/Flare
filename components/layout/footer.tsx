'use client'

import Link from 'next/link'

import { Github } from 'lucide-react'

import { pagePanelClassName } from '@/components/layout/page-header'
import { useAppearance } from '@/components/providers/appearance-context'
import { Button } from '@/components/ui/button'

import { cn } from '@/lib/utils'

export function Footer({ compact = false }: { compact?: boolean }) {
  const { brand } = useAppearance()
  // The bar shares the content column's width and gutters, on the dashboard
  // and on public pages alike, and uses the same surface as their panels.
  return (
    <footer className="relative z-10 mx-auto w-full max-w-7xl px-4 py-6">
      <div
        className={cn(
          !compact && pagePanelClassName,
          compact && 'border-t border-border/60',
          'flex flex-col items-start justify-between gap-3 py-4 sm:flex-row sm:items-center',
          compact ? 'px-0' : 'px-6'
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
