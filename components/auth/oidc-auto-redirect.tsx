'use client'

import { useEffect } from 'react'

import Link from 'next/link'

import { AlertCircle } from 'lucide-react'
import { signIn } from 'next-auth/react'

import { AuthFooter, authLinkClassName } from '@/components/auth/auth-shell'
import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'

import { LOCAL_SIGN_IN_PATH, getOidcErrorMessage } from '@/lib/auth/sign-in'

interface OidcAutoRedirectProps {
  buttonText: string
  errorCode?: string
}

function redirectToOidc() {
  signIn('oidc', { callbackUrl: '/dashboard' })
}

export function OidcAutoRedirect({
  buttonText,
  errorCode,
}: Readonly<OidcAutoRedirectProps>) {
  useEffect(() => {
    if (!errorCode) {
      redirectToOidc()
    }
    // Only auto-fire on first mount for a given error state,
    // or a persistently failing provider becomes a redirect loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <div className="space-y-6">
        {errorCode ? (
          <Alert variant="destructive">
            <AlertCircle aria-hidden="true" />
            <AlertDescription>
              {getOidcErrorMessage(errorCode)}
            </AlertDescription>
          </Alert>
        ) : (
          <p
            role="status"
            className="text-center text-sm leading-relaxed text-muted-foreground"
          >
            Taking you to your organization’s sign-in page…
          </p>
        )}
        <Button type="button" className="h-11 w-full" onClick={redirectToOidc}>
          {errorCode ? (
            buttonText
          ) : (
            <>
              <Icons.spinner className="animate-spin" aria-hidden="true" />
              {buttonText}
            </>
          )}
        </Button>
      </div>
      <AuthFooter>
        <Link href={LOCAL_SIGN_IN_PATH} className={authLinkClassName}>
          Use local sign-in instead
        </Link>
      </AuthFooter>
    </div>
  )
}
