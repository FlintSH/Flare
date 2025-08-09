'use client'

import { useEffect, useState } from 'react'

import { useSession } from 'next-auth/react'

import { Icons } from '@/components/shared/icons'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

interface ConnectedAccount {
  id: string
  provider: string
  providerAccountId: string
  type: string
}

export function SSOSettings() {
  const { data: _session } = useSession()
  const [connectedAccounts, setConnectedAccounts] = useState<
    ConnectedAccount[]
  >([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    fetchConnectedAccounts()
  }, [])

  const fetchConnectedAccounts = async () => {
    try {
      const response = await fetch('/api/profile/connected-accounts')
      if (response.ok) {
        const accounts = await response.json()
        setConnectedAccounts(accounts)
      }
    } catch (error) {
      console.error('Failed to fetch connected accounts:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisconnectAccount = async (accountId: string) => {
    try {
      const response = await fetch(
        `/api/profile/connected-accounts/${accountId}`,
        {
          method: 'DELETE',
        }
      )

      if (response.ok) {
        setConnectedAccounts((accounts) =>
          accounts.filter((account) => account.id !== accountId)
        )
      }
    } catch (error) {
      console.error('Failed to disconnect account:', error)
    }
  }

  const getProviderIcon = (provider: string) => {
    switch (provider) {
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

  const getProviderName = (provider: string) => {
    switch (provider) {
      case 'google':
        return 'Google'
      case 'github':
        return 'GitHub'
      case 'azure-ad':
        return 'Microsoft'
      case 'saml':
        return 'Enterprise SSO'
      default:
        return provider
    }
  }

  const hasPasswordAuth = connectedAccounts.some(
    (account) => account.type === 'credentials'
  )
  const canDisconnect = connectedAccounts.length > 1 || hasPasswordAuth

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Icons.user className="h-5 w-5" />
          <span>Connected Accounts</span>
        </CardTitle>
        <CardDescription>
          Manage your connected social accounts and SSO providers
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!canDisconnect && (
          <Alert>
            <Icons.alertCircle className="h-4 w-4" />
            <AlertDescription>
              You must have at least one authentication method connected to your
              account. Add a password or connect another account before
              disconnecting.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Icons.spinner className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {connectedAccounts.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No connected accounts found
              </p>
            ) : (
              connectedAccounts.map((account) => (
                <div
                  key={account.id}
                  className="flex items-center justify-between p-4 border rounded-lg"
                >
                  <div className="flex items-center space-x-3">
                    {getProviderIcon(account.provider)}
                    <div>
                      <div className="font-medium">
                        {getProviderName(account.provider)}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Connected via {account.type}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold bg-secondary text-secondary-foreground">
                      Connected
                    </span>
                    {canDisconnect && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDisconnectAccount(account.id)}
                      >
                        Disconnect
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        <Separator />

        <div>
          <h4 className="font-medium mb-2">Connect New Account</h4>
          <p className="text-sm text-muted-foreground mb-4">
            Link additional accounts to sign in with multiple providers
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" className="justify-start">
              <Icons.google />
              <span className="ml-2">Connect Google</span>
            </Button>
            <Button variant="outline" className="justify-start">
              <Icons.gitHub />
              <span className="ml-2">Connect GitHub</span>
            </Button>
            <Button variant="outline" className="justify-start">
              <Icons.microsoft />
              <span className="ml-2">Connect Microsoft</span>
            </Button>
            <Button variant="outline" className="justify-start">
              <Icons.building />
              <span className="ml-2">Enterprise SSO</span>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
