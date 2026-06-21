'use client'

import { Check, Files, Folder as FolderIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { getColorClasses } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

import type { FolderTreeNode } from '@/types/components/folder'

interface FolderFilterProps {
  tree: FolderTreeNode[]
  value: string | null
  onChange: (folderId: string | null) => void
}

function flatten(
  nodes: FolderTreeNode[],
  depth: number
): { node: FolderTreeNode; depth: number }[] {
  return nodes.flatMap((node) => [
    { node, depth },
    ...flatten(node.children, depth + 1),
  ])
}

export function FolderFilter({ tree, value, onChange }: FolderFilterProps) {
  const flat = flatten(tree, 0)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="min-w-[120px] flex items-center justify-between bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200"
        >
          <span>Folder</span>
          {value ? (
            <span className="ml-2 h-2 w-2 rounded-full bg-primary" />
          ) : (
            <FolderIcon className="ml-2 h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60 max-h-[400px] overflow-y-auto"
      >
        <DropdownMenuLabel>Filter by folder</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => onChange(null)}
          className={cn('flex items-center justify-between', value === null && 'bg-accent')}
        >
          <span className="flex items-center gap-2">
            <Files className="h-4 w-4 text-muted-foreground" />
            All files
          </span>
          {value === null && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => onChange('none')}
          className={cn(
            'flex items-center justify-between',
            value === 'none' && 'bg-accent'
          )}
        >
          <span className="flex items-center gap-2">
            <FolderIcon className="h-4 w-4 text-muted-foreground" />
            Unfiled
          </span>
          {value === 'none' && <Check className="h-4 w-4" />}
        </DropdownMenuItem>
        {flat.length > 0 && <DropdownMenuSeparator />}
        {flat.map(({ node, depth }) => {
          const classes = getColorClasses(node.color)
          const selected = value === node.id
          return (
            <DropdownMenuItem
              key={node.id}
              onClick={() => onChange(node.id)}
              className={cn(
                'flex items-center justify-between',
                selected && 'bg-accent'
              )}
              style={{ paddingLeft: `${8 + depth * 14}px` }}
            >
              <span className="flex items-center gap-2 min-w-0">
                <FolderIcon className={cn('h-4 w-4 shrink-0', classes.icon)} />
                <span className="truncate">{node.name}</span>
                <span className="text-xs text-muted-foreground">
                  {node.totalFileCount}
                </span>
              </span>
              {selected && <Check className="ml-2 h-4 w-4 shrink-0" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
