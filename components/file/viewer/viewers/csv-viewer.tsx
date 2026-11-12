import { useMemo } from 'react'

import { Sheet } from 'lucide-react'
import Papa from 'papaparse'

import { cn } from '@/lib/utils'

import { ErrorState } from '../components/error-state'
import {
  LoadingState,
  stageMaxHeightClassName,
} from '../components/loading-state'
import { PreviewPlaceholder } from '../components/preview-placeholder'
import { usePreviewText } from '../preview-text'

const failedSpreadsheet = () => 'This spreadsheet couldn’t be loaded.'

const count = (value: number, noun: string) =>
  `${value.toLocaleString('en-US')} ${noun}${value === 1 ? '' : 's'}`

/**
 * A CSV or TSV file's rows. A tab-separated file names its delimiter; a
 * guess would take the commas inside its cells for the delimiter. A CSV's is
 * detected, so semicolon-separated files read too.
 */
export function parseTable(text: string, delimiter?: '\t'): string[][] {
  return Papa.parse<string[]>(text, {
    header: false,
    skipEmptyLines: true,
    delimiter: delimiter ?? '',
  }).data
}

/** A table row's height and a typical row's size, for the loading state. */
const ROW_HEIGHT = 37
const BYTES_PER_ROW = 48

export function CsvViewer({
  url,
  bytes,
  delimiter,
}: {
  url: string
  /** The file's size, which sizes the loading state. */
  bytes?: number
  /** Set for a tab-separated file. */
  delimiter?: '\t'
}) {
  const preview = usePreviewText(url, failedSpreadsheet)
  const csvData = useMemo(
    () =>
      preview.status === 'ready' ? parseTable(preview.text, delimiter) : [],
    [preview, delimiter]
  )

  if (preview.status === 'loading')
    return (
      <LoadingState
        message="Loading spreadsheet…"
        className={stageMaxHeightClassName}
        // The header row, the rows a file this size probably has, and the
        // line that counts them.
        style={{
          height: (Math.ceil((bytes ?? 4096) / BYTES_PER_ROW) + 2) * ROW_HEIGHT,
        }}
      />
    )
  if (preview.status === 'failed') return <ErrorState error={preview.message} />
  if (csvData.length === 0)
    return (
      <div className="w-full p-4 sm:p-5">
        <PreviewPlaceholder icon={Sheet} title="This spreadsheet is empty" />
      </div>
    )

  const columns = csvData.reduce((most, row) => Math.max(most, row.length), 0)

  return (
    <div
      className={cn('flex w-full min-w-0 flex-col', stageMaxHeightClassName)}
    >
      <div
        className="min-h-0 w-full flex-1 overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="region"
        aria-label="Spreadsheet data"
        tabIndex={0}
      >
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {csvData[0]?.map((header, index) => (
                <th
                  key={index}
                  scope="col"
                  className="whitespace-nowrap border-b border-r border-border px-3 py-2 text-left font-medium last:border-r-0"
                >
                  {header || `Column ${index + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {csvData.slice(1).map((row, index) => (
              <tr
                key={index}
                className="border-b border-border/60 last:border-0 even:bg-muted/20 hover:bg-muted/40"
              >
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className="border-r border-border/60 px-3 py-2 align-top last:border-r-0"
                  >
                    {/* A date or a code stays on one line and long text
                        wraps at a readable width; the table scrolls
                        sideways when its columns need more than the page. */}
                    <div className="w-max max-w-xs break-words">{cell}</div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* The first row is shown as the header, so it isn't counted. */}
      <p className="shrink-0 border-t border-border/60 px-4 py-2 text-xs text-muted-foreground sm:px-5">
        {count(csvData.length - 1, 'row')} · {count(columns, 'column')}
      </p>
    </div>
  )
}
