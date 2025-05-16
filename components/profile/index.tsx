'use client'

import { useCallback } from 'react'

import { ProfileClientProps } from '@/types/components/profile'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import { ProfileAccount } from './account'
import { ProfileExport } from './export'
import { ProfileSecurity } from './security'
import { ProfileStorage } from './storage'
import { ProfileTools } from './tools'

export function ProfileClient({
  user,
  quotasEnabled,
  formattedQuota,
  formattedUsed,
  usagePercentage,
}: ProfileClientProps) {
  const handleRefresh = useCallback(() => {
    window.location.reload()
  }, [])

  return (
    <div className="container mx-auto py-6 space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Profile</h1>
        <p className="text-muted-foreground">
          Manage your account settings and preferences
        </p>
      </div>

      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="data">Data</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile Information</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileAccount user={user} onUpdate={handleRefresh} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storage Usage</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileStorage
                quotasEnabled={quotasEnabled}
                formattedQuota={formattedQuota}
                formattedUsed={formattedUsed}
                usagePercentage={usagePercentage}
                fileCount={user.fileCount}
                shortUrlCount={user.shortUrlCount}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Upload Tools</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileTools />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="security" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Security Settings</CardTitle>
            </CardHeader>
            <CardContent>
              <ProfileSecurity onUpdate={handleRefresh} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Data Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <ProfileExport />

              <Separator className="my-6" />

              <ProfileSecurity onUpdate={handleRefresh} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
