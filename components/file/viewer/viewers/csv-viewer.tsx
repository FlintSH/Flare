import { useMemo } from 'react'

import { Sheet } from 'lucide-react'
import Papa from 'papaparse'

import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { PreviewPlaceholder } from '../components/preview-placeholder'
import { usePreviewText } from '../preview-text'

const failedSpreadsheet = () => 'This spreadsheet couldn’t be loaded.'

export function CsvViewer({ url }: { url: string }) {
  const preview = usePreviewText(url, failedSpreadsheet)
  const csvData = useMemo(
    () =>
      preview.status === 'ready'
        ? Papa.parse<string[]>(preview.text, {
            header: false,
            skipEmptyLines: true,
          }).data
        : [],
    [preview]
  )

  if (preview.status === 'loading')
    return <LoadingState message="Loading spreadsheet…" />
  if (preview.status === 'failed') return <ErrorState error={preview.message} />
  if (csvData.length === 0)
    return (
      <div className="w-full px-6">
        <PreviewPlaceholder icon={Sheet} title="This spreadsheet is empty" />
      </div>
    )

  return (
    <div className="w-full min-w-0">
      <div
        className="max-h-[60vh] w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        role="region"
        aria-label="Spreadsheet data"
        tabIndex={0}
      >
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 bg-muted">
            <tr>
              {csvData[0]?.map((header, index) => (
                <th
                  key={index}
                  scope="col"
                  className="border border-border px-3 py-2 text-left font-medium whitespace-nowrap"
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
                className="border-b border-border/50 last:border-0 even:bg-muted/20 hover:bg-muted/40"
              >
                {row.map((cell, column) => (
                  <td
                    key={column}
                    className="border border-border/60 px-3 py-2 align-top"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
