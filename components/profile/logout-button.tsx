'use client'

import { LogOut } from 'lucide-react'

import { Button } from '@/components/ui/button'

import { useSignOut } from '@/hooks/use-sign-out'

export function LogoutButton() {
  const handleLogout = useSignOut()

  return (
    <Button
      variant="outline"
      onClick={handleLogout}
      className="flex items-center gap-2"
    >
      <LogOut className="h-4 w-4" />
      Sign out
    </Button>
  )
}
