'use client'

import { type CSSProperties, useState } from 'react'

import { Download, FileImage, Link2, Lock, Moon, Sun } from 'lucide-react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'

import type { AppearanceDocument } from '@/lib/customization/schema'
import { shareMetadataText } from '@/lib/customization/sharing'
import { paletteVariables } from '@/lib/customization/theme'

export function AppearancePreview({
  document,
  mode,
  onModeChange,
  protectedPreview,
  onProtectedChange,
}: {
  document: AppearanceDocument
  mode: 'light' | 'dark'
  onModeChange: (mode: 'light' | 'dark') => void
  protectedPreview: boolean
  onProtectedChange: (value: boolean) => void
}) {
  const { brand, theme, sharing } = document
  const [codePreview, setCodePreview] = useState(false)
  const sampleName = codePreview ? 'hello-world.ts' : 'a-little-inspiration.png'
  const social = shareMetadataText(document, {
    name: sampleName,
    formattedSize: codePreview ? '240 B' : '1.8 MB',
    uploader: 'you',
    isMedia: !codePreview,
  })
  const logo =
    mode === 'light'
      ? brand.logoLight || brand.logoDark
      : brand.logoDark || brand.logoLight
  const variables = {
    ...paletteVariables(theme[mode]),
    '--radius': `${theme.radius}rem`,
    fontFamily:
      theme.font === 'mono'
        ? 'ui-monospace, monospace'
        : theme.font === 'system'
          ? 'system-ui, sans-serif'
          : 'var(--font-inter)',
  } as CSSProperties

  return (
    <section className="space-y-4" aria-label="Appearance preview">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-medium text-sm">Your share page</h2>
          <p className="text-xs text-muted-foreground mt-1">
            A preview of your draft
          </p>
        </div>
        <div className="flex rounded-lg border p-1 gap-1">
          <Button
            type="button"
            size="icon"
            variant={mode === 'light' ? 'secondary' : 'ghost'}
            className="h-7 w-7"
            aria-label="Preview light theme"
            aria-pressed={mode === 'light'}
            onClick={() => onModeChange('light')}
          >
            <Sun className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant={mode === 'dark' ? 'secondary' : 'ghost'}
            className="h-7 w-7"
            aria-label="Preview dark theme"
            aria-pressed={mode === 'dark'}
            onClick={() => onModeChange('dark')}
          >
            <Moon className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div
        className="rounded-2xl border shadow-xl shadow-black/10 overflow-hidden"
        style={variables}
      >
        <div className="bg-muted text-muted-foreground border-b px-4 py-3 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="ml-4 text-[10px] font-mono truncate">
            {brand.name.toLowerCase().replace(/[^a-z0-9]/g, '') || 'your'}
            .example / screenshot
          </span>
        </div>
        <div
          className="relative min-h-[400px] bg-background text-foreground overflow-hidden"
          style={{
            backgroundImage:
              theme.background === 'glow'
                ? 'radial-gradient(ellipse at top left, hsl(var(--primary) / .13), transparent 75%)'
                : theme.background === 'grid'
                  ? 'linear-gradient(hsl(var(--border) / .4) 1px, transparent 1px),linear-gradient(90deg,hsl(var(--border) / .4) 1px,transparent 1px)'
                  : undefined,
            backgroundSize:
              theme.background === 'grid' ? '24px 24px' : undefined,
          }}
        >
          <div className="flex items-center justify-between p-5 gap-3">
            <span className="flex items-center gap-2 min-w-0">
              {logo ? (
                <img src={logo} alt="" className="h-6 w-6 object-contain" />
              ) : (
                <Icons.logo className="h-5 w-5 shrink-0" />
              )}
              <span className="font-bold text-sm truncate">{brand.name}</span>
            </span>
            {sharing.showUploader && !protectedPreview && (
              <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground whitespace-nowrap">
                <span className="w-5 h-5 rounded-full bg-primary/15 flex items-center justify-center text-foreground">
                  Y
                </span>
                Uploaded by you
              </span>
            )}
          </div>
          <div className="p-5 pt-2">
            {protectedPreview ? (
              <div
                className="border bg-card p-8 text-center space-y-4 mt-6"
                style={{ borderRadius: `${theme.radius}rem` }}
              >
                <Lock className="h-7 w-7 mx-auto text-muted-foreground" />
                <p className="text-sm font-medium">Password protected file</p>
                <p className="text-xs text-muted-foreground">
                  Enter a password to access this file.
                </p>
                <div className="rounded-md border text-xs text-left p-3 text-muted-foreground">
                  Enter password
                </div>
                <div className="bg-primary text-primary-foreground rounded-md py-2 text-xs">
                  Access file
                </div>
              </div>
            ) : (
              <div
                className={
                  sharing.defaultStyle === 'minimal'
                    ? ''
                    : 'border bg-card/75 shadow-lg overflow-hidden'
                }
                style={{ borderRadius: `${theme.radius}rem` }}
              >
                {sharing.defaultStyle === 'delivery' && (
                  <div className="px-4 pt-4 text-[9px] uppercase tracking-widest text-muted-foreground">
                    A file for you
                  </div>
                )}
                {(sharing.showFilename || sharing.showSize) && (
                  <div
                    className={`${sharing.defaultStyle === 'delivery' ? 'text-left' : 'text-center'} p-3 space-y-1`}
                  >
                    {sharing.showFilename && (
                      <p className="text-xs font-medium">{sampleName}</p>
                    )}
                    {sharing.showSize && (
                      <p className="text-[10px] text-muted-foreground">
                        {codePreview ? '240 B' : '1.8 MB'}
                      </p>
                    )}
                  </div>
                )}
                <div
                  className={
                    sharing.defaultStyle === 'minimal' ? 'py-2' : 'px-3'
                  }
                >
                  {codePreview ? (
                    <pre className="h-40 sm:h-48 bg-muted/60 text-foreground overflow-auto rounded-lg p-4 text-[11px] leading-6">
                      <code>
                        {
                          '// A little room for your ideas\n\nconst space = {\n  name: "My Flare",\n  madeFor: "you",\n}\n\nexport default space'
                        }
                      </code>
                    </pre>
                  ) : (
                    <div
                      className="relative h-40 sm:h-48 overflow-hidden rounded-lg bg-gradient-to-br from-sky-200 via-indigo-300 to-violet-400"
                      style={{
                        marginInline:
                          sharing.imageFit === 'contain' ? '8px' : 0,
                      }}
                    >
                      <div className="absolute rounded-full bg-amber-100 w-14 h-14 top-6 right-9 opacity-90" />
                      <div className="absolute -bottom-24 -left-8 w-80 h-52 rounded-[45%] rotate-12 bg-indigo-900/65" />
                      <div className="absolute -bottom-28 -right-16 w-80 h-56 rounded-[45%] -rotate-12 bg-violet-950/75" />
                      <div className="absolute left-5 bottom-4 text-white text-xs font-medium">
                        A space for your perspective.
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 justify-center py-4">
                  <span className="border rounded-md px-3 py-1.5 text-[10px] flex items-center gap-1.5">
                    <Download className="w-3 h-3" />
                    Download
                  </span>
                  <span className="border rounded-md px-3 py-1.5 text-[10px] flex items-center gap-1.5">
                    <Link2 className="w-3 h-3" />
                    Copy link
                  </span>
                </div>
              </div>
            )}
          </div>
          {sharing.showFooter !== false && (
            <p className="text-[10px] text-muted-foreground text-center px-5 pb-5">
              {brand.footerText}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <button
          type="button"
          className="flex items-center gap-1.5 hover:text-foreground"
          onClick={() => {
            setCodePreview(!codePreview)
            onProtectedChange(false)
          }}
        >
          <FileImage className="h-3.5 w-3.5" />
          {codePreview ? 'Preview image' : 'Preview code'}
        </button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          aria-pressed={protectedPreview}
          onClick={() => onProtectedChange(!protectedPreview)}
        >
          <Lock className="h-3 w-3 mr-1.5" />
          {protectedPreview ? 'Show image' : 'Preview protected state'}
        </Button>
      </div>
      {!protectedPreview && (
        <div className="rounded-xl border p-4 text-sm space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
            Social preview text
          </p>
          <p className="font-medium break-words">{social.title}</p>
          <p className="text-xs text-muted-foreground break-words">
            {social.description}
          </p>
        </div>
      )}
      {!theme.enabled && (
        <p className="text-xs text-muted-foreground border rounded-lg p-3">
          The preview shows your studio palette. Turn on “Use studio theme” to
          publish its colors and surfaces. Existing custom CSS remains active on
          your live instance.
        </p>
      )}
    </section>
  )
}
