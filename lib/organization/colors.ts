import { ORGANIZATION_COLORS } from '@/types/dto/folder'
import type { OrganizationColor } from '@/types/dto/folder'

// Static Tailwind class strings per color token. They must be written out in
// full (no dynamic interpolation) so Tailwind's JIT can detect them.
interface ColorClasses {
  // Solid swatch (color picker dots, folder icon accents).
  dot: string
  // Soft pill used for tag badges.
  badge: string
  // Subtle text accent used for folder icons in lists/sidebar.
  icon: string
}

const COLOR_MAP: Record<OrganizationColor, ColorClasses> = {
  slate: {
    dot: 'bg-slate-400',
    badge: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 border-slate-500/30',
    icon: 'text-slate-400',
  },
  red: {
    dot: 'bg-red-500',
    badge: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30',
    icon: 'text-red-500',
  },
  orange: {
    dot: 'bg-orange-500',
    badge:
      'bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30',
    icon: 'text-orange-500',
  },
  amber: {
    dot: 'bg-amber-500',
    badge:
      'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30',
    icon: 'text-amber-500',
  },
  green: {
    dot: 'bg-green-500',
    badge:
      'bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30',
    icon: 'text-green-500',
  },
  teal: {
    dot: 'bg-teal-500',
    badge: 'bg-teal-500/15 text-teal-600 dark:text-teal-400 border-teal-500/30',
    icon: 'text-teal-500',
  },
  blue: {
    dot: 'bg-blue-500',
    badge: 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30',
    icon: 'text-blue-500',
  },
  indigo: {
    dot: 'bg-indigo-500',
    badge:
      'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30',
    icon: 'text-indigo-500',
  },
  violet: {
    dot: 'bg-violet-500',
    badge:
      'bg-violet-500/15 text-violet-600 dark:text-violet-400 border-violet-500/30',
    icon: 'text-violet-500',
  },
  pink: {
    dot: 'bg-pink-500',
    badge: 'bg-pink-500/15 text-pink-600 dark:text-pink-400 border-pink-500/30',
    icon: 'text-pink-500',
  },
}

const DEFAULT_CLASSES: ColorClasses = {
  dot: 'bg-muted-foreground/40',
  badge: 'bg-muted text-muted-foreground border-border',
  icon: 'text-muted-foreground',
}

function isOrganizationColor(value: string | null): value is OrganizationColor {
  return value !== null && (ORGANIZATION_COLORS as readonly string[]).includes(value)
}

export function getColorClasses(color: string | null): ColorClasses {
  if (isOrganizationColor(color)) {
    return COLOR_MAP[color]
  }
  return DEFAULT_CLASSES
}

export { ORGANIZATION_COLORS }
export type { OrganizationColor }
