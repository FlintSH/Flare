// Use a more robust data structure for tracking export progress
const exportProgress = new Map<
  string,
  {
    progress: number
    lastUpdated: number
  }
>()

/**
 * Update the progress for a user's export operation
 * @param userId User ID
 * @param progress Progress percentage (0-100)
 */
export function updateProgress(userId: string, progress: number) {
  // Clamp progress to valid range
  const clampedProgress = Math.max(0, Math.min(100, progress))

  exportProgress.set(userId, {
    progress: clampedProgress,
    lastUpdated: Date.now(),
  })
}

/**
 * Clear progress for a user's export operation
 * @param userId User ID
 */
export function clearProgress(userId: string) {
  exportProgress.delete(userId)
}

/**
 * Get current progress for a user's export operation
 * @param userId User ID
 * @returns Progress percentage (0-100)
 */
export function getProgress(userId: string): number {
  const entry = exportProgress.get(userId)

  if (!entry) return 0

  // If progress hasn't been updated in 30 seconds, assume the operation is stuck
  // and force progress to 100 to allow the client to proceed
  const now = Date.now()
  if (entry.progress < 100 && now - entry.lastUpdated > 30000) {
    updateProgress(userId, 100)
    return 100
  }

  return entry.progress
}
