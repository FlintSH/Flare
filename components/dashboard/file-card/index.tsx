'use client'

import { useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'

import { FileType } from '@/types/components/file'
import { ExpiryAction } from '@/types/events'
import { format, formatDistanceToNow, isBefore } from 'date-fns'
import {
  Clock,
  Download,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Link as LinkIcon,
  Lock,
  ScanText,
  Timer,
  Trash2,
} from 'lucide-react'

import { getFileIcon } from '@/components/dashboard/file-card/utils'
import { ExpiryModal } from '@/components/shared/expiry-modal'
import { Icons } from '@/components/shared/icons'
import { OcrDialog } from '@/components/shared/ocr-dialog'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { formatFileSize, getRelativeTime } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { useToast } from '@/hooks/use-toast'

interface FileCardProps {
  file: FileType
  onDelete?: (id: string) => void
}

export function FileCard({ file: initialFile, onDelete }: FileCardProps) {
  const { toast } = useToast()
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [isVisibilityDialogOpen, setIsVisibilityDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [password, setPassword] = useState(initialFile.password || '')
  const [file, setFile] = useState(initialFile)
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE'>(
    file.visibility
  )
  const [isDeleted, setIsDeleted] = useState(false)
  const [isLoadingOcr, setIsLoadingOcr] = useState(false)
  const [ocrText, setOcrText] = useState<string | null>(null)
  const [isOcrDialogOpen, setIsOcrDialogOpen] = useState(false)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [ocrConfidence, setOcrConfidence] = useState<number | null>(null)
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)

  const handleCopyLink = () => {
    const safeUrl = sanitizeUrl(file.urlPath)
    navigator.clipboard.writeText(`${window.location.origin}${safeUrl}`)
    toast({
      title: 'Link copied',
      description: 'File link has been copied to clipboard',
    })
  }

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error()

      setIsDeleted(true)

      if (onDelete) {
        onDelete(file.id)
      }

      toast({
        title: 'File deleted',
        description: 'The file has been permanently deleted',
      })
    } catch {
      toast({
        title: 'Failed to delete file',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  if (isDeleted) {
    return null
  }

  const handlePasswordUpdate = async () => {
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: password || null }),
      })
      if (!response.ok) throw new Error()
      toast({
        title: password
          ? 'Password protection enabled'
          : 'Password protection disabled',
        description: password
          ? 'File is now password protected'
          : 'Password protection has been removed',
      })
      setIsPasswordDialogOpen(false)
      setFile((prev) => ({ ...prev, password: password || null }))
    } catch {
      toast({
        title: 'Failed to update password',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  const handleVisibilityUpdate = async () => {
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ visibility }),
      })
      if (!response.ok) throw new Error()
      toast({
        title: 'Visibility updated',
        description: 'File visibility has been updated',
      })
      setIsVisibilityDialogOpen(false)
      setFile((prev) => ({ ...prev, visibility }))
    } catch {
      toast({
        title: 'Failed to update visibility',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  const handleFetchOcr = async () => {
    setIsLoadingOcr(true)
    setOcrError(null)
    try {
      const response = await fetch(`/api/files/${file.id}/ocr`, {
        method: 'GET',
      })
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to process OCR')
      }

      const data = await response.json()

      if (!data.success) {
        setOcrError(data.error || 'There was an error processing the image')
        setOcrText(null)
        setOcrConfidence(null)
      } else {
        setOcrText(data.text)
        setOcrConfidence(data.confidence)
        setOcrError(null)
      }
      setIsOcrDialogOpen(true)
    } catch (error) {
      toast({
        title: 'Failed to extract text',
        description:
          error instanceof Error ? error.message : 'Please try again',
        variant: 'destructive',
      })
    } finally {
      setIsLoadingOcr(false)
    }
  }

  const handleExpiryUpdate = async (
    expiresAt: Date | null,
    action?: ExpiryAction
  ) => {
    try {
      if (expiresAt) {
        const response = await fetch(`/api/files/${file.id}/expiry`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            expiresAt: expiresAt.toISOString(),
            action: action || ExpiryAction.DELETE,
          }),
        })

        if (!response.ok) throw new Error()

        toast({
          title: 'Expiration set',
          description: 'File expiration has been updated successfully',
        })
      } else {
        const response = await fetch(`/api/files/${file.id}/expiry`, {
          method: 'DELETE',
        })

        if (!response.ok) throw new Error()

        toast({
          title: 'Expiration removed',
          description: 'File expiration has been removed',
        })
      }

      setFile((prev) => ({
        ...prev,
        expiresAt: expiresAt?.toISOString() || null,
      }))
    } catch {
      toast({
        title: 'Failed to update expiration',
        description: 'Please try again',
        variant: 'destructive',
      })
    }
  }

  const isImage = file.mimeType.startsWith('image/')

  return (
    <Card className="group relative overflow-hidden bg-background/40 backdrop-blur-xl border-border/50 shadow-lg shadow-black/5 hover:shadow-xl hover:shadow-black/10 transition-all duration-300 hover:bg-background/60">
      {}
      <div className="relative">
        <Link href={sanitizeUrl(file.urlPath)} className="block">
          {isImage ? (
            <div className="relative aspect-square">
              <Image
                src={`/api/files/${file.id}/thumbnail`}
                alt={file.name}
                fill
                className="object-cover"
                sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                priority={false}
                loading="lazy"
              />
              {isLoadingOcr && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-sm">
                  <div className="flex flex-col items-center gap-2">
                    <Icons.spinner className="h-8 w-8 animate-spin text-white" />
                    <span className="text-sm text-white font-medium">
                      Processing OCR...
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="relative aspect-square bg-muted flex items-center justify-center">
              {getFileIcon(file.mimeType, 'h-16 w-16 text-muted-foreground')}
            </div>
          )}
        </Link>

        {}
        <div
          className={`absolute inset-0 bg-black/50 opacity-0 ${!isLoadingOcr && 'group-hover:opacity-100'} transition-opacity flex flex-col items-center justify-center gap-3`}
        >
          {}
          <Button variant="secondary" className="glass-hover" size="sm" asChild>
            <Link href={sanitizeUrl(file.urlPath)}>View</Link>
          </Button>

          {}
          <div className="flex gap-1">
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 glass-hover"
                    onClick={handleCopyLink}
                  >
                    <LinkIcon className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy link</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 glass-hover"
                    asChild
                  >
                    <a
                      href={`/api/files/${file.id}/download`}
                      download={file.name}
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Download</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 glass-hover"
                    onClick={() => setIsVisibilityDialogOpen(true)}
                  >
                    <EyeOff className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Change visibility</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 glass-hover"
                    onClick={() => setIsPasswordDialogOpen(true)}
                  >
                    <KeyRound className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Password protect</TooltipContent>
              </Tooltip>
              {isImage && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-8 w-8 glass-hover"
                      onClick={handleFetchOcr}
                      disabled={isLoadingOcr}
                    >
                      <ScanText className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Extract text (OCR)</TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 glass-hover"
                    onClick={() => setIsExpiryModalOpen(true)}
                  >
                    <Timer className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Manage expiration</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="secondary"
                    size="icon"
                    className="h-8 w-8 glass-hover"
                    onClick={() => setIsDeleteDialogOpen(true)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Delete</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {}
        <div className="absolute bottom-2 left-2">
          <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 text-xs backdrop-blur-sm">
            {file.password ? (
              <>
                <KeyRound className="h-3 w-3" />
                Protected
              </>
            ) : file.visibility === 'PUBLIC' ? (
              <>
                <Globe className="h-3 w-3" />
                Public
              </>
            ) : (
              <>
                <Lock className="h-3 w-3" />
                Private
              </>
            )}
          </div>
        </div>

        {}
        {file.expiresAt && (
          <div className="absolute top-2 right-2">
            <TooltipProvider delayDuration={150}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`flex items-center gap-1 px-2 py-1 rounded-md backdrop-blur-sm text-xs ${
                      isBefore(
                        new Date(file.expiresAt),
                        new Date(Date.now() + 24 * 60 * 60 * 1000)
                      )
                        ? 'bg-red-500/90 text-white'
                        : isBefore(
                              new Date(file.expiresAt),
                              new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                            )
                          ? 'bg-orange-500/90 text-white'
                          : 'bg-amber-500/90 text-white'
                    }`}
                  >
                    <Timer className="h-3 w-3" />
                    {formatDistanceToNow(new Date(file.expiresAt), {
                      addSuffix: true,
                    })}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" align="end" sideOffset={8}>
                  <div className="text-center">
                    <p className="font-medium">Auto-delete scheduled</p>
                    <p>{format(new Date(file.expiresAt), 'PPP p')}</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {}
        <div className="absolute bottom-2 right-2">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 text-xs backdrop-blur-sm">
                  <Clock className="h-3 w-3" />
                  {getRelativeTime(new Date(file.uploadedAt))}
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" align="end" sideOffset={8}>
                {new Date(file.uploadedAt).toLocaleDateString(undefined, {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>

      {}
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={sanitizeUrl(file.urlPath)}
                  className="font-medium hover:underline truncate block text-sm"
                >
                  {file.name}
                </Link>
              </TooltipTrigger>
              <TooltipContent side="top" align="start">
                {file.name}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatFileSize(file.size)}
          </span>
        </div>
        <div className="mt-1 flex items-center space-x-2 text-xs text-muted-foreground">
          <div className="flex items-center">
            <Eye className="mr-1 h-3 w-3" />
            {file.views}
          </div>
          <div className="flex items-center">
            <Download className="mr-1 h-3 w-3" />
            {file.downloads}
          </div>
        </div>
      </div>

      {}
      <Dialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Protection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty to remove protection"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsPasswordDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handlePasswordUpdate}>
                {password ? 'Enable Protection' : 'Remove Protection'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {}
      <Dialog
        open={isVisibilityDialogOpen}
        onOpenChange={setIsVisibilityDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Visibility</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <RadioGroup
              value={visibility}
              onValueChange={(value) =>
                setVisibility(value as 'PUBLIC' | 'PRIVATE')
              }
              className="space-y-3"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PUBLIC" id="public" />
                <Label htmlFor="public" className="flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Public
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PRIVATE" id="private" />
                <Label htmlFor="private" className="flex items-center gap-2">
                  <Lock className="h-4 w-4" />
                  Private
                </Label>
              </div>
            </RadioGroup>
            <div className="text-sm text-muted-foreground mt-2">
              {visibility === 'PUBLIC'
                ? 'Public files can be accessed by anyone with the link.'
                : 'Private files require authentication to access.'}
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsVisibilityDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleVisibilityUpdate}>
                Update Visibility
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p>
              Are you sure you want to delete this file? This action cannot be
              undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setIsDeleteDialogOpen(false)
                  handleDelete()
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {}
      <OcrDialog
        isOpen={isOcrDialogOpen}
        onOpenChange={setIsOcrDialogOpen}
        text={ocrText}
        error={ocrError}
        confidence={ocrConfidence}
        filename={file.name}
      />

      {}
      <ExpiryModal
        isOpen={isExpiryModalOpen}
        onOpenChange={setIsExpiryModalOpen}
        onConfirm={handleExpiryUpdate}
        initialDate={file.expiresAt ? new Date(file.expiresAt) : null}
        title="Manage File Expiration"
        description="Set when this file should be automatically deleted"
      />
    </Card>
  )
}
