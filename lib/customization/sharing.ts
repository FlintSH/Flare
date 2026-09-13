import type { AppearanceDocument } from './schema'

export function shareMetadataText(
  appearance: AppearanceDocument,
  file: {
    name: string
    formattedSize: string
    uploader: string
    isMedia: boolean
  }
) {
  const { sharing, brand } = appearance
  const name = sharing.showFilename ? file.name : 'Shared file'
  const defaultTitle = `${name}${sharing.showSize ? ` (${file.formattedSize})` : ''}`
  const attribution = sharing.showUploader ? `Uploaded by ${file.uploader}` : ''
  const defaultDescription = file.isMedia
    ? attribution || brand.tagline
    : `${[sharing.showFilename ? file.name : '', sharing.showSize ? file.formattedSize : ''].filter(Boolean).join(' - ')}${attribution ? `, ${attribution[0].toLowerCase()}${attribution.slice(1)}` : ''}`.replace(
        /^, /,
        ''
      ) || brand.tagline
  const fields: Record<string, string> = {
    instanceName: brand.name,
    filename: sharing.showFilename ? file.name : '',
    size: sharing.showSize ? file.formattedSize : '',
    uploader: sharing.showUploader ? file.uploader : '',
  }
  const render = (template: string) =>
    template
      .replace(
        /\{\{([^{}]+)\}\}/g,
        (_match, field: string) => fields[field.trim()] || ''
      )
      .trim()
  const title = render(sharing.titleTemplate) || defaultTitle
  const description = render(sharing.descriptionTemplate) || defaultDescription
  return { title, description, alt: name }
}
