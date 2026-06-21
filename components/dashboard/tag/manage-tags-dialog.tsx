'use client'

import { useState } from 'react'

import type { Tag } from '@/types/components/tag'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'

import { ColorPicker } from '@/components/dashboard/folder/color-picker'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

import { getColorClasses } from '@/lib/organization/colors'
import type { OrganizationColor } from '@/lib/organization/colors'
import { cn } from '@/lib/utils'

interface ManageTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: Tag[]
  onCreate: (input: {
    name: string
    color: OrganizationColor | null
  }) => Promise<Tag | null>
  onUpdate: (
    id: string,
    input: { name?: string; color?: OrganizationColor | null }
  ) => Promise<boolean>
  onDelete: (id: string) => Promise<boolean>
}

export function ManageTagsDialog({
  open,
  onOpenChange,
  tags,
  onCreate,
  onUpdate,
  onDelete,
}: ManageTagsDialogProps) {
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState<OrganizationColor | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState<OrganizationColor | null>(null)

  const startEdit = (tag: Tag) => {
    setEditingId(tag.id)
    setEditName(tag.name)
    setEditColor((tag.color as OrganizationColor) ?? null)
  }

  const handleCreate = async () => {
    if (!newName.trim()) return
    const created = await onCreate({ name: newName.trim(), color: newColor })
    if (created) {
      setNewName('')
      setNewColor(null)
    }
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim()) return
    const ok = await onUpdate(editingId, {
      name: editName.trim(),
      color: editColor,
    })
    if (ok) setEditingId(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Tags</DialogTitle>
          <DialogDescription>
            Create, rename, recolor, or delete your tags. Deleting a tag keeps
            your files; it only removes the label.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-lg border border-border/50 p-3 space-y-3">
            <Input
              placeholder="New tag name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleCreate()
                }
              }}
            />
            <div className="flex items-center justify-between gap-2">
              <ColorPicker value={newColor} onChange={setNewColor} />
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                <Plus className="mr-1 h-4 w-4" />
                Add
              </Button>
            </div>
          </div>

          <div className="max-h-[320px] overflow-y-auto space-y-1">
            {tags.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No tags yet
              </p>
            )}
            {tags.map((tag) => {
              const classes = getColorClasses(tag.color)
              const isEditing = editingId === tag.id
              return (
                <div
                  key={tag.id}
                  className="rounded-md border border-border/40 p-2"
                >
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8"
                      />
                      <div className="flex items-center justify-between gap-2">
                        <ColorPicker
                          value={editColor}
                          onChange={setEditColor}
                        />
                        <div className="flex gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => setEditingId(null)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleSaveEdit}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={cn(
                            'h-3 w-3 rounded-full shrink-0',
                            classes.dot
                          )}
                        />
                        <span className="truncate text-sm font-medium">
                          {tag.name}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {tag.fileCount} file{tag.fileCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => startEdit(tag)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => onDelete(tag.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
