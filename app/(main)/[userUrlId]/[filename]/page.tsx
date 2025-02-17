import type { Metadata } from 'next'
import { headers } from 'next/headers'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { compare } from 'bcryptjs'
import { getServerSession } from 'next-auth'

import { ProtectedFile } from '@/components/file/protected-file'
import { Icons } from '@/components/shared/icons'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card } from '@/components/ui/card'

import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/database/prisma'
import { getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface FilePageProps {
  params: Promise<{ userUrlId: string; filename: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

interface PrismaFile {
  id: string
  name: string
  urlPath: string
  visibility: 'PUBLIC' | 'PRIVATE'
  password: string | null
  userId: string
  mimeType: string
  size: number
  uploadedAt: Date
  path: string
  user?: {
    name: string | null
    image: string | null
    urlId: string
  } | null
}

function prepareFileProps(file: PrismaFile) {
  const plainFile = JSON.parse(
    JSON.stringify({
      id: file.id,
      name: file.name,
      urlPath: file.urlPath,
      visibility: file.visibility,
      password: file.password,
      userId: file.userId,
      mimeType: file.mimeType,
      size: file.size,
      uploadedAt: file.uploadedAt,
      path: file.path,
      user: {
        name: file.user?.name || '',
        image: file.user?.image || undefined,
        urlId: file.user?.urlId || '',
      },
    })
  )

  return {
    id: plainFile.id,
    name: plainFile.name,
    urlPath: plainFile.urlPath,
    visibility: plainFile.visibility,
    password: plainFile.password,
    userId: plainFile.userId,
    mimeType: plainFile.mimeType,
    size: plainFile.size,
    uploadedAt: plainFile.uploadedAt,
    path: plainFile.path,
    user: plainFile.user,
  }
}

export async function generateMetadata({
  params,
}: FilePageProps): Promise<Metadata> {
  const { userUrlId, filename } = await params
  const urlPath = `/${userUrlId}/${filename}`
  const headersList = await headers()

  // Skip metadata for /raw requests
  const path = headersList.get('x-invoke-path') || ''
  if (path.endsWith('/raw')) {
    return {}
  }

  const file = await prisma.file.findUnique({
    where: { urlPath },
    include: { user: true },
  })

  if (!file || !file.user) {
    return {}
  }

  const cleanFile = {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
  }

  const cleanUser = {
    name: file.user.name || 'Anonymous',
  }

  const isImage = cleanFile.mimeType.startsWith('image/')
  const isVideo = cleanFile.mimeType.startsWith('video/')
  const isAudio = cleanFile.mimeType.startsWith('audio/')
  const isMediaFile = isImage || isVideo || isAudio
  const formattedSize = formatFileSize(cleanFile.size)

  const ogTitle = `${cleanFile.name} (${formattedSize})`
  const ogDescription = isMediaFile
    ? `Uploaded by ${cleanUser.name}`
    : `${cleanFile.name} - ${formattedSize}, uploaded by ${cleanUser.name}`

  const host = headersList.get('host') || 'localhost:3000'
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
  const baseUrl = `${protocol}://${host}`
  const rawUrl = `${baseUrl}${urlPath}/raw`

  // For videos, always use the storage provider's URL to ensure proper URL formatting
  const storageProvider = await getStorageProvider()
  const videoUrl = isVideo
    ? await storageProvider.getFileUrl(file.path)
    : rawUrl

  const metadata: Metadata = {
    title: ogTitle,
    description: ogDescription,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url: rawUrl,
      type: (isVideo ? 'video.other' : isImage ? 'article' : 'website') as
        | 'video.other'
        | 'article'
        | 'website',
      images: isImage
        ? [
            {
              url: rawUrl,
              width: 1200,
              height: 630,
              alt: cleanFile.name,
              type: cleanFile.mimeType,
            },
          ]
        : undefined,
      videos: isVideo
        ? [
            {
              url: videoUrl,
              width: 1920,
              height: 1080,
              type: cleanFile.mimeType,
              secureUrl: videoUrl,
            },
          ]
        : undefined,
    },
    twitter: isImage
      ? {
          card: 'summary_large_image',
          title: ogTitle,
          description: ogDescription,
          images: [rawUrl],
        }
      : undefined,
  }

  return metadata
}

export default async function FilePage({
  params,
  searchParams,
}: FilePageProps) {
  const session = await getServerSession(authOptions)
  const { userUrlId, filename } = await params
  const urlPath = `/${userUrlId}/${filename}`
  const providedPassword = (await searchParams).password as string | undefined

  const file = await prisma.file.findUnique({
    where: { urlPath },
    include: { user: true },
  })

  if (!file) {
    notFound()
  }

  const serializedFile = prepareFileProps(file)

  const isOwner = session?.user?.id === serializedFile.userId
  const isPrivate = serializedFile.visibility === 'PRIVATE' && !isOwner

  if (isPrivate) {
    notFound()
  }

  // Check password if set
  if (serializedFile.password && !isOwner) {
    const needsPassword = !providedPassword
    if (needsPassword) {
      return (
        <div className="flex-1 relative">
          <div className="absolute top-6 left-6">
            <Link href="/dashboard" className="flex items-center space-x-2.5">
              <Icons.logo className="h-6 w-6" />
              <span className="flare-text text-lg">Flare</span>
            </Link>
          </div>
          <main className="flex items-center justify-center p-6 min-h-[calc(100vh-theme(spacing.16))]">
            <Card className="w-full max-w-md p-6">
              <h1 className="text-xl font-medium text-center mb-4">
                Password Protected File
              </h1>
              <p className="text-sm text-muted-foreground text-center mb-6">
                This file requires a password to access
              </p>
              <form className="space-y-4" action={urlPath}>
                <div className="space-y-2">
                  <input
                    type="password"
                    name="password"
                    placeholder="Enter password"
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md"
                >
                  Access File
                </button>
              </form>
            </Card>
          </main>
        </div>
      )
    }

    const isPasswordValid = await compare(
      providedPassword,
      serializedFile.password
    )
    if (!isPasswordValid) {
      return (
        <div className="flex-1 relative">
          <div className="absolute top-6 left-6">
            <Link href="/dashboard" className="flex items-center space-x-2.5">
              <Icons.logo className="h-6 w-6" />
              <span className="flare-text text-lg">Flare</span>
            </Link>
          </div>
          <main className="flex items-center justify-center p-6 min-h-[calc(100vh-theme(spacing.16))]">
            <Card className="w-full max-w-md p-6">
              <h1 className="text-xl font-medium text-center mb-4">
                Incorrect Password
              </h1>
              <p className="text-sm text-muted-foreground text-center mb-6">
                The password you entered is incorrect
              </p>
              <form className="space-y-4" action={urlPath}>
                <div className="space-y-2">
                  <input
                    type="password"
                    name="password"
                    placeholder="Enter password"
                    className="w-full px-3 py-2 border rounded-md"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md"
                >
                  Try Again
                </button>
              </form>
            </Card>
          </main>
        </div>
      )
    }
  }

  const isImage = serializedFile.mimeType.startsWith('image/')
  const isVideo = serializedFile.mimeType.startsWith('video/')
  const isMediaFile = isImage || isVideo

  return (
    <div className="flex-1 relative">
      <div className="absolute top-6 left-6">
        <Link href="/dashboard" className="flex items-center space-x-2.5">
          <Icons.logo className="h-6 w-6" />
          <span className="flare-text text-lg">Flare</span>
        </Link>
      </div>

      <div className="absolute top-6 right-6 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Uploaded by</span>
        <Avatar className="h-8 w-8">
          <AvatarImage
            src={serializedFile.user.image}
            alt={serializedFile.user.name}
          />
          <AvatarFallback>
            {serializedFile.user.name?.charAt(0) || '?'}
          </AvatarFallback>
        </Avatar>
        <span className="text-sm font-medium">{serializedFile.user.name}</span>
      </div>

      <main className="flex items-center justify-center p-6 min-h-[calc(100vh-theme(spacing.16))]">
        <Card
          className={`overflow-hidden ${isMediaFile ? 'max-w-[95vw]' : 'max-w-[50vw]'}`}
        >
          <div className="p-6">
            <h1 className="text-xl font-medium text-center truncate max-w-[800px] mx-auto">
              {serializedFile.name}
            </h1>
            <p className="text-sm text-muted-foreground text-center mt-1">
              {formatFileSize(serializedFile.size)}
            </p>
          </div>

          <ProtectedFile file={serializedFile} />
        </Card>
      </main>
    </div>
  )
}
