import { redirect } from 'next/navigation'

export default function SetupEmailPage() {
  redirect('/setup?step=email')
}
