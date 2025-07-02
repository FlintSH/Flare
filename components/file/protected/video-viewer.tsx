'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'

import { sanitizeUrl } from '@/lib/utils/url'

interface VideoViewerProps {
  filePath: string
  mimeType: string
  verifiedPassword?: string
}

export function VideoViewer({
  filePath,
  mimeType,
  verifiedPassword,
}: VideoViewerProps) {
  const [directS3VideoUrl, setDirectS3VideoUrl] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  // Fetch direct S3 URL for video files
  useEffect(() => {
    const fetchDirectUrl = async () => {
      try {
        const response = await fetch(
          `${sanitizeUrl(filePath)}/direct${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
        )
        if (response.ok) {
          const data = await response.json()
          setDirectS3VideoUrl(DOMPurify.sanitize(data.url))
        }
      } catch (error) {
        console.error('Failed to fetch direct S3 URL:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchDirectUrl()
  }, [filePath, verifiedPassword])

  if (isLoading) {
    return (
      <div className="w-full flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading video...</p>
      </div>
    )
  }

  return (
    <div className="w-full flex items-center justify-center p-4">
      <div className="w-full max-w-4xl">
        {directS3VideoUrl ? (
          <video
            src={DOMPurify.sanitize(directS3VideoUrl)}
            controls
            className="w-full max-h-[60vh] object-contain"
            controlsList="nodownload"
            preload="metadata"
            muted={false}
            playsInline
          >
            <source
              src={DOMPurify.sanitize(directS3VideoUrl)}
              type={mimeType}
            />
            Your browser does not support the video tag.
          </video>
        ) : (
          <div className="w-full flex items-center justify-center p-8">
            <p className="text-muted-foreground">Failed to load video</p>
          </div>
        )}
      </div>
    </div>
  )
}
