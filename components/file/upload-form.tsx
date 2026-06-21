'use client'

import { useState } from 'react'

import Image from 'next/image'

import { ExpiryAction } from '@/types/events'
import { $Enums } from '@prisma/client'
import { format } from 'date-fns'
import { CalendarIcon, FileIcon, UploadIcon, XIcon } from 'lucide-react'
import { useDropzone } from 'react-dropzone'

import { Plus } from 'lucide-react'

import { TagBadge } from '@/components/dashboard/tag/tag-badge'
import { TagPicker } from '@/components/dashboard/tag/tag-picker'
import { ExpiryModal } from '@/components/shared/expiry-modal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { formatBytes } from '@/lib/utils'

import { FileWithPreview, useFileUpload } from '@/hooks/use-file-upload'
import { useFolders } from '@/hooks/use-folders'
import { useTags } from '@/hooks/use-tags'

import type { FolderTreeNode } from '@/types/components/folder'

interface UploadFormProps {
  maxSize: number
  formattedMaxSize: string
  organizationEnabled?: boolean
  user: {
    defaultFileExpiration: $Enums.FileExpiration | null
    defaultFileExpirationAction: $Enums.ExpiryAction | null
  }
}

function flattenFolders(
  nodes: FolderTreeNode[],
  depth: number
): { id: string; name: string; depth: number }[] {
  return nodes.flatMap((node) => [
    { id: node.id, name: node.name, depth },
    ...flattenFolders(node.children, depth + 1),
  ])
}

const getDefaultExpiryDate = (unit: $Enums.FileExpiration | null) => {
  if (!unit || unit === 'DISABLED') return undefined

  const date = new Date()

  switch (unit) {
    case 'HOUR':
      date.setHours(date.getHours() + 1)
      break
    case 'DAY':
      date.setDate(date.getDate() + 1)
      date.setHours(23, 59, 59, 999)
      break
    case 'WEEK':
      date.setDate(date.getDate() + 7)
      date.setHours(23, 59, 59, 999)
      break
    case 'MONTH':
      date.setMonth(date.getMonth() + 1)
      date.setHours(23, 59, 59, 999)
      break
  }

  return date
}

