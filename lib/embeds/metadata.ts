import type { Metadata } from 'next'

import { S3StorageProvider, getStorageProvider } from '@/lib/storage'
import { formatFileSize } from '@/lib/utils'
import { getFileDescription } from '@/lib/utils/metadata'

import { classifyMimeType } from './file-classification'

interface BuildMetadataOptions {
  baseUrl: string
  fileUrlPath: string
  rawUrl: string
  fileName: string
  mimeType: string
  size: number
  uploadedAt: Date
  uploaderName: string
  filePath: string
}

export async function buildRichMetadata({
  baseUrl,
  fileUrlPath,
  rawUrl,
  fileName,
  mimeType,
  size,
  uploadedAt,
  uploaderName,
  filePath,
}: BuildMetadataOptions): Promise<Metadata> {
  const classification = classifyMimeType(mimeType)
  const fileUrl = `${baseUrl}${fileUrlPath}`
  const formattedSize = formatFileSize(size)
  const uploadDate = uploadedAt.toISOString()

  const baseTitle = fileName
  const baseDescription = getFileDescription({
    size: formattedSize,
    uploaderName,
    uploadedAt,
  })

  const metadata: Metadata = {
    title: baseTitle,
    description: baseDescription,
    metadataBase: new URL(baseUrl),
    openGraph: {
      title: baseTitle,
      description: baseDescription,
      url: fileUrl,
      siteName: 'Flare',
      locale: 'en_US',
      type: getOpenGraphType(classification),
      images: buildOpenGraphImages(classification.isImage, rawUrl, mimeType),
      videos: await buildOpenGraphVideos(
        classification.isVideo,
        rawUrl,
        mimeType,
        filePath
      ),
      audio: buildOpenGraphAudio(classification.isAudio, rawUrl, mimeType),
    },
    twitter: buildTwitterMetadata(classification, {
      title: baseTitle,
      description: baseDescription,
      rawUrl,
      fileUrl,
    }),
    other: buildOtherMetadata({
      uploadDate,
      uploaderName,
      description: baseDescription,
      rawUrl,
      isImage: classification.isImage,
    }),
  }

  return metadata
}

function getOpenGraphType(classification: ReturnType<typeof classifyMimeType>) {
  if (classification.isVideo) return 'video.other'
  if (classification.isMusic) return 'music.song'
  if (
    classification.isImage ||
    classification.isDocument ||
    classification.isCode
  )
    return 'article'
  return 'website'
}

function buildOpenGraphImages(
  isImageFile: boolean,
  rawUrl: string,
  mimeType: string
) {
  if (!isImageFile) return undefined

  return [
    {
      url: rawUrl,
      width: 1200,
      height: 630,
      alt: 'Preview image',
      type: mimeType,
    },
  ]
}

async function buildOpenGraphVideos(
  isVideoFile: boolean,
  rawUrl: string,
  mimeType: string,
  filePath: string
) {
  if (!isVideoFile) return undefined

  let videoUrl = rawUrl
  const storageProvider = await getStorageProvider()
  if (storageProvider instanceof S3StorageProvider) {
    videoUrl = await storageProvider.getFileUrl(filePath)
  }

  return [
    {
      url: videoUrl,
      width: 1920,
      height: 1080,
      type: mimeType,
      secureUrl: videoUrl,
    },
  ]
}

function buildOpenGraphAudio(
  isAudioFile: boolean,
  rawUrl: string,
  mimeType: string
) {
  if (!isAudioFile) return undefined

  return [
    {
      url: rawUrl,
      type: mimeType,
    },
  ]
}

interface TwitterMetadataInput {
  title: string
  description: string
  rawUrl: string
  fileUrl: string
}

function buildTwitterMetadata(
  classification: ReturnType<typeof classifyMimeType>,
  { title, description, rawUrl, fileUrl }: TwitterMetadataInput
) {
  if (classification.isImage) {
    return {
      card: 'summary_large_image' as const,
      title,
      description,
      images: [rawUrl],
    }
  }

  if (classification.isVideo) {
    return {
      card: 'player' as const,
      title,
      description,
      players: [
        {
          url: fileUrl,
          stream: rawUrl,
          width: 1920,
          height: 1080,
        },
      ],
    }
  }

  if (classification.isAudio) {
    return {
      card: 'summary' as const,
      title,
      description,
    }
  }

  if (
    classification.isDocument ||
    classification.isCode ||
    classification.isText
  ) {
    return {
      card: 'summary' as const,
      title,
      description,
    }
  }

  return undefined
}

interface OtherMetadataInput {
  uploadDate: string
  uploaderName: string
  description: string
  rawUrl: string
  isImage: boolean
}

function buildOtherMetadata({
  uploadDate,
  uploaderName,
  description,
  rawUrl,
  isImage,
}: OtherMetadataInput) {
  const metadata: Record<string, string> = {
    'theme-color': '#3b82f6',
    'article:published_time': uploadDate,
    'article:author': uploaderName,
    'og:description': description,
    'al:ios:url': rawUrl,
    'al:android:url': rawUrl,
  }

  if (isImage) {
    metadata['og:image:alt'] = 'Preview image'
  }

  return metadata
}

export function buildMinimalMetadata(fileName: string): Metadata {
  return {
    title: fileName,
    description: '',
  }
}
