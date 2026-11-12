'use client'

import { useId, useState } from 'react'

import { InfoIcon, SlidersHorizontal } from 'lucide-react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { apiRequest } from '@/lib/client/request'
import type { AppearanceDocument } from '@/lib/customization/schema'
import {
  EMBED_LIMITS,
  type PersonalEmbed,
  instanceEmbedCard,
  personalEmbedSchema,
  resolveEmbedSettings,
} from '@/lib/embeds/schema'
import { isEmbedTemplate } from '@/lib/embeds/template'

import { useToast } from '@/hooks/use-toast'

import {
  EMBED_MODE_CHOICES,
  EMBED_MODE_OPTIONS,
  EmbedCardFields,
  type EmbedModeOption,
  EmbedModePicker,
} from './embed-fields'
import { EmbedPreview } from './embed-preview'

const CARD_LINES = Object.keys(EMBED_LIMITS) as (keyof typeof EMBED_LIMITS)[]

export function PersonalEmbedSettings({
  initial,
  appearance,
  uploader,
}: {
  initial: PersonalEmbed
  /** The published instance appearance. */
  appearance: Pick<AppearanceDocument, 'brand' | 'sharing'>
  uploader: string
}) {
  const { toast } = useToast()
  const designId = useId()
  const [draft, setDraft] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { sharing } = appearance
  // Lines written and then switched off again change nothing that applies.
  const changed = (Object.keys(saved) as (keyof PersonalEmbed)[]).some(
    (key) =>
      draft[key] !== saved[key] &&
      (key === 'mode' ||
        key === 'design' ||
        draft.design === 'custom' ||
        saved.design === 'custom')
  )
  const preview = (
    <EmbedPreview
      {...resolveEmbedSettings(sharing, draft)}
      appearance={appearance}
      uploader={uploader}
    />
  )

  if (!sharing.personalEmbeds)
    return (
      <div className="space-y-6">
        <Alert variant="info" role="status">
          <InfoIcon aria-hidden="true" />
          <AlertDescription>
            This instance uses one embed for every account.
          </AlertDescription>
        </Alert>
        <div className="max-w-xl">{preview}</div>
      </div>
    )

  const modeOptions: EmbedModeOption<PersonalEmbed['mode']>[] = [
    {
      value: 'inherit',
      title: 'Use the instance’s',
      description: `Currently ${EMBED_MODE_CHOICES[sharing.embedMode].title.toLowerCase()}.`,
      glyph: <SlidersHorizontal className="h-5 w-5 text-muted-foreground" />,
    },
    ...EMBED_MODE_OPTIONS,
  ]

  function setDesign(custom: boolean) {
    const instance = instanceEmbedCard(sharing)
    // A first card of one's own starts as the instance's.
    const untouched = (
      Object.keys(instance) as (keyof typeof instance)[]
    ).every((key) => !draft[key])
    // Hidden lines are still saved, so one that can't be saved goes back to
    // what it was rather than blocking Save out of sight.
    const lines = Object.fromEntries(
      CARD_LINES.map((key) => [
        key,
        isEmbedTemplate(draft[key]) ? draft[key] : saved[key],
      ])
    )
    setDraft({
      ...draft,
      ...(custom ? (untouched ? instance : {}) : lines),
      design: custom ? 'custom' : 'inherit',
    })
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await apiRequest('/api/profile/embed', {
        method: 'PATCH',
        body: draft,
        fallback: 'Embed settings could not be saved.',
      })
      setSaved(draft)
      toast({ title: 'Your embed is saved' })
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Embed settings could not be saved.'
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(280px,.9fr)]">
      <div className="min-w-0 space-y-4">
        {error && (
          <p
            role="alert"
            className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        <Card>
          <CardContent className="space-y-6 p-4 sm:p-6">
            <EmbedModePicker
              label="Embed mode"
              options={modeOptions}
              value={draft.mode}
              onChange={(mode) => setDraft({ ...draft, mode })}
            />
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-0.5">
                <Label htmlFor={designId}>Use my own card</Label>
                <p className="text-pretty text-sm text-muted-foreground">
                  Write your own lines instead of this instance’s.
                </p>
              </div>
              <Switch
                id={designId}
                checked={draft.design === 'custom'}
                onCheckedChange={setDesign}
              />
            </div>
            {draft.design === 'custom' && (
              <EmbedCardFields
                value={draft}
                onChange={(key, value) => setDraft({ ...draft, [key]: value })}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-pretty text-sm text-muted-foreground">
                Apps keep previews they already made. Changes show on links
                pasted from now on.
              </p>
              <Button
                className="w-full sm:ml-auto sm:w-auto"
                disabled={
                  busy ||
                  !changed ||
                  !personalEmbedSchema.safeParse(draft).success
                }
                onClick={save}
              >
                {busy ? 'Saving…' : 'Save embed'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <div className="min-w-0 self-start xl:sticky xl:top-24">{preview}</div>
    </div>
  )
}
