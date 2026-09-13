'use client'

import { Eye, EyeOff } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useUploadToken } from '@/hooks/use-upload-token'

export function UploadToken() {
  const {
    uploadToken,
    isLoadingToken,
    showToken,
    setShowToken,
    handleRefreshToken,
  } = useUploadToken()

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="legacy-upload-token">Legacy upload token</Label>
        <p className="text-sm text-muted-foreground">
          Your existing screenshot tools can keep using this token. For new
          connections, create a token with its own permissions in Integrations.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Input
              id="legacy-upload-token"
              value={uploadToken || ''}
              readOnly
              type={showToken ? 'text' : 'password'}
              className="pr-12"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 px-2"
              onClick={() => setShowToken(!showToken)}
              aria-label={showToken ? 'Hide upload token' : 'Show upload token'}
              aria-pressed={showToken}
            >
              {showToken ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </Button>
          </div>
          <Button
            variant="outline"
            onClick={handleRefreshToken}
            disabled={isLoadingToken}
          >
            {isLoadingToken ? 'Refreshing...' : 'Refresh Token'}
          </Button>
        </div>
      </div>
    </div>
  )
}
