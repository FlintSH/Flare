const exportProgress = new Map<
  string,
  {
    progress: number
    lastUpdated: number
  }
>()

export function updateProgress(userId: string, progress: number) {
  const clampedProgress = Math.max(0, Math.min(100, progress))
  exportProgress.set(userId, {
    progress: clampedProgress,
    lastUpdated: Date.now(),
  })
}

export function clearProgress(userId: string) {
  exportProgress.delete(userId)
}
export function getProgress(userId: string): number {
  const entry = exportProgress.get(userId)

  if (!entry) return 0

  const now = Date.now()
  if (entry.progress < 100 && now - entry.lastUpdated > 30000) {
    updateProgress(userId, 100)
    return 100
  }

  return entry.progress
}
