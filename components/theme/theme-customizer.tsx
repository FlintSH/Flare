'use client'

import { useEffect, useState } from 'react'

import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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

function hexToHSL(hex: string): string {
  // Remove the hash if it exists
  hex = hex.replace('#', '')

  // Convert hex to RGB
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  // Find greatest and smallest channel values
  const cmin = Math.min(r, g, b)
  const cmax = Math.max(r, g, b)
  const delta = cmax - cmin
  let h = 0
  let s = 0
  let l = 0

  // Calculate hue
  if (delta === 0) h = 0
  else if (cmax === r) h = ((g - b) / delta) % 6
  else if (cmax === g) h = (b - r) / delta + 2
  else h = (r - g) / delta + 4

  h = Math.round(h * 60)
  if (h < 0) h += 360

  // Calculate lightness
  l = (cmax + cmin) / 2

  // Calculate saturation
  s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1))

  // Convert to percentages
  s = +(s * 100).toFixed(1)
  l = +(l * 100).toFixed(1)

  return `${h} ${s}% ${l}%`
}

function parseColor(color: string): string {
  if (!color) return '#000000'

  if (color.startsWith('#')) {
    return color
  }

  // Handle HSL values
  const parts = color.split(' ')
  if (parts.length === 1) {
    // Single number value (hue)
    const h = parseFloat(parts[0])
    if (!isNaN(h)) {
      return hslToHex(h, 100, 50) // Default to 100% saturation and 50% lightness
    }
  } else if (parts.length === 3) {
    // Full HSL value
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
}: ThemeCustomizerProps) {
  const [baseHue, setBaseHue] = useState(222.2) // Default hue
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
    }
  }, [initialColors])

  const handleHueChange = (newHue: number) => {
    setBaseHue(newHue)

    // Update all colors with the new hue while maintaining their original saturation and lightness
    // except for destructive colors
    const newColors: Partial<ColorConfig> = {}
    Object.entries(DEFAULT_COLORS).forEach(([key, value]) => {
      // Skip destructive colors
      if (key === 'destructive' || key === 'destructiveForeground') {
        newColors[key as keyof ColorConfig] = value
        return
      }
      const [, s, l] = value.split(' ')
      newColors[key as keyof ColorConfig] = `${newHue} ${s} ${l}`
    })

    // Update preview
    Object.entries(newColors).forEach(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      document.documentElement.style.setProperty(`--${cssKey}`, value)
    })

    // Immediately notify parent of color changes
    onColorChange(newColors)
  }

  const handleReset = () => {
    // Update preview
    Object.entries(DEFAULT_COLORS).forEach(([key, value]) => {
      const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      document.documentElement.style.setProperty(`--${cssKey}`, value)
    })
    setBaseHue(222.2)
    setColors(DEFAULT_COLORS)

    // Notify parent of reset
    onColorChange(DEFAULT_COLORS)
  }

  const updatePreview = (key: keyof ColorConfig, value: string) => {
    let cssValue = value
    if (value.startsWith('#')) {
      cssValue = hexToHSL(value)
    } else if (value.includes(' ')) {
      const [h, s, l] = value
        .split(' ')
        .map((v) => parseFloat(v.replace('%', '')))
      if (!isNaN(h) && !isNaN(s) && !isNaN(l)) {
        cssValue = `${h} ${s}% ${l}%`
      }
    }

    // Update preview only
    const cssKey = key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
    document.documentElement.style.setProperty(`--${cssKey}`, cssValue)
    setColors((prev) => ({ ...prev, [key]: value }))

    // Immediately notify parent of color change
    onColorChange({ [key]: value })
  }

  const handleColorChange = (key: keyof ColorConfig, value: string) => {
    updatePreview(key, value)
  }

  const renderColorInput = (key: keyof ColorConfig, label: string) => (
    <div key={key} className="grid gap-2">
      <Label htmlFor={key}>{label}</Label>
      <div className="flex gap-2">
        <Input
          id={key}
          type="color"
          value={parseColor(colors[key] || DEFAULT_COLORS[key])}
          className="w-12 p-1 h-9"
          onChange={(e) => handleColorChange(key, e.target.value)}
        />
        <Input
          value={colors[key] || DEFAULT_COLORS[key]}
          onChange={(e) => handleColorChange(key, e.target.value)}
          placeholder={`${label} color`}
        />
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-4">
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
          <div className="grid grid-cols-2 gap-4">
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
}: ThemeCustomizerProps) {
  return (
    <SimpleThemeCustomizer
      onColorChange={onColorChange}
      initialColors={initialColors}
    />
  )
}
