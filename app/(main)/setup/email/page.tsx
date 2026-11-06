import { redirect } from 'next/navigation'

import { getSetupResumePath } from '@/lib/setup/navigation'

export default function SetupEmailPage() {
  redirect(getSetupResumePath('email'))
}
