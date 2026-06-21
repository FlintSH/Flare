'use client'

import { useState } from 'react'

import {
  ChevronRight,
  Files,
  FolderInput,
  Folder as FolderIcon,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
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

export interface FolderSidebarProps {
  tree: FolderTreeNode[]
  totalFileCount: number
  unfiledCount?: number
  selectedFolderId: string | null
  onSelect: (folderId: string | null) => void
  onCreateRoot: () => void
  onCreateChild: (parentId: string) => void
  onRename: (node: FolderTreeNode) => void
  onMove: (node: FolderTreeNode) => void
  onDelete: (node: FolderTreeNode) => void
}

function FolderNode({
  node,
  depth,
  selectedFolderId,
  onSelect,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
}: {
  node: FolderTreeNode
  depth: number
} & Pick<
  FolderSidebarProps,
  'selectedFolderId' | 'onSelect' | 'onCreateChild' | 'onRename' | 'onMove' | 'onDelete'
>) {
  const [expanded, setExpanded] = useState(false)
  const classes = getColorClasses(node.color)
  const isActive = selectedFolderId === node.id

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-1 rounded-md pr-1 transition-colors',
          isActive ? 'bg-accent' : 'hover:bg-accent/50'
        )}
        style={{ paddingLeft: `${depth * 14}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-1 rounded hover:bg-accent shrink-0"
            aria-label={expanded ? 'Collapse' : 'Expand'}
          >
            <ChevronRight
              className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="w-[22px] shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onSelect(node.id)}
          className="flex flex-1 items-center gap-2 py-1.5 text-sm min-w-0 text-left"
        >
          <FolderIcon className={cn('h-4 w-4 shrink-0', classes.icon)} />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {node.totalFileCount || ''}
          </span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-accent shrink-0 transition-opacity"
              aria-label="Folder actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onCreateChild(node.id)}>
              <FolderPlus className="mr-2 h-4 w-4" />
              New subfolder
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(node)}>
              <Pencil className="mr-2 h-4 w-4" />
              Rename / recolor
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onMove(node)}>
              <FolderInput className="mr-2 h-4 w-4" />
              Move
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => onDelete(node)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded &&
        node.children.map((child) => (
          <FolderNode
            key={child.id}
            node={child}
            depth={depth + 1}
            selectedFolderId={selectedFolderId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        ))}
    </div>
  )
}

export function FolderSidebar({
  tree,
  totalFileCount,
  unfiledCount,
  selectedFolderId,
  onSelect,
  onCreateRoot,
  onCreateChild,
  onRename,
  onMove,
  onDelete,
}: FolderSidebarProps) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-1 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Folders
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onCreateRoot}
          aria-label="New folder"
        >
          <FolderPlus className="h-4 w-4" />
        </Button>
      </div>

      <button
        type="button"
        onClick={() => onSelect(null)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          selectedFolderId === null ? 'bg-accent' : 'hover:bg-accent/50'
        )}
      >
        <Files className="h-4 w-4 text-muted-foreground" />
        <span>All files</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {totalFileCount || ''}
        </span>
      </button>

      <button
        type="button"
        onClick={() => onSelect('none')}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
          selectedFolderId === 'none' ? 'bg-accent' : 'hover:bg-accent/50'
        )}
      >
        <FolderIcon className="h-4 w-4 text-muted-foreground" />
        <span>Unfiled</span>
        {unfiledCount !== undefined && (
          <span className="ml-auto text-xs text-muted-foreground">
            {unfiledCount || ''}
          </span>
        )}
      </button>

      <div className="pt-1">
        {tree.map((node) => (
          <FolderNode
            key={node.id}
            node={node}
            depth={0}
            selectedFolderId={selectedFolderId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            onRename={onRename}
            onMove={onMove}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}
