import type { FileType } from '@/types/components/file'
import {
  AlertCircle,
  Archive,
  Clock,
  FileText,
  Folder,
  ScanText,
  Tag,
  Type,
} from 'lucide-react'

import { INDEX_FILTERS } from '@/lib/library/contract'
import {
  CONTENT_SOURCE_LABELS,
  type ContentSource,
} from '@/lib/search/contract'
import type { TextSegment } from '@/lib/search/text'

/** The strip's height in pixels, border included; the virtual list adds it. */
export const MATCH_DETAILS_HEIGHT = 45

const SOURCE_ICONS: Record<ContentSource, typeof FileText> = {
  ocr: ScanText,
  text: FileText,
  pdf: FileText,
  document: FileText,
  archive: Archive,
}

function Marked({ segments }: { segments: TextSegment[] }) {
  return segments.map((segment, index) =>
    segment.match ? (
      <mark
        key={index}
        className="rounded-sm bg-primary/20 px-px text-foreground"
      >
        {segment.text}
      </mark>
    ) : (
      <span key={index}>{segment.text}</span>
    )
  )
}

function Reason({
  icon: Icon,
  children,
}: {
  icon: typeof FileText
  children: React.ReactNode
}) {
  return (
    <span className="mr-2 inline-flex items-center gap-1 font-medium text-foreground/90">
      <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
      {children}
    </span>
  )
}

/**
 * Why a search result matched, with the text that matched; or, while
 * filtering by search index status, what Flare could read from the file.
 * Always two lines tall, so every card in a list is the same height.
 */
export function MatchDetails({ file }: { file: FileType }) {
  const { match, searchIndex } = file
  let body: React.ReactNode
  if (match) {
    const reasons: React.ReactNode[] = []
    if (match.name)
      reasons.push(
        <Reason key="name" icon={Type}>
          Name
        </Reason>
      )
    for (const tag of match.tags)
      reasons.push(
        <Reason key={`tag-${tag.id}`} icon={Tag}>
          {tag.name}
        </Reason>
      )
    if (match.folder)
      reasons.push(
        <Reason key="folder" icon={Folder}>
          {match.folder.path}
        </Reason>
      )
    if (match.content)
      reasons.push(
        <Reason key="content" icon={SOURCE_ICONS[match.content.source]}>
          {CONTENT_SOURCE_LABELS[match.content.source]}
        </Reason>
      )
    if (match.entries)
      reasons.push(
        <Reason key="entries" icon={Archive}>
          {CONTENT_SOURCE_LABELS.archive}
        </Reason>
      )
    body = (
      <>
        {reasons}
        {match.missing.length > 0 && (
          <span className="mr-2 text-muted-foreground">
            Missing:{' '}
            {match.missing.map((word, index) => (
              <span key={word}>
                {index > 0 && ' '}
                <s>{word}</s>
              </span>
            ))}
          </span>
        )}
        {match.content ? (
          <span className="text-muted-foreground">
            <Marked segments={match.content.snippet} />
          </span>
        ) : match.entries ? (
          <span className="text-muted-foreground">
            {match.entries.paths.map((path, index) => (
              <span key={index}>
                {index > 0 && ', '}
                <Marked segments={path} />
              </span>
            ))}
            {match.entries.more > 0 && ` and ${match.entries.more} more`}
          </span>
        ) : null}
      </>
    )
  } else if (searchIndex) {
    const label =
      INDEX_FILTERS.find((filter) => filter.value === searchIndex.state)
        ?.label ?? ''
    const Icon =
      searchIndex.state === 'failed'
        ? AlertCircle
        : searchIndex.state === 'waiting'
          ? Clock
          : searchIndex.source
            ? SOURCE_ICONS[searchIndex.source]
            : FileText
    body = (
      <>
        <Reason icon={Icon}>
          {searchIndex.state === 'indexed' && searchIndex.source
            ? CONTENT_SOURCE_LABELS[searchIndex.source]
            : label}
        </Reason>
        <span className="text-muted-foreground">
          {searchIndex.reason ??
            (searchIndex.state === 'unsupported'
              ? 'Flare doesn’t read this kind of file; its name, tags and folder are searchable.'
              : searchIndex.state === 'waiting'
                ? 'Flare will read this file in the background.'
                : null)}
        </span>
      </>
    )
  }
  return (
    <div
      data-testid="match-details"
      className="h-[2.8125rem] border-t border-border/40 px-3 py-1.5 text-xs leading-4"
    >
      <p className="line-clamp-2 [overflow-wrap:anywhere]">{body}</p>
    </div>
  )
}
