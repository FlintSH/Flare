import { z } from 'zod'

import { prisma } from '@/lib/database/prisma'

import { savePreference } from './preferences'

/** Tips a page shows an account until it hides them. */
export const TIPS = ['upload'] as const
export type Tip = (typeof TIPS)[number]

export const hideTipSchema = z.strictObject({ hide: z.enum(TIPS) })

/** The tips a saved `tips` preference hides, ignoring ones Flare dropped. */
export function readHiddenTips(part: unknown): Tip[] {
  const hidden =
    part && typeof part === 'object' && !Array.isArray(part)
      ? (part as { hidden?: unknown }).hidden
      : undefined
  return Array.isArray(hidden) ? TIPS.filter((tip) => hidden.includes(tip)) : []
}

export async function hiddenTips(userId: string): Promise<Tip[]> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  })
  const preferences = user?.preferences
  return readHiddenTips(
    preferences &&
      typeof preferences === 'object' &&
      !Array.isArray(preferences)
      ? preferences.tips
      : undefined
  )
}

/** Hides a tip for good, on every device. Answers every hidden tip. */
export async function hideTip(userId: string, tip: Tip): Promise<Tip[]> {
  const saved = await savePreference(userId, 'tips', (current) => ({
    hidden: [...new Set([...readHiddenTips(current), tip])],
  }))
  return readHiddenTips(saved)
}
