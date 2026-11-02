'use client'

import { useState } from 'react'

import { UserList } from '@/components/dashboard/user-list'
import { InviteManager } from '@/components/invites/invite-manager'
import { pagePanelClassName } from '@/components/layout/page-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { cn } from '@/lib/utils'

type Tab = 'accounts' | 'invites'

export function UsersWorkspace({
  initialTab,
  showInvites,
}: {
  initialTab: Tab
  showInvites: boolean
}) {
  const [tab, setTab] = useState<Tab>(
    showInvites && initialTab === 'invites' ? 'invites' : 'accounts'
  )
  if (!showInvites)
    return (
      <div className={pagePanelClassName}>
        <UserList />
      </div>
    )
  return (
    <Tabs
      value={tab}
      onValueChange={(value) => {
        const next = value as Tab
        setTab(next)
        const url = new URL(window.location.href)
        if (next === 'invites') url.searchParams.set('tab', 'invites')
        else url.searchParams.delete('tab')
        window.history.replaceState(null, '', url.pathname + url.search)
      }}
      className="space-y-4"
    >
      <TabsList className="grid w-full grid-cols-2 sm:inline-grid sm:w-auto">
        <TabsTrigger value="accounts">Accounts</TabsTrigger>
        <TabsTrigger value="invites">Invites</TabsTrigger>
      </TabsList>
      <TabsContent
        value="accounts"
        tabIndex={-1}
        className={cn('mt-0', pagePanelClassName)}
      >
        <UserList />
      </TabsContent>
      <TabsContent
        value="invites"
        tabIndex={-1}
        className={cn('mt-0', pagePanelClassName)}
      >
        <InviteManager context="users" />
      </TabsContent>
    </Tabs>
  )
}