export function UploadForm({
  maxSize,
  formattedMaxSize,
  organizationEnabled = false,
  user,
}: UploadFormProps) {
  const [isExpiryModalOpen, setIsExpiryModalOpen] = useState(false)

  const {
    files,
    isUploading,
    onDrop,
    removeFile,
    uploadFiles,
    visibility,
    setVisibility,
    password,
    setPassword,
    expiresAt,
    setExpiresAt,
    folderId,
    setFolderId,
    tags: selectedTagIds,
    setTags: setSelectedTagIds,
  } = useFileUpload({
    maxSize,
    expiresAt: getDefaultExpiryDate(user.defaultFileExpiration),
  })

  const { tree } = useFolders({ enabled: organizationEnabled })
  const { tags, createTag } = useTags({ enabled: organizationEnabled })

  const flatFolders = flattenFolders(tree, 0)
  const selectedTags = tags.filter((t) => selectedTagIds.includes(t.id))

  const toggleTag = (tagId: string) => {
    setSelectedTagIds(
      selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((t) => t !== tagId)
        : [...selectedTagIds, tagId]
    )
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    maxSize,
  })

  return (
    <div className="space-y-8">
      <Card
        {...getRootProps()}
        className={`p-8 border-2 border-dashed transition-colors ${
          isDragActive ? 'border-primary bg-primary/5' : 'border-muted'
        }`}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center justify-center text-center">
          <UploadIcon className="w-12 h-12 mb-4 text-muted-foreground" />
          <p className="text-lg font-medium">
            {isDragActive
              ? 'Drop the files here'
              : 'Drag and drop files here, or click to select files'}
          </p>
          <p className="text-sm text-muted-foreground mt-1">
            Maximum file size: {formattedMaxSize}
          </p>
        </div>
      </Card>

      {files.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Selected Files</h2>
          <div className="space-y-2">
            {files.map((file: FileWithPreview, index) => (
              <div
                key={index}
                className="flex items-center gap-4 p-4 rounded-lg bg-muted"
              >
                {file.preview ? (
                  <Image
                    src={file.preview}
                    alt={file.name}
                    width={48}
                    height={48}
                    className="object-cover rounded"
                  />
                ) : (
                  <FileIcon className="w-12 h-12 text-muted-foreground" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <div className="space-y-1">
                    <p className="text-sm text-muted-foreground">
                      {file.uploaded !== undefined
                        ? `${formatBytes(file.uploaded)} / ${formatBytes(file.size)}`
                        : formatBytes(file.size)}
                    </p>
                    {file.progress !== undefined && file.progress > 0 && (
                      <Progress
                        value={Math.min(file.progress, 100)}
                        className="h-1"
                      />
                    )}
                  </div>
                </div>
                {!isUploading && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => removeFile(index)}
                  >
                    <XIcon className="w-4 h-4" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Visibility</Label>
          <Select
            value={visibility}
            onValueChange={(value: 'PUBLIC' | 'PRIVATE') =>
              setVisibility(value)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="PUBLIC">Public</SelectItem>
              <SelectItem value="PRIVATE">Private (only me)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {organizationEnabled && (
          <>
            <div className="space-y-2">
              <Label>Folder (Optional)</Label>
              <Select
                value={folderId ?? 'none'}
                onValueChange={(value) =>
                  setFolderId(value === 'none' ? null : value)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="No folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No folder</SelectItem>
                  {flatFolders.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {'\u00A0'.repeat(folder.depth * 2)}
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Tags (Optional)</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {selectedTags.map((tag) => (
                  <TagBadge
                    key={tag.id}
                    name={tag.name}
                    color={tag.color}
                    onRemove={() => toggleTag(tag.id)}
                  />
                ))}
                <TagPicker
                  tags={tags}
                  selectedIds={selectedTagIds}
                  onToggle={toggleTag}
                  onCreate={(name) => createTag({ name })}
                  trigger={
                    <Button variant="outline" size="sm" className="gap-1.5 h-7">
                      <Plus className="h-3.5 w-3.5" />
                      Add tag
                    </Button>
                  }
                />
              </div>
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label>Password Protection (Optional)</Label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Leave empty for no password"
          />
        </div>

        <div className="space-y-2">
          <Label>File Expiration (Optional)</Label>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-start text-left font-normal"
            onClick={() => setIsExpiryModalOpen(true)}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {expiresAt ? (
              <span>Expires: {format(expiresAt, 'PPP p')}</span>
            ) : (
              'Set expiration date'
            )}
          </Button>

          {expiresAt && (
            <div className="rounded-md bg-orange-50 dark:bg-orange-950/20 p-3 border border-orange-200 dark:border-orange-800/50">
              <div className="flex items-center gap-2">
                <CalendarIcon className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                  Auto-delete scheduled
                </p>
              </div>
              <p className="text-sm text-orange-700 dark:text-orange-300 mt-1">
                File will be permanently deleted on{' '}
                {format(expiresAt, 'PPPP p')}
              </p>
            </div>
          )}
        </div>

        <Button
          className="w-full"
          size="lg"
          onClick={uploadFiles}
          disabled={files.length === 0 || isUploading}
        >
          {isUploading ? 'Uploading...' : 'Upload Files'}
        </Button>
      </div>

      <ExpiryModal
        isOpen={isExpiryModalOpen}
        onOpenChange={setIsExpiryModalOpen}
        onConfirm={async (date, _action) => {
          setExpiresAt(date)
        }}
        initialDate={expiresAt}
        initialAction={
          (user.defaultFileExpirationAction as ExpiryAction) ??
          ExpiryAction.DELETE
        }
        title="Set File Expiration"
        description="Configure when uploaded files should be automatically deleted"
      />
    </div>
  )
}
