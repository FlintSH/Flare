'use client'

import { useState } from 'react'

import { ArrowRight, Loader2, Plus, Sparkles, Tag } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

import { usePermissions } from '@/hooks/use-permissions'
import { TagView, tagRequest, useTags } from '@/hooks/use-tags'
import { useToast } from '@/hooks/use-toast'

export function TagManager({
  open,
  onOpenChange,
  onDeleted,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: (id: string) => void
}) {
  const { can } = usePermissions()
  const { tags, loading, error: loadError, reload, changed } = useTags()
  const { toast } = useToast()
  const [editing, setEditing] = useState<TagView | 'new' | null>(null)
  const [name, setName] = useState('')
  const [automatic, setAutomatic] = useState(false)
  const [source, setSource] = useState<'filename' | 'ocr'>('filename')
  const [phrase, setPhrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmApply, setConfirmApply] = useState(false)
  const [search, setSearch] = useState('')
  const existing = editing && editing !== 'new' ? editing : null
  const start = (tag: TagView | 'new') => {
    setEditing(tag)
    setName(tag === 'new' ? '' : tag.name)
    setAutomatic(tag !== 'new' && !!tag.ruleSource)
    setSource(tag === 'new' ? 'filename' : tag.ruleSource || 'filename')
    setPhrase(tag === 'new' ? '' : tag.ruleText || '')
    setError('')
    setConfirmDelete(false)
    setConfirmApply(false)
  }
  const close = (next: boolean) => {
    if (busy) return
    onOpenChange(next)
    if (!next) {
      setEditing(null)
      setError('')
      setSearch('')
    }
  }
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await tagRequest(
        existing ? `/api/tags/${existing.id}` : '/api/tags',
        existing ? 'PATCH' : 'POST',
        {
          name: name.trim(),
          ruleSource: automatic ? source : null,
          ruleText: automatic ? phrase.trim() : null,
        }
      )
      changed()
      setEditing(null)
      toast({ title: existing ? 'Tag saved' : 'Tag created' })
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t save this tag.'
      )
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    if (!existing) return
    setBusy(true)
    setError('')
    try {
      await tagRequest(`/api/tags/${existing.id}`, 'DELETE')
      changed()
      onDeleted(existing.id)
      setEditing(null)
      toast({
        title: 'Tag deleted',
        description: 'Your files are still in your vault.',
      })
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t delete this tag.'
      )
    } finally {
      setBusy(false)
    }
  }
  const apply = async () => {
    if (!existing) return
    setBusy(true)
    setError('')
    try {
      const result = await tagRequest<{ count: number }>(
        `/api/tags/${existing.id}/apply`,
        'POST'
      )
      changed()
      setConfirmApply(false)
      toast({
        title: 'Rule applied',
        description: `${result.count} ${result.count === 1 ? 'file tagged' : 'files tagged'}. Tags you removed were left alone.`,
      })
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Couldn’t apply this rule.'
      )
    } finally {
      setBusy(false)
    }
  }
  const ruleUnchanged =
    existing &&
    automatic &&
    source === existing.ruleSource &&
    phrase.trim() === existing.ruleText
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? (existing ? 'Edit tag' : 'Create a tag') : 'Tags'}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? 'Give related files a name to find them by.'
              : 'Your files stay together. Tags help you find a few.'}
          </DialogDescription>
        </DialogHeader>
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (!busy) void save()
            }}
            className="space-y-5"
          >
            <div className="space-y-2">
              <Label htmlFor="tag-name">Name</Label>
              <Input
                id="tag-name"
                autoFocus
                maxLength={40}
                placeholder="e.g. Receipts, Work, Inspiration"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                required
              />
            </div>
            <div className="rounded-xl border border-border/60">
              <div className="flex items-center justify-between gap-4 p-4">
                <div>
                  <Label
                    htmlFor="tag-automatic"
                    className="flex items-center gap-2"
                  >
                    <Sparkles className="h-4 w-4 text-muted-foreground" />
                    Add automatically
                  </Label>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Tag new uploads when they match a rule.
                  </p>
                </div>
                <Switch
                  id="tag-automatic"
                  checked={automatic}
                  onCheckedChange={setAutomatic}
                  disabled={busy}
                />
              </div>
              {automatic && (
                <div className="space-y-3 border-t border-border/60 p-4">
                  <div className="flex items-center gap-3">
                    <Select
                      value={source}
                      onValueChange={(value: 'filename' | 'ocr') =>
                        setSource(value)
                      }
                      disabled={busy}
                    >
                      <SelectTrigger
                        aria-label="Match against"
                        className="w-44"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="filename">File name</SelectItem>
                        <SelectItem value="ocr">Extracted text</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-sm text-muted-foreground">
                      contains
                    </span>
                  </div>
                  <Input
                    aria-label="Text to match"
                    placeholder={
                      source === 'filename'
                        ? 'e.g. invoice'
                        : 'e.g. payment received'
                    }
                    value={phrase}
                    onChange={(event) => setPhrase(event.target.value)}
                    maxLength={200}
                    disabled={busy}
                    required
                  />
                  <p className="text-xs leading-5 text-muted-foreground">
                    {source === 'ocr'
                      ? 'Looks for this phrase after Flare extracts text from an image. Automatic OCR must be enabled in Settings; you can also extract text from a file’s menu.'
                      : 'Looks for this phrase anywhere in the uploaded file’s name.'}{' '}
                    Capitalization doesn’t matter. You can always remove a tag.
                  </p>
                </div>
              )}
            </div>
            {existing &&
              ruleUnchanged &&
              can('tags.manage') &&
              can('files.update') && (
                <div className="space-y-2">
                  {confirmApply ? (
                    <div className="rounded-lg bg-muted/50 p-3 text-sm">
                      <p>
                        Also check existing files for this rule? Files keep
                        their other tags, and tags you removed stay removed.
                      </p>
                      <div className="mt-3 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void apply()}
                          disabled={busy}
                        >
                          Apply to existing files
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmApply(false)}
                          disabled={busy}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      type="button"
                      variant="link"
                      className="h-auto p-0 text-sm"
                      disabled={busy}
                      onClick={() => setConfirmApply(true)}
                    >
                      Apply rule to existing files…
                    </Button>
                  )}
                </div>
              )}
            {existing && automatic && !ruleUnchanged && (
              <p className="text-xs text-muted-foreground">
                Save your rule first to apply it to existing files.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {confirmDelete && (
              <div className="rounded-lg border border-destructive/30 p-3 text-sm">
                <p>
                  Delete “{existing?.name}”? This removes the tag and its rule.
                  Your files stay in your vault.
                </p>
                <div className="mt-3 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void remove()}
                  >
                    Delete tag
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setConfirmDelete(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            <DialogFooter className="border-t pt-4">
              {existing && (
                <Button
                  type="button"
                  variant="ghost"
                  className="text-muted-foreground sm:mr-auto"
                  disabled={busy}
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete tag…
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(null)
                  setError('')
                }}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                type="submit"
                disabled={busy || !name.trim() || (automatic && !phrase.trim())}
              >
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {existing ? 'Save tag' : 'Create tag'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            {tags.length > 5 && (
              <Input
                aria-label="Search tags"
                placeholder="Find a tag…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            )}
            <div className="max-h-[50vh] overflow-y-auto">
              {loading ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Loading tags…
                </p>
              ) : loadError ? (
                <Button variant="outline" onClick={() => void reload()}>
                  Retry loading tags
                </Button>
              ) : tags.length ? (
                <div className="space-y-1">
                  {tags
                    .filter((tag) =>
                      tag.name.toLowerCase().includes(search.toLowerCase())
                    )
                    .map((tag) => (
                      <button
                        key={tag.id}
                        onClick={() => start(tag)}
                        className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <Tag className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {tag.name}
                          </span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                            {tag.fileCount}{' '}
                            {tag.fileCount === 1 ? 'file' : 'files'}
                            {tag.ruleSource && (
                              <>
                                <span>·</span>
                                <Sparkles className="h-3 w-3" />
                                Automatic
                              </>
                            )}
                          </span>
                        </span>
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </button>
                    ))}
                </div>
              ) : (
                <div className="py-8 text-center">
                  <Tag className="mx-auto mb-3 h-7 w-7 text-muted-foreground" />
                  <p className="text-sm font-medium">
                    A place for the things that belong together.
                  </p>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-muted-foreground">
                    Try “Work” or “Receipts”. Add tags yourself, or let a simple
                    rule do it for you.
                  </p>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => close(false)}>
                Done
              </Button>
              <Button onClick={() => start('new')}>
                <Plus className="mr-2 h-4 w-4" />
                Create tag
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
