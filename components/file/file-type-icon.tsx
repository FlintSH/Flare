import {
  Archive,
  File,
  FileCode,
  FileText,
  Image as ImageIcon,
  type LucideIcon,
  Music,
  Table,
  Video,
} from 'lucide-react'

import {
  type FileIconKey,
  type FileTypeInput,
  fileIcon,
} from '@/lib/files/file-kind'

const ICONS: Record<FileIconKey, LucideIcon> = {
  image: ImageIcon,
  video: Video,
  audio: Music,
  text: FileText,
  code: FileCode,
  table: Table,
  archive: Archive,
  file: File,
}

/** What a file holds, as the library card and the moderation list show it. */
export function FileTypeIcon({
  file,
  className,
}: {
  file: FileTypeInput
  className?: string
}) {
  const Icon = ICONS[fileIcon(file)]
  return <Icon className={className} />
}
