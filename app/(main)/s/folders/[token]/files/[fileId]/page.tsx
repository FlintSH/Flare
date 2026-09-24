import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PublicState } from '@/components/auth/public-state'
import { Footer } from '@/components/layout/footer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { getAccessSession } from '@/lib/auth'
import { getConfig } from '@/lib/config'
import { prisma } from '@/lib/database/prisma'
import { checkFileAccess } from '@/lib/files/access'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Protected file',
  description: 'This file is protected.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
}

export default async function SharedFolderFilePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string; fileId: string }>
  searchParams: Promise<{ password?: string | string[] }>
}) {
  const { token, fileId } = await params
  const { password: providedPassword } = await searchParams
  if (
    !/^[A-Za-z0-9_-]{20,100}$/.test(token) ||
    (providedPassword !== undefined && typeof providedPassword !== 'string')
  ) {
    notFound()
  }

  // Recheck the current share and direct membership on every request, including
  // password submissions. An old tile must not grant access after a move or revoke.
  const file = await prisma.file.findFirst({
    where: {
      id: fileId,
      visibility: 'PUBLIC',
      folder: { shareToken: token },
    },
    select: {
      userId: true,
      visibility: true,
      password: true,
      urlPath: true,
    },
  })
  if (!file) notFound()

  const access = await checkFileAccess(
    file,
    await getAccessSession(),
    providedPassword
  )
  if (access.allowed) {
    // Only reveal the canonical filename after access succeeds. The existing
    // viewer independently applies file access checks again at the destination.
    const urlPath = file.urlPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')
    const query = providedPassword
      ? `?${new URLSearchParams({ password: providedPassword })}`
      : ''
    redirect(`${urlPath}${query}`)
  }
  if (access.reason === 'private') notFound()

  const config = await getConfig()
  const showFooter =
    config.settings.customization.published.sharing.showFooter ??
    config.settings.general.credits.showFooter
  const invalidPassword = access.reason === 'password_invalid'
  const opaquePath = `/s/folders/${encodeURIComponent(token)}/files/${encodeURIComponent(fileId)}`

  return (
    <PublicState
      compact
      title={invalidPassword ? 'Incorrect Password' : 'Password Protected File'}
      description={
        invalidPassword
          ? 'The password you entered is incorrect'
          : 'This file requires a password to access'
      }
      footer={showFooter ? <Footer /> : undefined}
    >
      <form className="space-y-4" action={opaquePath}>
        <div className="space-y-2">
          <Label htmlFor="share-password">File password</Label>
          <Input
            id="share-password"
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="Enter the password from the sender"
            className="h-11"
            aria-invalid={invalidPassword}
            aria-describedby={
              invalidPassword ? 'share-password-error' : undefined
            }
            required
            autoFocus
          />
          {invalidPassword && (
            <p
              id="share-password-error"
              role="alert"
              className="text-sm text-foreground"
            >
              That password didn’t match. Check with the sender and try again.
            </p>
          )}
        </div>
        <Button type="submit" className="h-11 w-full">
          {invalidPassword ? 'Try Again' : 'Access File'}
        </Button>
      </form>
    </PublicState>
  )
}
