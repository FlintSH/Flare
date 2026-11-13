import { onDemand } from '@/components/shared/on-demand'

/**
 * What the file library opens from a click. Each is fetched the first time
 * it is asked for, so opening the library doesn't download them all.
 */
export const ArchiveBrowserDialog = onDemand(() =>
  import('@/components/archives/archive-browser-dialog').then(
    (module) => module.ArchiveBrowserDialog
  )
)

export const CreateArchiveDialog = onDemand(() =>
  import('@/components/archives/create-archive-dialog').then(
    (module) => module.CreateArchiveDialog
  )
)

export const MoveFilesDialog = onDemand(() =>
  import('@/components/folders/move-files-dialog').then(
    (module) => module.MoveFilesDialog
  )
)

export const FileTagsDialog = onDemand(() =>
  import('@/components/tags/file-tags-dialog').then(
    (module) => module.FileTagsDialog
  )
)

export const TagManager = onDemand(() =>
  import('@/components/tags/tag-manager').then((module) => module.TagManager)
)

export const ImageLightbox = onDemand(() =>
  import('@/components/file/image-lightbox').then(
    (module) => module.ImageLightbox
  )
)

export const ExpiryModal = onDemand(() =>
  import('@/components/shared/expiry-modal').then(
    (module) => module.ExpiryModal
  )
)

/** The date filter's month view. */
export const Calendar = onDemand(() =>
  import('@/components/ui/calendar').then((module) => module.Calendar)
)
