'use client'

import { useEffect, useState } from 'react'

import { useRouter } from 'next/navigation'

import {
  Calendar,
  ChevronLeft,
  Code,
  Eye,
  File,
  FileImage,
  FileText,
  HardDrive,
  Lock,
  MoreVertical,
  Music,
  Shield,
  User,
  Video,
} from 'lucide-react'

import { FileActionsV2 } from '@/components/file/file-actions-v2'
// DropdownMenu imports removed - not used in this component

import { FileContentV2 } from '@/components/file/file-content-v2'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

import { formatFileSize } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { AuthGuard } from './protected/auth-guard'

interface FileViewerV2Props {
  file: {
    id: string
    name: string
    urlPath: string
    visibility: 'PUBLIC' | 'PRIVATE'
    password: string | null
    userId: string
    mimeType: string
    size: number
    uploadedAt: string
    views?: number
    downloads?: number
    user: {
      name: string
      image?: string
      urlId: string
    }
  }
  verifiedPassword?: string
}

export function FileViewerV2({
  file,
  verifiedPassword: initialVerifiedPassword,
}: FileViewerV2Props) {
  const router = useRouter()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showMetadata, setShowMetadata] = useState(false)

  // Get file type classification
  const isImage = file.mimeType.startsWith('image/')
  const isVideo = file.mimeType.startsWith('video/')
  const isAudio = file.mimeType.startsWith('audio/')
  const isDocument =
    file.mimeType.includes('pdf') || file.mimeType.includes('text/')
  const isCode =
    file.mimeType.includes('json') ||
    file.mimeType.includes('javascript') ||
    file.mimeType.includes('typescript')

  // Handle escape key for fullscreen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }

    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = 'auto'
    }
  }, [isFullscreen])

  const getFileTypeIcon = () => {
    if (isImage) return <FileImage className="h-5 w-5" />
    if (isVideo) return <Video className="h-5 w-5" />
    if (isAudio) return <Music className="h-5 w-5" />
    if (isDocument) return <FileText className="h-5 w-5" />
    if (isCode) return <Code className="h-5 w-5" />
    return <File className="h-5 w-5" />
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const FileMetadata = () => (
    <Card className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">File Information</h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowMetadata(false)}
          className="md:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
      </div>

      <div className="space-y-3 text-sm">
        <div className="flex items-center gap-2">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Size:</span>
          <span className="font-medium">{formatFileSize(file.size)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Uploaded:</span>
          <span className="font-medium">{formatDate(file.uploadedAt)}</span>
        </div>

        {file.views !== undefined && (
          <div className="flex items-center gap-2">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Views:</span>
            <span className="font-medium">{file.views.toLocaleString()}</span>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Visibility:</span>
          <Badge
            variant={file.visibility === 'PUBLIC' ? 'default' : 'secondary'}
          >
            {file.visibility.toLowerCase()}
          </Badge>
        </div>

        {file.password && (
          <div className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Password protected</span>
          </div>
        )}

        <Separator />

        <div className="flex items-center gap-2">
          <User className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">Uploaded by:</span>
        </div>
        <div className="flex items-center gap-2 ml-6">
          <Avatar className="h-6 w-6">
            <AvatarImage src={file.user.image} alt={file.user.name} />
            <AvatarFallback className="text-xs">
              {file.user.name?.charAt(0) || '?'}
            </AvatarFallback>
          </Avatar>
          <span className="font-medium">{file.user.name}</span>
        </div>
      </div>
    </Card>
  )

  return (
    <AuthGuard file={file}>
      {(authGuardVerifiedPassword) => {
        const currentVerifiedPassword =
          authGuardVerifiedPassword || initialVerifiedPassword

        return (
          <div
            className={`min-h-screen bg-background ${isFullscreen ? 'fixed inset-0 z-50' : ''}`}
          >
            {/* Header */}
            <div
              className={`sticky top-0 z-40 bg-background/80 backdrop-blur-sm border-b ${isFullscreen ? 'hidden' : ''}`}
            >
              <div className="container mx-auto px-4 py-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => router.back()}
                      className="md:hidden"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <div className="flex items-center gap-2">
                      {getFileTypeIcon()}
                      <div className="min-w-0">
                        <h1 className="font-semibold text-lg truncate max-w-[200px] md:max-w-[400px]">
                          {file.name}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                          {formatFileSize(file.size)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowMetadata(!showMetadata)}
                      className="md:hidden"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>

                    <div className="hidden md:flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage
                          src={file.user.image}
                          alt={file.user.name}
                        />
                        <AvatarFallback>
                          {file.user.name?.charAt(0) || '?'}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm font-medium">
                        {file.user.name}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Main Content */}
            <div className="container mx-auto px-4 py-6">
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* File Content */}
                <div className="lg:col-span-3">
                  <FileContentV2
                    file={file}
                    verifiedPassword={currentVerifiedPassword}
                    isFullscreen={isFullscreen}
                    onToggleFullscreen={setIsFullscreen}
                  />

                  {/* Actions */}
                  <div className="mt-4">
                    <FileActionsV2
                      urlPath={sanitizeUrl(file.urlPath)}
                      name={file.name}
                      fileId={file.id}
                      mimeType={file.mimeType}
                      verifiedPassword={currentVerifiedPassword}
                    />
                  </div>
                </div>

                {/* Sidebar - Desktop */}
                <div className="hidden lg:block">
                  <FileMetadata />
                </div>

                {/* Sidebar - Mobile (Conditional) */}
                {showMetadata && (
                  <div className="lg:hidden fixed inset-0 z-50 bg-background p-4">
                    <FileMetadata />
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      }}
    </AuthGuard>
  )
}
