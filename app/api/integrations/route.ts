import { NextResponse } from 'next/server'

import { requireSession } from '@/lib/http/access'
import { readJson } from '@/lib/http/request'
import { routes } from '@/lib/http/route'
import {
  listIntegrations,
  runIntegrationCommand,
} from '@/lib/integrations/service'

// Answers are private to the account, and command results can carry new secrets.
const noStore = { 'cache-control': 'no-store' }

const api = routes('/api/integrations', {
  failure: { message: 'Internal server error' },
})

export const GET = api(async (request) => {
  const { user } = await requireSession(request, [
    'tokens.manage',
    'webhooks.manage',
  ])
  return NextResponse.json(await listIntegrations(user), { headers: noStore })
})

export const POST = api(
  async (request) => {
    const { user } = await requireSession(request)
    const body = await readJson(request, { limit: 16_384 })
    return NextResponse.json(await runIntegrationCommand(user, body), {
      headers: noStore,
    })
  },
  {
    failure: {
      message:
        'Could not update integrations. Check the server database and encryption configuration.',
    },
  }
)
