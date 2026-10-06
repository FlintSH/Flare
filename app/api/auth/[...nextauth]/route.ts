import NextAuth from 'next-auth/next'

import { withAuditRoute } from '@/lib/audit'
import { getAuthOptions } from '@/lib/auth'

type Handler = ReturnType<typeof NextAuth>

async function handler(...args: Parameters<Handler>) {
  return withAuditRoute(
    async () => {
      const options = await getAuthOptions()
      return NextAuth(options)(...args)
    },
    { route: '/api/auth/[...nextauth]' }
  )(args[0] instanceof Request ? args[0] : undefined)
}

// Password and passkey authorizers own durable authentication limits. NextAuth
// also posts session maintenance, client logs, and sign-out here; counting those
// as login attempts can lock a user out halfway through securing their account.
export { handler as GET, handler as POST }
