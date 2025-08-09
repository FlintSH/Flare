'use client'

import { useState } from 'react'

import { signIn } from 'next-auth/react'

import { Icons } from '@/components/shared/icons'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface SSOButtonsProps {
  providers?: Record<string, unknown>
  callbackUrl?: string
}

export function SSOButtons({
  providers,
  callbackUrl = '/dashboard',
}: SSOButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<string | null>(null)

  if (!providers) return null

  const oauthProviders = Object.values(providers).filter(
    (provider: unknown) =>
      typeof provider === 'object' &&
      provider !== null &&
      'type' in provider &&
      'id' in provider &&
      provider.type === 'oauth' &&
      provider.id !== 'credentials'
  )

  if (oauthProviders.length === 0) return null

  const handleSignIn = async (providerId: string) => {
    setLoadingProvider(providerId)
    try {
      await signIn(providerId, { callbackUrl })
    } catch (error) {
      console.error('SSO sign in error:', error)
    } finally {
      setLoadingProvider(null)
    }
  }

  const getProviderIcon = (providerId: string) => {
    switch (providerId) {
      case 'google':
        return <Icons.google />
      case 'github':
        return <Icons.gitHub />
      case 'azure-ad':
        return <Icons.microsoft />
      case 'saml':
        return <Icons.building />
      default:
        return <Icons.user />
    }
  }

  const getProviderName = (provider: { id: string; name: string }) => {
    switch (provider.id) {
      case 'google':
        return 'Google'
      case 'github':
        return 'GitHub'
      case 'azure-ad':
        return 'Microsoft'
      case 'saml':
        return 'Enterprise SSO'
      default:
        return provider.name
    }
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <div className="absolute inset-0 flex items-center">
          <Separator className="w-full" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-background px-2 text-muted-foreground">
            Or continue with
          </span>
        </div>
      </div>

      <div className="grid gap-2">
        {(oauthProviders as { id: string; name: string }[]).map((provider) => (
          <Button
            key={provider.id}
            variant="outline"
            type="button"
            disabled={loadingProvider !== null}
            onClick={() => handleSignIn(provider.id)}
            className="h-11 font-medium"
          >
            {loadingProvider === provider.id ? (
              <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              getProviderIcon(provider.id)
            )}
            <span className="ml-2">
              {loadingProvider === provider.id
                ? 'Connecting...'
                : `Continue with ${getProviderName(provider)}`}
            </span>
          </Button>
        ))}
      </div>
    </div>
  )
}
