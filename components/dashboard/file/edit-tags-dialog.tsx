'use client'

import { useEffect, useState } from 'react'

import { Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { TagBadge } from '@/components/dashboard/tag/tag-badge'
import { TagPicker } from '@/components/dashboard/tag/tag-picker'

import type { Tag } from '@/types/components/tag'

interface EditTagsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  fileName: string
  allTags: Tag[]
  initialTagIds: string[]
  onCreateTag: (name: string) => Promise<Tag | null>
  onSave: (tagIds: string[]) => Promise<boolean | void> | void
}

export function EditTagsDialog({
  open,
  onOpenChange,
  fileName,
  allTags,
  initialTagIds,
  onCreateTag,
  onSave,
}: EditTagsDialogProps) {
  const [selected, setSelected] = useState<string[]>(initialTagIds)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) setSelected(initialTagIds)
  }, [open, initialTagIds])

  const toggle = (tagId: string) => {
    setSelected((prev) =>
      prev.includes(tagId)
        ? prev.filter((t) => t !== tagId)
        : [...prev, tagId]
    )
  }

  const selectedTags = allTags.filter((t) => selected.includes(t.id))

  const handleSave = async () => {
    setSaving(true)
    const result = await onSave(selected)
    setSaving(false)
    if (result !== false) onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="truncate">Tags for {fileName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex flex-wrap gap-1.5 min-h-8">
            {selectedTags.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No tags assigned
              </span>
            )}
            {selectedTags.map((tag) => (
              <TagBadge
                key={tag.id}
                name={tag.name}
                color={tag.color}
                onRemove={() => toggle(tag.id)}
              />
            ))}
          </div>
          <TagPicker
            tags={allTags}
            selectedIds={selected}
            onToggle={toggle}
            onCreate={onCreateTag}
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Add tags
              </Button>
            }
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
