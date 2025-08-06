'use client'

import { useEffect, useState } from 'react'

import { ImageIcon, Loader2, Save, VideoIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'

import { useToast } from '@/hooks/use-toast'

interface CompressionSettings {
  enabled: boolean
  imageCompression: boolean
  imageQuality: number
  imageFormat: string
  videoCompression: boolean
  videoQuality: number
  videoBitrate?: string
  videoCodec?: string
  maxWidth?: number
  maxHeight?: number
  keepOriginal: boolean
  autoCompress: boolean
  compressionThreshold: number
}

export function ProfileCompression() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<CompressionSettings>({
    enabled: false,
    imageCompression: true,
    imageQuality: 85,
    imageFormat: 'auto',
    videoCompression: true,
    videoQuality: 80,
    keepOriginal: true,
    autoCompress: true,
    compressionThreshold: 1048576,
  })

  useEffect(() => {
    fetchSettings()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const fetchSettings = async () => {
    try {
      const response = await fetch('/api/profile/compression')
      if (response.ok) {
        const data = await response.json()
        if (data) {
          setSettings(data)
        }
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to load compression settings',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      const response = await fetch('/api/profile/compression', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'Compression settings saved successfully',
        })
      } else {
        throw new Error('Failed to save settings')
      }
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to save compression settings',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i]
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Compression Settings</CardTitle>
          <CardDescription>
            Configure automatic file compression for uploads to save storage
            space
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="enabled">Enable Compression</Label>
              <p className="text-sm text-muted-foreground">
                Automatically compress files when uploading
              </p>
            </div>
            <Switch
              id="enabled"
              checked={settings.enabled}
              onCheckedChange={(checked) =>
                setSettings({ ...settings, enabled: checked })
              }
            />
          </div>

          {settings.enabled && (
            <>
              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="autoCompress">Auto Compress</Label>
                    <p className="text-sm text-muted-foreground">
                      Compress files automatically on upload
                    </p>
                  </div>
                  <Switch
                    id="autoCompress"
                    checked={settings.autoCompress}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, autoCompress: checked })
                    }
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor="keepOriginal">Keep Original Files</Label>
                    <p className="text-sm text-muted-foreground">
                      Store original files alongside compressed versions
                    </p>
                  </div>
                  <Switch
                    id="keepOriginal"
                    checked={settings.keepOriginal}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, keepOriginal: checked })
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label>Compression Threshold</Label>
                  <p className="text-sm text-muted-foreground">
                    Only compress files larger than{' '}
                    {formatBytes(settings.compressionThreshold)}
                  </p>
                  <Slider
                    value={[Math.log2(settings.compressionThreshold / 1024)]}
                    onValueChange={([value]: number[]) => {
                      const bytes = Math.pow(2, value) * 1024
                      setSettings({ ...settings, compressionThreshold: bytes })
                    }}
                    min={0}
                    max={20}
                    step={1}
                    className="w-full"
                  />
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center gap-2 text-lg font-medium">
                  <ImageIcon className="h-5 w-5" />
                  Image Compression
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="imageCompression">
                    Enable Image Compression
                  </Label>
                  <Switch
                    id="imageCompression"
                    checked={settings.imageCompression}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, imageCompression: checked })
                    }
                  />
                </div>

                {settings.imageCompression && (
                  <>
                    <div className="space-y-2">
                      <Label>Image Quality: {settings.imageQuality}%</Label>
                      <Slider
                        value={[settings.imageQuality]}
                        onValueChange={([value]: number[]) =>
                          setSettings({ ...settings, imageQuality: value })
                        }
                        min={1}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Output Format</Label>
                      <Select
                        value={settings.imageFormat}
                        onValueChange={(value) =>
                          setSettings({ ...settings, imageFormat: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">
                            Auto (Best for file type)
                          </SelectItem>
                          <SelectItem value="webp">WebP</SelectItem>
                          <SelectItem value="jpeg">JPEG</SelectItem>
                          <SelectItem value="png">PNG</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Max Width (pixels)</Label>
                        <Input
                          type="number"
                          placeholder="No limit"
                          value={settings.maxWidth || ''}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              maxWidth: e.target.value
                                ? parseInt(e.target.value)
                                : undefined,
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Max Height (pixels)</Label>
                        <Input
                          type="number"
                          placeholder="No limit"
                          value={settings.maxHeight || ''}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              maxHeight: e.target.value
                                ? parseInt(e.target.value)
                                : undefined,
                            })
                          }
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="flex items-center gap-2 text-lg font-medium">
                  <VideoIcon className="h-5 w-5" />
                  Video Compression
                </div>

                <div className="flex items-center justify-between">
                  <Label htmlFor="videoCompression">
                    Enable Video Compression
                  </Label>
                  <Switch
                    id="videoCompression"
                    checked={settings.videoCompression}
                    onCheckedChange={(checked) =>
                      setSettings({ ...settings, videoCompression: checked })
                    }
                  />
                </div>

                {settings.videoCompression && (
                  <>
                    <div className="space-y-2">
                      <Label>Video Quality: {settings.videoQuality}%</Label>
                      <Slider
                        value={[settings.videoQuality]}
                        onValueChange={([value]: number[]) =>
                          setSettings({ ...settings, videoQuality: value })
                        }
                        min={1}
                        max={100}
                        step={1}
                        className="w-full"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Video Codec</Label>
                      <Select
                        value={settings.videoCodec || 'libx264'}
                        onValueChange={(value) =>
                          setSettings({ ...settings, videoCodec: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="libx264">
                            H.264 (Most compatible)
                          </SelectItem>
                          <SelectItem value="libx265">
                            H.265 (Better compression)
                          </SelectItem>
                          <SelectItem value="libvpx-vp9">
                            VP9 (Web optimized)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Bitrate (optional)</Label>
                      <Input
                        placeholder="e.g., 1M, 2M, 500k"
                        value={settings.videoBitrate || ''}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            videoBitrate: e.target.value,
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave empty for automatic bitrate based on quality
                      </p>
                    </div>
                  </>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end pt-4">
            <Button onClick={saveSettings} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="mr-2 h-4 w-4" />
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
