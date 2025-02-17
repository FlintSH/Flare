const exportProgress = new Map<string, number>()

export function updateProgress(userId: string, progress: number) {
  exportProgress.set(userId, progress)
}

export function clearProgress(userId: string) {
  exportProgress.delete(userId)
}

export function getProgress(userId: string): number {
  return exportProgress.get(userId) || 0
}
