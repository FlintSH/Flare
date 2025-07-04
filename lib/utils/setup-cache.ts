export const SETUP_STATUS_QUERY_KEY = ['setup-status']

export function markSetupAsCompleted() {
  const event = new CustomEvent('setup-completed', {
    detail: { completed: true },
  })
  window.dispatchEvent(event)
}

export function markSetupAsIncomplete() {
  const event = new CustomEvent('setup-incomplete', {
    detail: { completed: false },
  })
  window.dispatchEvent(event)
}
