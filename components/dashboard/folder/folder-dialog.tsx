'use client'

import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { ColorPicker } from '@/components/dashboard/folder/color-picker'

import type { OrganizationColor } from '@/lib/organization/colors'

interface FolderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'rename'
  initialName?: string
  initialColor?: string | null
  onSubmit: (values: {
    name: string
    color: OrganizationColor | null
  }) => Promise<boolean | void> | void
}

export function FolderDialog({
  open,
  onOpenChange,
  mode,
  initialName = '',
  initialColor = null,
  onSubmit,
}: FolderDialogProps) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState<OrganizationColor | null>(
    (initialColor as OrganizationColor) ?? null
  )
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setColor((initialColor as OrganizationColor) ?? null)
    }
  }, [open, initialName, initialColor])

  const handleSubmit = async () => {
    if (!name.trim()) return
    setSubmitting(true)
    const result = await onSubmit({ name: name.trim(), color })
    setSubmitting(false)
    if (result !== false) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New Folder' : 'Rename Folder'}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="folder-name">Name</Label>
            <Input
              id="folder-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder="e.g. Screenshots"
            />
          </div>
          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!name.trim() || submitting}>
              {mode === 'create' ? 'Create' : 'Save'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
