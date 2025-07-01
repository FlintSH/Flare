// Utility functions for managing setup status cache
// This can be used in setup forms, API routes, etc.

export const SETUP_STATUS_QUERY_KEY = ['setup-status']

// For use in components that don't have access to query client directly
export function markSetupAsCompleted() {
  // Dispatch a custom event that the setup checker can listen to
  const event = new CustomEvent('setup-completed', {
    detail: { completed: true },
  })
  window.dispatchEvent(event)
}

export function markSetupAsIncomplete() {
  // Dispatch a custom event that the setup checker can listen to
  const event = new CustomEvent('setup-incomplete', {
    detail: { completed: false },
  })
  window.dispatchEvent(event)
}
