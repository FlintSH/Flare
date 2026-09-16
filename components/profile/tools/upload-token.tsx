'use client'

import { Copy, Eye, EyeOff } from 'lucide-react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { useToast } from '@/hooks/use-toast'
import { useUploadToken } from '@/hooks/use-upload-token'

export function UploadToken() {
  const {
    uploadToken,
    isLoadingToken,
    showToken,
    setShowToken,
    handleRefreshToken,
  } = useUploadToken()
  const { toast } = useToast()

  const copyToken = async () => {
    if (!uploadToken) return
    try {
      await navigator.clipboard.writeText(uploadToken)
      toast({ title: 'Upload token copied' })
    } catch {
      toast({
        title: 'Could not copy token',
        description: 'Show the token and copy it manually.',
        variant: 'destructive',
      })
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="upload-token">Account upload token</Label>
        <p className="text-sm text-muted-foreground">
          Created automatically for your account and included in the downloads
          above. You only need to copy it when configuring another uploader
          manually.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Input
              id="upload-token"
              value={uploadToken || ''}
              readOnly
              type={showToken ? 'text' : 'password'}
              className="pr-12"
              placeholder={isLoadingToken ? 'Loading token…' : undefined}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-6 px-2"
              onClick={() => setShowToken(!showToken)}
              aria-label={showToken ? 'Hide upload token' : 'Show upload token'}
              aria-pressed={showToken}
              disabled={isLoadingToken || !uploadToken}
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
            onClick={copyToken}
            disabled={isLoadingToken || !uploadToken}
          >
            <Copy />
            Copy token
          </Button>
        </div>
      </div>
      <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Replacing this token disconnects tools using it. Download their
          configurations again afterward. Named API tokens are unaffected.
        </p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="shrink-0"
              disabled={isLoadingToken || !uploadToken}
            >
              Replace token
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace your upload token?</AlertDialogTitle>
              <AlertDialogDescription>
                Tools using your current account upload token will stop
                uploading. Download and import their configurations again, or
                update the token manually, to reconnect them.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRefreshToken}>
                Replace token
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
