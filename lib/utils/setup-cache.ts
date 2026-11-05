export function markSetupAsCompleted() {
  const event = new CustomEvent('setup-completed', {
    detail: { completed: true },
  })
  window.dispatchEvent(event)
}
