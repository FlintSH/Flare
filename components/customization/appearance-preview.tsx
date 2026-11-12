'use client'

import { type CSSProperties, useState } from 'react'

import {
  Download,
  FileCode,
  FileImage,
  InfoIcon,
  Link2,
  Lock,
  Moon,
  Sun,
} from 'lucide-react'

import { SamplePicture } from '@/components/embeds/sample-media'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import type { AppearanceDocument } from '@/lib/customization/schema'
import { showsShareFooter } from '@/lib/customization/sharing'
import { paletteVariables } from '@/lib/customization/theme'
import { cn } from '@/lib/utils'

const previewToggleClassName =
  'h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground [&_svg]:size-3.5'

export function AppearancePreview({
  document,
  creditsFooter,
  mode,
  onModeChange,
  protectedPreview,
  onProtectedChange,
}: {
  document: AppearanceDocument
  /** The instance's saved Show credits footer setting. */
  creditsFooter: boolean
  mode: 'light' | 'dark'
  onModeChange: (mode: 'light' | 'dark') => void
  protectedPreview: boolean
  onProtectedChange: (value: boolean) => void
}) {
  const { brand, theme, sharing } = document
  const [codePreview, setCodePreview] = useState(false)
  const sampleName = codePreview ? 'hello-world.ts' : 'a-little-inspiration.png'
  const sampleType = codePreview ? 'TypeScript' : 'PNG image'
  const sampleSize = codePreview ? '240 B' : '1.8 MB'
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
        {/* The app's segmented style: no track, the selected mode filled. */}
        <div className="flex gap-1">
          <Button
            type="button"
            size="icon"
            variant={mode === 'light' ? 'secondary' : 'ghost'}
            className={cn(
              'h-7 w-7',
              mode !== 'light' && 'text-muted-foreground'
            )}
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
            className={cn(
              'h-7 w-7',
              mode !== 'dark' && 'text-muted-foreground'
            )}
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
            {sharing.showUploader &&
              !protectedPreview &&
              sharing.defaultStyle !== 'delivery' && (
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
              // As on the live share page: the file's icon, name and facts
              // with the actions beside them, then the preview. Download is
              // the filled primary action; the others are outline icons.
              <div
                className={
                  sharing.defaultStyle === 'minimal'
                    ? ''
                    : 'border bg-card/75 shadow-lg overflow-hidden'
                }
                style={{ borderRadius: `${theme.radius}rem` }}
              >
                <div
                  className={cn(
                    'space-y-2',
                    sharing.defaultStyle === 'minimal' ? 'pb-3' : 'border-b p-3'
                  )}
                >
                  {sharing.defaultStyle === 'delivery' && (
                    <div className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
                      <span className="uppercase tracking-widest">
                        A file for you
                      </span>
                      {sharing.showUploader && <span>Uploaded by you</span>}
                    </div>
                  )}
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-muted/30">
                      {codePreview ? (
                        <FileCode className="h-4 w-4" />
                      ) : (
                        <FileImage className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">
                        {sharing.showFilename ? sampleName : sampleType}
                      </span>
                      {(sharing.showFilename || sharing.showSize) && (
                        <span className="block truncate text-[10px] text-muted-foreground">
                          {[
                            sharing.showFilename && sampleType,
                            sharing.showSize && sampleSize,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="flex items-center gap-1.5 rounded-md border border-primary bg-primary px-2.5 py-1.5 text-[10px] text-primary-foreground">
                        <Download className="h-3 w-3" />
                        Download
                      </span>
                      <span className="flex h-[26px] w-[26px] items-center justify-center rounded-md border">
                        <Link2 className="h-3 w-3" />
                      </span>
                    </span>
                  </div>
                </div>
                <div
                  className={
                    sharing.defaultStyle === 'minimal'
                      ? 'overflow-hidden border'
                      : ''
                  }
                  style={
                    sharing.defaultStyle === 'minimal'
                      ? { borderRadius: `${theme.radius}rem` }
                      : undefined
                  }
                >
                  {codePreview ? (
                    <pre className="h-40 overflow-auto p-4 text-[11px] leading-6 text-foreground sm:h-48">
                      <code>
                        {
                          '// A little room for your ideas\n\nconst space = {\n  name: "My Flare",\n  madeFor: "you",\n}\n\nexport default space'
                        }
                      </code>
                    </pre>
                  ) : (
                    // The picture sits on a stage, as on the live page.
                    <div
                      className={cn(
                        'bg-muted/60',
                        sharing.imageFit === 'contain' && 'px-8'
                      )}
                    >
                      <SamplePicture className="h-40 rounded-none sm:h-48" />
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {showsShareFooter(document, creditsFooter) && (
            <p className="text-[10px] text-muted-foreground text-center px-5 pb-5">
              {brand.footerText}
            </p>
          )}
        </div>
      </div>
      {/* Two matching toggles. The row's negative margin cancels their
          padding, so the labels line up with the preview's edges. */}
      <div className="-mx-2 flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={previewToggleClassName}
          onClick={() => {
            setCodePreview(!codePreview)
            onProtectedChange(false)
          }}
        >
          <FileImage aria-hidden="true" />
          {codePreview ? 'Preview image' : 'Preview code'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={previewToggleClassName}
          aria-pressed={protectedPreview}
          onClick={() => onProtectedChange(!protectedPreview)}
        >
          <Lock aria-hidden="true" />
          {protectedPreview ? 'Show image' : 'Preview protected state'}
        </Button>
      </div>
      {!theme.enabled && (
        <Alert variant="info" role="status">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            The preview shows your studio palette. Turn on “Use studio theme” to
            publish its colors and surfaces. Existing custom CSS remains active
            on your live instance.
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
