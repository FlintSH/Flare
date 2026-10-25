'use client'

import { useEffect, useRef, useState } from 'react'

import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  LEGACY_COLOR_MESSAGE,
  legacyColorValue,
} from '@/lib/customization/legacy-appearance'

interface ColorConfig {
  background: string
  foreground: string
  card: string
  cardForeground: string
  popover: string
  popoverForeground: string
  primary: string
  primaryForeground: string
  secondary: string
  secondaryForeground: string
  muted: string
  mutedForeground: string
  accent: string
  accentForeground: string
  destructive: string
  destructiveForeground: string
  border: string
  input: string
  ring: string
}

interface ThemeCustomizerProps {
  onColorChange: (colors: Partial<ColorConfig>) => void
  initialColors?: Partial<ColorConfig>
  livePreview?: boolean
}

function hslToHex(h: number, s: number, l: number): string {
  l = l / 100
  const a = (s * Math.min(l, 1 - l)) / 100
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function parseColor(color: string): string {
  if (!color) return '#000000'

  if (color.startsWith('#')) {
    return color
  }

  const parts = color.split(' ')
  if (parts.length === 1) {
    const h = parseFloat(parts[0])
    if (!isNaN(h)) {
      return hslToHex(h, 100, 50)
    }
  } else if (parts.length === 3) {
    const [h, s, l] = parts.map((part) => parseFloat(part.replace('%', '')))
    if (!isNaN(h) && !isNaN(s) && !isNaN(l)) {
      return hslToHex(h, s, l)
    }
  }

  return '#000000'
}

const DEFAULT_COLORS: ColorConfig = {
  background: '222.2 84% 4.9%',
  foreground: '210 40% 98%',
  card: '222.2 84% 4.9%',
  cardForeground: '210 40% 98%',
  popover: '222.2 84% 4.9%',
  popoverForeground: '210 40% 98%',
  primary: '210 40% 98%',
  primaryForeground: '222.2 47.4% 11.2%',
  secondary: '217.2 32.6% 17.5%',
  secondaryForeground: '210 40% 98%',
  muted: '217.2 32.6% 17.5%',
  mutedForeground: '215 20.2% 65.1%',
  accent: '217.2 32.6% 17.5%',
  accentForeground: '210 40% 98%',
  destructive: '0 62.8% 30.6%',
  destructiveForeground: '210 40% 98%',
  border: '217.2 32.6% 17.5%',
  input: '217.2 32.6% 17.5%',
  ring: '212.7 26.8% 83.9%',
}

const PRESET_HUES = [
  { hue: 222.2, name: 'Midnight Blue', saturation: 84, lightness: 45 },
  { hue: 260, name: 'Royal', saturation: 80, lightness: 45 },
  { hue: 280, name: 'Amethyst', saturation: 75, lightness: 45 },
  { hue: 325, name: 'Rose', saturation: 85, lightness: 45 },
  { hue: 0, name: 'Ruby', saturation: 85, lightness: 45 },
  { hue: 15, name: 'Coral', saturation: 85, lightness: 45 },
  { hue: 22, name: 'Amber', saturation: 90, lightness: 45 },
  { hue: 45, name: 'Marigold', saturation: 95, lightness: 45 },
  { hue: 145, name: 'Emerald', saturation: 75, lightness: 40 },
  { hue: 170, name: 'Jade', saturation: 80, lightness: 40 },
  { hue: 195, name: 'Azure', saturation: 85, lightness: 45 },
  { hue: 210, name: 'Ocean', saturation: 85, lightness: 45 },
]

function SimpleThemeCustomizer({
  onColorChange,
  initialColors,
  livePreview = true,
}: ThemeCustomizerProps) {
  const [baseHue, setBaseHue] = useState(222.2)
  // Text typed into a value field, kept apart from the saved colors so the
  // stored HSL form never replaces it mid-edit. `left` marks a draft whose
  // field has lost focus, so errors wait until someone finishes typing.
  const [drafts, setDrafts] = useState<
    Partial<Record<keyof ColorConfig, { text: string; left: boolean }>>
  >({})
  // Set while this component's own change comes back as initialColors. Any
  // other new palette, such as Discard, replaces text still being edited.
  const ownChange = useRef(false)
  const [colors, setColors] = useState<ColorConfig>({
    background: '',
    foreground: '',
    card: '',
    cardForeground: '',
    popover: '',
    popoverForeground: '',
    primary: '',
    primaryForeground: '',
    secondary: '',
    secondaryForeground: '',
    muted: '',
    mutedForeground: '',
    accent: '',
    accentForeground: '',
    destructive: '',
    destructiveForeground: '',
    border: '',
    input: '',
    ring: '',
  })

  useEffect(() => {
    if (initialColors) {
      const hue = parseFloat(initialColors.background?.split(' ')[0] || '222.2')
      if (!isNaN(hue)) {
        setBaseHue(hue)
      }
      setColors((colors) => ({
        ...colors,
        ...initialColors,
      }))
      if (ownChange.current) ownChange.current = false
      else setDrafts({})
    }
  }, [initialColors])

  const handleHueChange = (newHue: number) => {
    setBaseHue(newHue)

    const newColors: Partial<ColorConfig> = {}
    Object.entries(DEFAULT_COLORS).forEach(([key, value]) => {
      if (key === 'destructive' || key === 'destructiveForeground') {
        newColors[key as keyof ColorConfig] = value
        return
      }
      const [, s, l] = value.split(' ')
      newColors[key as keyof ColorConfig] = `${newHue} ${s} ${l}`
    })

    if (livePreview)
      Object.entries(newColors).forEach(([key, value]) => {
        const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        document.documentElement.style.setProperty(`--${cssKey}`, value)
      })

    setDrafts({})
    ownChange.current = true
    onColorChange(newColors)
  }

  const handleReset = () => {
    if (livePreview)
      Object.entries(DEFAULT_COLORS).forEach(([key, value]) => {
        const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
        document.documentElement.style.setProperty(`--${cssKey}`, value)
      })
    setBaseHue(222.2)
    setColors(DEFAULT_COLORS)
    setDrafts({})
    ownChange.current = true
    onColorChange(DEFAULT_COLORS)
  }

  // Save only values the server accepts, stored as an HSL triplet even when
  // entered as hex.
  const applyColor = (key: keyof ColorConfig, value: string) => {
    const cssValue = legacyColorValue(value)
    if (!cssValue) return
    setColors((prev) => ({ ...prev, [key]: cssValue }))
    const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    if (livePreview)
      document.documentElement.style.setProperty(`--${cssKey}`, cssValue)
    ownChange.current = true
    onColorChange({ [key]: cssValue })
  }

  const clearDraft = (key: keyof ColorConfig) =>
    setDrafts(({ [key]: _draft, ...rest }) => rest)

  const handlePickerChange = (key: keyof ColorConfig, value: string) => {
    clearDraft(key)
    applyColor(key, value)
  }

  const handleTextChange = (key: keyof ColorConfig, text: string) => {
    setDrafts((prev) => ({
      ...prev,
      [key]: { text, left: prev[key]?.left ?? false },
    }))
    applyColor(key, text)
  }

  // A finished valid entry shows its saved form. Invalid text stays, with
  // its error, until it is fixed or replaced.
  const handleTextBlur = (key: keyof ColorConfig) => {
    const draft = drafts[key]
    if (!draft) return
    if (legacyColorValue(draft.text)) clearDraft(key)
    else setDrafts((prev) => ({ ...prev, [key]: { ...draft, left: true } }))
  }

  const renderColorInput = (key: keyof ColorConfig, label: string) => {
    const draft = drafts[key]
    const invalid = !!draft?.left && !legacyColorValue(draft.text)
    return (
      <div key={key} className="grid content-start gap-2">
        <Label htmlFor={key}>{label}</Label>
        <div className="flex gap-2">
          <Input
            id={key}
            type="color"
            value={parseColor(colors[key] || DEFAULT_COLORS[key])}
            className="w-12 p-1 h-9"
            onChange={(e) => handlePickerChange(key, e.target.value)}
          />
          <Input
            value={draft?.text ?? (colors[key] || DEFAULT_COLORS[key])}
            onChange={(e) => handleTextChange(key, e.target.value)}
            onBlur={() => handleTextBlur(key)}
            placeholder={`${label} color`}
            aria-label={`${label} value`}
            aria-invalid={invalid || undefined}
            aria-describedby={invalid ? `${key}-error` : undefined}
            className={invalid ? 'border-destructive' : undefined}
          />
        </div>
        {invalid && (
          <p
            id={`${key}-error`}
            className="text-[0.8rem] font-medium text-destructive"
          >
            {LEGACY_COLOR_MESSAGE} This value isn&apos;t saved.
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRESET_HUES.map(({ hue, name, saturation, lightness }) => (
          <button
            key={hue}
            onClick={() => handleHueChange(hue)}
            className={`relative h-14 w-full overflow-hidden rounded-md border transition-[border,opacity] ${
              baseHue === hue
                ? 'border-2 border-primary opacity-100'
                : 'border-transparent opacity-80 hover:opacity-100'
            }`}
            style={{
              background: `hsl(${hue}, ${saturation}%, ${lightness}%)`,
            }}
          >
            <div className="absolute inset-0 bg-gradient-to-b from-white/5 via-transparent to-black/20" />
            <div className="absolute inset-0 flex items-center justify-center font-medium tracking-wide text-[13px] text-white text-shadow-sm">
              {name}
            </div>
          </button>
        ))}
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={handleReset}>
          Reset to Default
        </Button>
      </div>

      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ChevronDown className="h-4 w-4" />
          Advanced Color Options
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-4 pt-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {renderColorInput('background', 'Background')}
            {renderColorInput('foreground', 'Foreground')}
            {renderColorInput('card', 'Card')}
            {renderColorInput('cardForeground', 'Card Foreground')}
            {renderColorInput('popover', 'Popover')}
            {renderColorInput('popoverForeground', 'Popover Foreground')}
            {renderColorInput('primary', 'Primary')}
            {renderColorInput('primaryForeground', 'Primary Foreground')}
            {renderColorInput('secondary', 'Secondary')}
            {renderColorInput('secondaryForeground', 'Secondary Foreground')}
            {renderColorInput('muted', 'Muted')}
            {renderColorInput('mutedForeground', 'Muted Foreground')}
            {renderColorInput('accent', 'Accent')}
            {renderColorInput('accentForeground', 'Accent Foreground')}
            {renderColorInput('destructive', 'Destructive')}
            {renderColorInput(
              'destructiveForeground',
              'Destructive Foreground'
            )}
            {renderColorInput('border', 'Border')}
            {renderColorInput('input', 'Input')}
            {renderColorInput('ring', 'Ring')}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export function ThemeCustomizer({
  onColorChange,
  initialColors,
  livePreview = true,
}: ThemeCustomizerProps) {
  return (
    <SimpleThemeCustomizer
      onColorChange={onColorChange}
      initialColors={initialColors}
      livePreview={livePreview}
    />
  )
}
