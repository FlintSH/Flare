import { z } from 'zod'

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex color')
const paletteShape = {
  background: color,
  foreground: color,
  card: color,
  cardForeground: color,
  popover: color,
  popoverForeground: color,
  primary: color,
  primaryForeground: color,
  secondary: color,
  secondaryForeground: color,
  muted: color,
  mutedForeground: color,
  accent: color,
  accentForeground: color,
  destructive: color,
  destructiveForeground: color,
  border: color,
  input: color,
  ring: color,
}

export const paletteSchema = z.object(paletteShape).strict()
export type Palette = z.infer<typeof paletteSchema>

export const DARK_PALETTE: Palette = {
  background: '#020817',
  foreground: '#f8fafc',
  card: '#020817',
  cardForeground: '#f8fafc',
  popover: '#020817',
  popoverForeground: '#f8fafc',
  primary: '#f8fafc',
  primaryForeground: '#0f172a',
  secondary: '#1e293b',
  secondaryForeground: '#f8fafc',
  muted: '#1e293b',
  mutedForeground: '#94a3b8',
  accent: '#1e293b',
  accentForeground: '#f8fafc',
  destructive: '#991b1b',
  destructiveForeground: '#f8fafc',
  border: '#1e293b',
  input: '#1e293b',
  ring: '#cbd5e1',
}

export const LIGHT_PALETTE: Palette = {
  background: '#f8fafc',
  foreground: '#0f172a',
  card: '#ffffff',
  cardForeground: '#0f172a',
  popover: '#ffffff',
  popoverForeground: '#0f172a',
  primary: '#0f172a',
  primaryForeground: '#f8fafc',
  secondary: '#e2e8f0',
  secondaryForeground: '#0f172a',
  muted: '#f1f5f9',
  mutedForeground: '#475569',
  accent: '#e2e8f0',
  accentForeground: '#0f172a',
  destructive: '#dc2626',
  destructiveForeground: '#ffffff',
  border: '#cbd5e1',
  input: '#cbd5e1',
  ring: '#64748b',
}

// Packs cannot cause external requests or introduce executable image formats.
// Uploaded raster assets are embedded, so a pack remains portable.
const logoSchema = z
  .string()
  .max(360_000)
  .refine((value) => {
    if (value === '') return true
    const match =
      /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
    if (!match) return false
    try {
      const bytes = atob(match[2])
      if (bytes.length > 256 * 1024) return false
      if (match[1] === 'png') return bytes.startsWith('\x89PNG\r\n\x1a\n')
      if (match[1] === 'jpeg') return bytes.startsWith('\xff\xd8\xff')
      return bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP'
    } catch {
      return false
    }
  }, 'Upload a PNG, JPEG, or WebP logo')

export const SHARE_TEMPLATE_FIELDS = [
  'instanceName',
  'filename',
  'size',
  'uploader',
] as const
const templateSchema = z
  .string()
  .max(500)
  .refine((value) => {
    const remaining = value.replace(
      /\{\{([^{}]+)\}\}/g,
      (_match, field: string) =>
        (SHARE_TEMPLATE_FIELDS as readonly string[]).includes(field.trim())
          ? ''
          : '{invalid}'
    )
    return !/[{}]/.test(remaining)
  }, 'Use only {{instanceName}}, {{filename}}, {{size}}, or {{uploader}} placeholders')

export const appearanceDocumentSchema = z
  .object({
    brand: z
      .object({
        name: z.string().trim().min(1).max(60),
        tagline: z.string().trim().max(180),
        logoLight: logoSchema,
        logoDark: logoSchema,
        footerText: z.string().trim().max(200),
      })
      .strict(),
    theme: z
      .object({
        enabled: z.boolean(),
        defaultMode: z.enum(['system', 'light', 'dark']),
        light: paletteSchema,
        dark: paletteSchema,
        radius: z.number().min(0).max(1.5),
        background: z.enum(['glow', 'plain', 'grid']),
        font: z.enum(['inter', 'system', 'mono']),
      })
      .strict(),
    sharing: z
      .object({
        defaultStyle: z.enum(['minimal', 'framed', 'delivery']),
        showUploader: z.boolean(),
        showFilename: z.boolean(),
        showSize: z.boolean(),
        showFooter: z.boolean().nullable(),
        imageFit: z.enum(['contain', 'cover']).default('contain'),
        titleTemplate: templateSchema.default(''),
        descriptionTemplate: templateSchema.default(''),
      })
      .strict(),
  })
  .strict()

export type AppearanceDocument = z.infer<typeof appearanceDocumentSchema>
export type ShareStyle = AppearanceDocument['sharing']['defaultStyle']

export const DEFAULT_APPEARANCE: AppearanceDocument = {
  brand: {
    name: 'Flare',
    tagline: 'A free, modern, open source file upload platform',
    logoLight: '',
    logoDark: '',
    footerText: 'Flare is a free, open source, self-hostable file host.',
  },
  theme: {
    enabled: false,
    defaultMode: 'dark',
    light: LIGHT_PALETTE,
    dark: DARK_PALETTE,
    radius: 0.75,
    background: 'glow',
    font: 'inter',
  },
  sharing: {
    defaultStyle: 'framed',
    showUploader: true,
    showFilename: true,
    showSize: true,
    showFooter: null,
    imageFit: 'contain',
    titleTemplate: '',
    descriptionTemplate: '',
  },
}

export const customizationSchema = z
  .object({
    version: z.literal(1).default(1),
    revision: z.number().int().nonnegative().default(0),
    published: appearanceDocumentSchema.default(DEFAULT_APPEARANCE),
    draft: appearanceDocumentSchema.nullable().default(null),
    previous: appearanceDocumentSchema.nullable().default(null),
    publishedAt: z.string().datetime().nullable().default(null),
  })
  .strict()

export type CustomizationState = z.infer<typeof customizationSchema>
export const DEFAULT_CUSTOMIZATION = customizationSchema.parse({})

export const appearancePackSchema = z
  .object({
    kind: z.literal('flare.appearance'),
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    appearance: appearanceDocumentSchema,
  })
  .strict()
export type AppearancePack = z.infer<typeof appearancePackSchema>

export const appearanceCommandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('save'),
      revision: z.number().int().nonnegative(),
      document: appearanceDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('publish'),
      revision: z.number().int().nonnegative(),
      document: appearanceDocumentSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal('restore'),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('discard'),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      action: z.literal('import'),
      revision: z.number().int().nonnegative(),
      pack: appearancePackSchema,
    })
    .strict(),
])
export type AppearanceCommand = z.infer<typeof appearanceCommandSchema>

export const personalAppearanceSchema = z
  .object({
    themeMode: z
      .enum(['inherit', 'system', 'light', 'dark'])
      .default('inherit'),
  })
  .strict()
export type PersonalAppearance = z.infer<typeof personalAppearanceSchema>

export function readPersonalAppearance(
  preferences: unknown
): PersonalAppearance {
  const record =
    preferences && typeof preferences === 'object'
      ? (preferences as Record<string, unknown>)
      : {}
  const result = personalAppearanceSchema.safeParse(record.customization || {})
  return result.success ? result.data : { themeMode: 'inherit' }
}

export function resolveShareStyle(
  options: unknown,
  fallback: ShareStyle
): ShareStyle {
  const style =
    options && typeof options === 'object'
      ? (options as Record<string, unknown>).shareStyle
      : undefined
  return style === 'minimal' || style === 'framed' || style === 'delivery'
    ? style
    : fallback
}
