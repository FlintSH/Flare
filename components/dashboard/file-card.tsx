'use client'

import { useState } from 'react'

import Image from 'next/image'
import Link from 'next/link'

import {
  Archive,
  Clock,
  Download,
  Eye,
  EyeOff,
  File,
  FileCode,
  FileText,
  Globe,
  Image as ImageIcon,
  KeyRound,
  Link as LinkIcon,
  Lock,
  Music,
  ScanText,
  Table,
  Trash2,
  Video,
} from 'lucide-react'

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

import { formatFileSize } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { useToast } from '@/hooks/use-toast'

interface FileCardProps {
  file: {
    id: string
    name: string
    urlPath: string
    mimeType: string
    visibility: 'PUBLIC' | 'PRIVATE'
    password: string | null
    size: number
    uploadedAt: string
    views: number
    downloads: number
  }
  onDelete?: (id: string) => void
}

function getFileIcon(mimeType: string, className?: string) {
  // Common file type checks
  if (mimeType.startsWith('image/')) return <ImageIcon className={className} />
  if (mimeType.startsWith('video/')) return <Video className={className} />
  if (mimeType.startsWith('audio/')) return <Music className={className} />
  if (mimeType === 'application/pdf') return <FileText className={className} />

  // Code and text files
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('python') ||
    mimeType.includes('java') ||
    mimeType.includes('php') ||
    mimeType.includes('ruby') ||
    mimeType.includes('go') ||
    mimeType.includes('rust') ||
    mimeType.includes('html') ||
    mimeType.includes('css')
  ) {
    return <FileCode className={className} />
  }

  // Spreadsheets and data files
  if (
    mimeType.includes('csv') ||
    mimeType.includes('spreadsheet') ||
    mimeType.includes('excel') ||
    mimeType.includes('numbers')
  ) {
    return <Table className={className} />
  }

  // Archives
  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('rar') ||
    mimeType.includes('7z') ||
    mimeType.includes('gzip')
  ) {
    return <Archive className={className} />
  }

  // Text files
  if (
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml')
  ) {
    return <FileText className={className} />
  }

  // Default fallback
  return <File className={className} />
}

function getRelativeTime(date: Date): string {
  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000)

  if (diffInSeconds < 60) return 'just now'

  const diffInMinutes = Math.floor(diffInSeconds / 60)
  if (diffInMinutes < 60) return `${diffInMinutes}m ago`

  const diffInHours = Math.floor(diffInMinutes / 60)
  if (diffInHours < 24) return `${diffInHours}h ago`

  const diffInDays = Math.floor(diffInHours / 24)
  if (diffInDays < 30) return `${diffInDays}d ago`

  const diffInMonths = Math.floor(diffInDays / 30)
  if (diffInMonths < 12) return `${diffInMonths}mo ago`

  const diffInYears = Math.floor(diffInDays / 365)
  return `${diffInYears}y ago`
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

      // Set local deleted state
      setIsDeleted(true)

      // Call onDelete callback if provided
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

  // If file is deleted, don't render anything
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

  const isImage = file.mimeType.startsWith('image/')

  return (
    <Card className="group relative overflow-hidden">
      {/* Preview Section */}
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

        {/* Overlay with quick actions */}
        <div
          className={`absolute inset-0 bg-black/50 opacity-0 ${!isLoadingOcr && 'group-hover:opacity-100'} transition-opacity flex flex-col items-center justify-center gap-3`}
        >
          {/* Primary View button */}
          <Button variant="secondary" className="glass-hover" size="sm" asChild>
            <Link href={sanitizeUrl(file.urlPath)}>View</Link>
          </Button>

          {/* Action buttons row */}
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
                      href={`/api/files${sanitizeUrl(file.urlPath)}?download=true`}
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

        {/* Status badge */}
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

        {/* Upload time badge */}
        <div className="absolute bottom-2 right-2">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-background/80 text-xs backdrop-blur-sm">
                  <Clock className="h-3 w-3" />
                  {getRelativeTime(new Date(file.uploadedAt))}
                </div>
              </TooltipTrigger>
              <TooltipContent>
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

      {/* File info section */}
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
            <Eye className="h-3 w-3 mr-1" />
            <span>{file.views} views</span>
          </div>
          <div className="flex items-center">
            <Download className="h-3 w-3 mr-1" />
            <span>{file.downloads} downloads</span>
          </div>
        </div>
      </div>

      <Dialog
        open={isPasswordDialogOpen}
        onOpenChange={setIsPasswordDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Password Protection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="Leave empty to remove password protection"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <p className="text-sm text-muted-foreground">
                {file.password
                  ? 'Enter a new password or leave empty to disable password protection'
                  : 'Enter a password to enable protection'}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsPasswordDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handlePasswordUpdate}>
                {password ? 'Set Password' : 'Remove Password'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={isVisibilityDialogOpen}
        onOpenChange={setIsVisibilityDialogOpen}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Set Visibility</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <RadioGroup
              value={visibility}
              onValueChange={(value: 'PUBLIC' | 'PRIVATE') =>
                setVisibility(value)
              }
              className="flex flex-col gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PUBLIC" id="public" />
                <Label htmlFor="public">Public (visible to everyone)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="PRIVATE" id="private" />
                <Label htmlFor="private">Private (only visible to you)</Label>
              </div>
            </RadioGroup>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsVisibilityDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleVisibilityUpdate}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p>
              Are you sure you want to delete &quot;{file.name}&quot;? This
              action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => setIsDeleteDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  handleDelete()
                  setIsDeleteDialogOpen(false)
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <OcrDialog
        isOpen={isOcrDialogOpen}
        onOpenChange={setIsOcrDialogOpen}
        isLoading={isLoadingOcr}
        error={ocrError}
        text={ocrText}
        confidence={ocrConfidence}
      />
    </Card>
  )
}
