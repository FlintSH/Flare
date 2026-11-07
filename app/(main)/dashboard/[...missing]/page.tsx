import { notFound } from 'next/navigation'

/** Match unknown workspace addresses without replacing any known page. */
export default function MissingDashboardPage() {
  // Interrupt synchronously, before page-level work can start streaming.
  // The local not-found boundary applies the existing session/email guard.
  notFound()
}
