'use client'

import Link from 'next/link'

import type { FileType } from '@/types/components/file'
import { format } from 'date-fns'
import {
  Download,
  FolderInput,
  Globe,
  KeyRound,
  Link as LinkIcon,
  Lock,
  Tags,
  Trash2,
} from 'lucide-react'

import { getFileIcon } from '@/components/dashboard/file-card/utils'
import { TagBadge } from '@/components/dashboard/tag/tag-badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { formatFileSize, getRelativeTime } from '@/lib/utils'
import { sanitizeUrl } from '@/lib/utils/url'

import { useToast } from '@/hooks/use-toast'

interface FileListViewProps {
  files: FileType[]
  organizationEnabled?: boolean
  selectedIds: Set<string>
  onSelectChange: (id: string, selected: boolean) => void
  onSelectAll: (selected: boolean) => void
  onRequestMove: (file: FileType) => void
  onRequestEditTags: (file: FileType) => void
  onTagClick: (tagId: string) => void
  onDelete: (id: string) => void
}

export function FileListView({
  files,
  organizationEnabled = false,
  selectedIds,
  onSelectChange,
  onSelectAll,
  onRequestMove,
  onRequestEditTags,
  onTagClick,
  onDelete,
}: FileListViewProps) {
  const { toast } = useToast()
  const allSelected =
    files.length > 0 && files.every((f) => selectedIds.has(f.id))

  const handleCopyLink = (file: FileType) => {
    navigator.clipboard.writeText(
      `${window.location.origin}${sanitizeUrl(file.urlPath)}`
    )
    toast({
      title: 'Link copied',
      description: 'File link has been copied to clipboard',
    })
  }

  const handleDelete = async (file: FileType) => {
    try {
      const response = await fetch(`/api/files/${file.id}`, {
        method: 'DELETE',
      })
      if (!response.ok) throw new Error()
      onDelete(file.id)
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

  return (
    <div className="rounded-2xl border border-border/50 bg-background/40 backdrop-blur-xl overflow-hidden">
      <TooltipProvider delayDuration={150}>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={onSelectAll}
                  aria-label="Select all files"
                />
              </TableHead>
              <TableHead>Name</TableHead>
              {organizationEnabled && (
                <TableHead className="hidden lg:table-cell">Folder</TableHead>
              )}
              {organizationEnabled && (
                <TableHead className="hidden xl:table-cell">Tags</TableHead>
              )}
              <TableHead className="hidden md:table-cell">Size</TableHead>
              <TableHead className="hidden sm:table-cell">Visibility</TableHead>
              <TableHead className="hidden lg:table-cell text-right">
                Views
              </TableHead>
              <TableHead className="hidden md:table-cell">Uploaded</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((file) => {
              const selected = selectedIds.has(file.id)
              return (
                <TableRow
                  key={file.id}
                  className={selected ? 'bg-accent/40' : undefined}
                >
                  <TableCell>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={(value) =>
                        onSelectChange(file.id, value)
                      }
                      aria-label="Select file"
                    />
                  </TableCell>
                  <TableCell className="max-w-[260px]">
                    <Link
                      href={sanitizeUrl(file.urlPath)}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <span className="text-muted-foreground shrink-0">
                        {getFileIcon(file.mimeType, 'h-4 w-4')}
                      </span>
                      <span className="truncate font-medium text-sm">
                        {file.name}
                      </span>
                    </Link>
                  </TableCell>
                  {organizationEnabled && (
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {file.folder?.name ?? '—'}
                    </TableCell>
                  )}
                  {organizationEnabled && (
                    <TableCell className="hidden xl:table-cell">
                      <div className="flex flex-wrap gap-1 max-w-[200px]">
                        {file.tags.slice(0, 2).map((tag) => (
                          <TagBadge
                            key={tag.id}
                            name={tag.name}
                            color={tag.color}
                            onClick={() => onTagClick(tag.id)}
                          />
                        ))}
                        {file.tags.length > 2 && (
                          <span className="text-xs text-muted-foreground self-center">
                            +{file.tags.length - 2}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground whitespace-nowrap">
                    {formatFileSize(file.size)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {file.password ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <KeyRound className="h-3 w-3" /> Protected
                      </span>
                    ) : file.visibility === 'PUBLIC' ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Globe className="h-3 w-3" /> Public
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Lock className="h-3 w-3" /> Private
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-right text-sm text-muted-foreground">
                    {file.views}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground whitespace-nowrap">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span>
                          {getRelativeTime(new Date(file.uploadedAt))}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        {format(new Date(file.uploadedAt), 'PPP p')}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => handleCopyLink(file)}
                          >
                            <LinkIcon className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy link</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
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
                      {organizationEnabled && (
                        <>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => onRequestMove(file)}
                              >
                                <FolderInput className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Move to folder</TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => onRequestEditTags(file)}
                              >
                                <Tags className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit tags</TooltipContent>
                          </Tooltip>
                        </>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => handleDelete(file)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </TooltipProvider>
    </div>
  )
}
