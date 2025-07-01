'use client'

import { useEffect, useRef, useState } from 'react'

import DOMPurify from 'dompurify'
import {
  Music,
  Pause,
  Play,
  RotateCw,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

import { sanitizeUrl } from '@/lib/utils/url'

interface MediaViewerV2Props {
  file: {
    name: string
    urlPath: string
    mimeType: string
  }
  fileUrl: string
  verifiedPassword?: string
  isFullscreen: boolean
}

export function MediaViewerV2({
  file,
  fileUrl,
  verifiedPassword,
  isFullscreen,
}: MediaViewerV2Props) {
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [directVideoUrl, setDirectVideoUrl] = useState<string>()
  const [isLoadingVideo, setIsLoadingVideo] = useState(false)

  const mediaRef = useRef<
    HTMLImageElement | HTMLVideoElement | HTMLAudioElement
  >(null)

  const isImage = file.mimeType.startsWith('image/')
  const isVideo = file.mimeType.startsWith('video/')
  const isAudio = file.mimeType.startsWith('audio/')

  // Fetch direct video URL for better performance
  useEffect(() => {
    if (isVideo) {
      const fetchDirectUrl = async () => {
        try {
          setIsLoadingVideo(true)
          const response = await fetch(
            `${sanitizeUrl(file.urlPath)}/direct${verifiedPassword ? `?password=${verifiedPassword}` : ''}`
          )
          if (response.ok) {
            const data = await response.json()
            setDirectVideoUrl(DOMPurify.sanitize(data.url))
          }
        } catch (error) {
          console.error('Failed to fetch direct video URL:', error)
        } finally {
          setIsLoadingVideo(false)
        }
      }
      fetchDirectUrl()
    }
  }, [file.urlPath, verifiedPassword, isVideo])

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isFullscreen) return

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          if (isVideo || isAudio) {
            const media = mediaRef.current as
              | HTMLVideoElement
              | HTMLAudioElement
            if (media) media.currentTime = Math.max(0, media.currentTime - 10)
          }
          break
        case 'ArrowRight':
          e.preventDefault()
          if (isVideo || isAudio) {
            const media = mediaRef.current as
              | HTMLVideoElement
              | HTMLAudioElement
            if (media)
              media.currentTime = Math.min(
                media.duration,
                media.currentTime + 10
              )
          }
          break
        case ' ':
          e.preventDefault()
          if (isVideo || isAudio) {
            const media = mediaRef.current as
              | HTMLVideoElement
              | HTMLAudioElement
            if (media) {
              if (media.paused) {
                media.play()
                setIsPlaying(true)
              } else {
                media.pause()
                setIsPlaying(false)
              }
            }
          }
          break
        case 'm':
          e.preventDefault()
          if (isVideo || isAudio) {
            const media = mediaRef.current as
              | HTMLVideoElement
              | HTMLAudioElement
            if (media) {
              media.muted = !media.muted
              setIsMuted(media.muted)
            }
          }
          break
        case '=':
        case '+':
          e.preventDefault()
          if (isImage) setZoom((prev) => Math.min(prev + 0.25, 5))
          break
        case '-':
          e.preventDefault()
          if (isImage) setZoom((prev) => Math.max(prev - 0.25, 0.25))
          break
        case 'r':
          e.preventDefault()
          if (isImage) setRotation((prev) => (prev + 90) % 360)
          break
      }
    }

    if (isFullscreen) {
      document.addEventListener('keydown', handleKeyDown)
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isFullscreen, isVideo, isAudio, isImage])

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 5))
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.25))
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360)
  const handleResetZoom = () => setZoom(1)

  const handlePlayPause = () => {
    const media = mediaRef.current as HTMLVideoElement | HTMLAudioElement
    if (!media) return

    if (media.paused) {
      media.play()
      setIsPlaying(true)
    } else {
      media.pause()
      setIsPlaying(false)
    }
  }

  const handleMute = () => {
    const media = mediaRef.current as HTMLVideoElement | HTMLAudioElement
    if (!media) return

    media.muted = !media.muted
    setIsMuted(media.muted)
  }

  const formatTime = (time: number) => {
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  // Image Viewer
  if (isImage) {
    return (
      <div
        className={`relative w-full h-full flex items-center justify-center ${isFullscreen ? 'bg-black' : ''}`}
      >
        <div className="relative">
          <img
            ref={mediaRef as React.RefObject<HTMLImageElement>}
            src={DOMPurify.sanitize(fileUrl)}
            alt={file.name}
            className="max-w-none transition-all duration-200 ease-in-out cursor-move"
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              maxHeight: isFullscreen ? '90vh' : '60vh',
              maxWidth: isFullscreen ? '90vw' : 'none',
            }}
            draggable={false}
          />

          {/* Image Controls */}
          <div
            className={`absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-black/80 text-white rounded-lg p-2 ${isFullscreen ? 'opacity-0 hover:opacity-100 transition-opacity' : ''}`}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={handleZoomOut}
              disabled={zoom <= 0.25}
              className="text-white hover:bg-white/20"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>

            <span className="text-sm px-2 min-w-[60px] text-center">
              {Math.round(zoom * 100)}%
            </span>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleZoomIn}
              disabled={zoom >= 5}
              className="text-white hover:bg-white/20"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetZoom}
              className="text-white hover:bg-white/20"
            >
              1:1
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleRotate}
              className="text-white hover:bg-white/20"
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // Video Viewer
  if (isVideo) {
    if (isLoadingVideo) {
      return (
        <div className="flex items-center justify-center h-96">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
            <p className="text-sm text-muted-foreground">Loading video...</p>
          </div>
        </div>
      )
    }

    const videoSrc = directVideoUrl || fileUrl

    return (
      <div
        className={`relative w-full h-full flex items-center justify-center ${isFullscreen ? 'bg-black' : ''}`}
      >
        <video
          ref={mediaRef as React.RefObject<HTMLVideoElement>}
          src={DOMPurify.sanitize(videoSrc)}
          className={`max-w-full max-h-full ${isFullscreen ? 'max-h-screen max-w-screen' : 'max-h-[60vh]'}`}
          controls={false}
          preload="metadata"
          onTimeUpdate={(e) => {
            const video = e.target as HTMLVideoElement
            setCurrentTime(video.currentTime)
          }}
          onLoadedMetadata={(e) => {
            const video = e.target as HTMLVideoElement
            setDuration(video.duration)
          }}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onVolumeChange={(e) => {
            const video = e.target as HTMLVideoElement
            setIsMuted(video.muted)
          }}
        >
          <source src={DOMPurify.sanitize(videoSrc)} type={file.mimeType} />
          Your browser does not support the video tag.
        </video>

        {/* Video Controls */}
        <div
          className={`absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 bg-black/80 text-white rounded-lg p-2 ${isFullscreen ? 'opacity-0 hover:opacity-100 transition-opacity' : ''}`}
        >
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePlayPause}
            className="text-white hover:bg-white/20"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4" />
            )}
          </Button>

          <span className="text-sm px-2">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleMute}
            className="text-white hover:bg-white/20"
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" />
            ) : (
              <Volume2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    )
  }

  // Audio Viewer
  if (isAudio) {
    return (
      <div className="w-full max-w-2xl mx-auto p-8">
        <Card className="p-6">
          <div className="text-center mb-6">
            <Music className="h-16 w-16 mx-auto mb-4 text-primary" />
            <h3 className="text-lg font-semibold mb-2">{file.name}</h3>
            <p className="text-sm text-muted-foreground">Audio File</p>
          </div>

          <audio
            ref={mediaRef as React.RefObject<HTMLAudioElement>}
            src={DOMPurify.sanitize(fileUrl)}
            className="w-full"
            controls
            preload="metadata"
            onTimeUpdate={(e) => {
              const audio = e.target as HTMLAudioElement
              setCurrentTime(audio.currentTime)
            }}
            onLoadedMetadata={(e) => {
              const audio = e.target as HTMLAudioElement
              setDuration(audio.duration)
            }}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          >
            <source src={DOMPurify.sanitize(fileUrl)} type={file.mimeType} />
            Your browser does not support the audio tag.
          </audio>
        </Card>
      </div>
    )
  }

  return null
}
