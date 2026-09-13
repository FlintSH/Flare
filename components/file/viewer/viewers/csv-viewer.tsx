import { useEffect, useState } from 'react'

import Papa from 'papaparse'

import { MAX_CSV_SIZE } from '../../protected/mime-types'
import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function CsvViewer() {
  const { state } = useFileViewer()
  const [csvData, setCsvData] = useState<string[][]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)
  const fileUrl = state.urls?.fileUrl

  useEffect(() => {
    if (!fileUrl) return
    const controller = new AbortController()
    setIsLoading(true)
    setError(undefined)

    const fetchAndParseCsv = async () => {
      try {
        const response = await fetch(fileUrl, { signal: controller.signal })
        if (!response.ok)
          throw new Error('This spreadsheet couldn’t be loaded.')
        const contentLength = Number(response.headers.get('content-length'))
        if (contentLength > MAX_CSV_SIZE)
          throw new Error(
            'This file is too large to preview. Download it to view all its data.'
          )
        const blob = await response.blob()
        if (blob.size > MAX_CSV_SIZE)
          throw new Error(
            'This file is too large to preview. Download it to view all its data.'
          )
        const text = await blob.text()
        const results = Papa.parse<string[]>(text, {
          header: false,
          skipEmptyLines: true,
        })
        if (!controller.signal.aborted) setCsvData(results.data)
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : 'This spreadsheet couldn’t be loaded.'
          )
      } finally {
        if (!controller.signal.aborted) setIsLoading(false)
      }
    }

    void fetchAndParseCsv()
    return () => controller.abort()
  }, [fileUrl])

  if (isLoading) return <LoadingState message="Loading spreadsheet…" />
  if (error) return <ErrorState error={error} />
  if (csvData.length === 0)
    return (
      <p className="w-full px-6 py-16 text-center text-sm text-muted-foreground">
        This spreadsheet is empty.
      </p>
    )

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3 text-xs text-muted-foreground">
        <span className="font-medium">Spreadsheet</span>
        <span>
          {Math.max(0, csvData.length - 1).toLocaleString()} rows ·{' '}
          {csvData[0]?.length ?? 0} columns
        </span>
      </div>
      <div
        className="max-h-[65vh] w-full overflow-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  className="border-b border-border px-4 py-3 text-left font-medium whitespace-nowrap"
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
                    className="px-4 py-3 align-top whitespace-nowrap"
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
