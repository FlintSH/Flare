import { IntegrationsPanel } from '@/components/integrations/integrations-panel'

import { getPageSession } from '@/lib/auth/page-session'

export default async function IntegrationsPage() {
  await getPageSession()
  return <IntegrationsPanel />
}
