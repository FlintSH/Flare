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
        <Label>Upload Token</Label>
        <p className="text-sm text-muted-foreground">
          This token is used to authenticate your uploads. Keep it secret and
          refresh it if it gets compromised.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Input
              value={uploadToken || ''}
              readOnly
              type={showToken ? 'text' : 'password'}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 px-2"
              onClick={() => setShowToken(!showToken)}
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
