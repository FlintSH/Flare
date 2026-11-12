import type { AppearanceDocument } from '@/lib/customization/schema'
import { fileTypeLabel } from '@/lib/files/file-kind'

import { EMBED_LIMITS, type EmbedCardTemplates } from './schema'
import { type EmbedValues, cutToLimit, renderTemplate } from './template'

/** What a card can say about one file. */
export interface EmbedFile {
  name: string
  /** As shown to people, such as `1.8 MB`. */
  size: string
  mimeType: string
  uploader: string
  uploadedAt: Date | string
  views: number
}

/** The card as one file fills it in. An empty line is not shown. */
export interface EmbedCard {
  siteName: string
  author: string
  title: string
  description: string
  color: string
}

const HIDDEN_NAME = 'Shared file'

const date = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})
const count = new Intl.NumberFormat('en-US')

/**
 * Fill the card in for a file. Details the instance hides from share pages
 * stay out of every line, whoever wrote it. The title is never empty.
 */
export function renderEmbedCard(
  templates: EmbedCardTemplates,
  file: EmbedFile,
  { brand, sharing }: Pick<AppearanceDocument, 'brand' | 'sharing'>
): EmbedCard {
  const uploaded = new Date(file.uploadedAt)
  const values: EmbedValues = {
    filename: sharing.showFilename ? file.name : '',
    size: sharing.showSize ? file.size : '',
    type: fileTypeLabel(file.mimeType),
    uploader: sharing.showUploader ? file.uploader : '',
    date: Number.isNaN(uploaded.getTime()) ? '' : date.format(uploaded),
    views: count.format(file.views),
    instanceName: brand.name,
  }
  const line = (key: keyof typeof EMBED_LIMITS, fields = values) =>
    renderTemplate(templates[key], fields, EMBED_LIMITS[key])
  const name = values.filename || HIDDEN_NAME
  return {
    siteName: line('siteName'),
    author: line('author'),
    // A title names the file even when its name is hidden. The name is cut
    // like any line: uploads can carry names longer than a title may be.
    title:
      line('title', { ...values, filename: name }) ||
      cutToLimit(name, EMBED_LIMITS.title),
    description: line('description'),
    color: templates.color,
  }
}

/** What stands in for an image a preview can't show, such as its alt text. */
export function embedFileLabel(
  file: Pick<EmbedFile, 'name'>,
  sharing: AppearanceDocument['sharing']
) {
  return sharing.showFilename
    ? cutToLimit(file.name, EMBED_LIMITS.title)
    : HIDDEN_NAME
}
