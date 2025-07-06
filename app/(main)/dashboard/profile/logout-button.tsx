'use client'

import { LogOut } from 'lucide-react'
import { signOut } from 'next-auth/react'

import { Button } from '@/components/ui/button'

import { useToast } from '@/hooks/use-toast'

export function LogoutButton() {
  const { toast } = useToast()

  const handleLogout = async () => {
    try {
      await signOut({ callbackUrl: '/' })
    } catch (error) {
      console.error('Logout error:', error)
      toast({
        title: 'Error',
        description: 'Failed to logout',
        variant: 'destructive',
      })
    }
  }

  return (
    <Button
      variant="outline"
      onClick={handleLogout}
      className="flex items-center gap-2"
    >
      <LogOut className="h-4 w-4" />
      Sign Out
    </Button>
  )
}
