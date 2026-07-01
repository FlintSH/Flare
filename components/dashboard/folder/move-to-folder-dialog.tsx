'use client'

import { useState } from 'react'

import type { FolderTreeNode } from '@/types/components/folder'
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
  Home,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { getColorClasses } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

interface MoveToFolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tree: FolderTreeNode[]
  // Folder ids that cannot be selected as a destination (e.g. the folder being
  // moved and its descendants).
  disabledIds?: Set<string>
  title?: string
  onSelect: (folderId: string | null) => Promise<boolean | void> | void
}

function FolderRow({
  node,
  depth,
  disabledIds,
  onSelect,
}: {
  node: FolderTreeNode
  depth: number
  disabledIds: Set<string>
  onSelect: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const classes = getColorClasses(node.color)
  const disabled = disabledIds.has(node.id)

  return (
    <div>
      <div
        className="flex items-center gap-1"
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 rounded hover:bg-accent"
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 transition-transform',
                expanded && 'rotate-90'
              )}
            />
          </button>
        ) : (
          <span className="w-5" />
        )}
        <button
          type="button"
          disabled={disabled}
          onClick={() => onSelect(node.id)}
          className={cn(
            'flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left',
            disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
          )}
        >
          <FolderIcon className={cn('h-4 w-4 shrink-0', classes.icon)} />
          <span className="truncate">{node.name}</span>
        </button>
      </div>
      {expanded &&
        node.children.map((child) => (
          <FolderRow
            key={child.id}
            node={child}
            depth={depth + 1}
            disabledIds={disabledIds}
            onSelect={onSelect}
          />
        ))}
    </div>
  )
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  tree,
  disabledIds = new Set(),
  title = 'Move to folder',
  onSelect,
}: MoveToFolderDialogProps) {
  const handleSelect = async (folderId: string | null) => {
    const result = await onSelect(folderId)
    if (result !== false) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderInput className="h-4 w-4" />
            {title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-1 py-2 max-h-[360px] overflow-y-auto">
          <button
            type="button"
            onClick={() => handleSelect(null)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors text-left"
          >
            <Home className="h-4 w-4 text-muted-foreground" />
            <span>No folder (root)</span>
          </button>
          {tree.map((node) => (
            <FolderRow
              key={node.id}
              node={node}
              depth={0}
              disabledIds={disabledIds}
              onSelect={handleSelect}
            />
          ))}
          {tree.length === 0 && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No folders yet. Create one first.
            </p>
          )}
        </div>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
