'use client'

import { useEffect } from 'react'

import { PENDING_COOKIE, RESUME_PATH } from '@/lib/oauth/constants'

/** One navigation, however often the shell mounts before the page unloads. */
let resumed = false

/**
 * Takes a browser that has just signed in back to the agent that was waiting
 * for it. A password sign-in ends in a client-side move to the dashboard, a
 * data request the proxy does not redirect, so the signed-in shell looks for
 * the waiting cookie itself. It draws nothing.
 */
export function ResumeAgentSignIn() {
  useEffect(() => {
    if (resumed || !document.cookie.split('; ').includes(`${PENDING_COOKIE}=1`))
      return
    resumed = true
    // Dropped here too, so a resume that fails cannot send the dashboard
    // round in a loop.
    document.cookie = `${PENDING_COOKIE}=; Max-Age=0; Path=/`
    window.location.assign(RESUME_PATH)
  }, [])
  return null
}
