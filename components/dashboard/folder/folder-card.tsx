'use client'

import {
  FolderInput,
  Folder as FolderIcon,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'

import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { getColorClasses } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

import type { FolderTreeNode } from '@/types/components/folder'

interface FolderCardProps {
  folder: FolderTreeNode
  onOpen: (id: string) => void
  onRename: (folder: FolderTreeNode) => void
  onMove: (folder: FolderTreeNode) => void
  onDelete: (folder: FolderTreeNode) => void
}

export function FolderCard({
  folder,
  onOpen,
  onRename,
  onMove,
  onDelete,
}: FolderCardProps) {
  const classes = getColorClasses(folder.color)
  const childCount = folder.children.length

  return (
    <Card
      onClick={() => onOpen(folder.id)}
      className="group relative flex items-center gap-3 p-4 cursor-pointer bg-background/40 backdrop-blur-xl border-border/50 shadow-sm hover:shadow-lg hover:bg-background/60 transition-all duration-200"
    >
      <div
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-lg bg-muted/50 shrink-0',
          classes.icon
        )}
      >
        <FolderIcon className="h-6 w-6" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{folder.name}</p>
        <p className="text-xs text-muted-foreground">
          {folder.totalFileCount} file{folder.totalFileCount === 1 ? '' : 's'}
          {childCount > 0 &&
            ` · ${childCount} folder${childCount === 1 ? '' : 's'}`}
        </p>
      </div>
      <div onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1.5 rounded-md opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity"
              aria-label="Folder actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRename(folder)}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename / recolor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(folder)}>
              <FolderInput className="mr-2 h-4 w-4" />
              Move
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(folder)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Card>
  )
}
