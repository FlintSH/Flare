import { useEffect, useState } from 'react'

import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'

import { MAX_CSV_SIZE } from '../../protected/mime-types'
import { ErrorState } from '../components/error-state'
import { LoadingState } from '../components/loading-state'
import { useFileViewer } from '../context'

export function CsvViewer() {
  const { state } = useFileViewer()
  const [csvData, setCsvData] = useState<string[][]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!state.urls?.fileUrl) return

    const fetchAndParseCsv = async () => {
      try {
        const response = await fetch(state.urls!.fileUrl)

        const contentLength = response.headers.get('content-length')
        if (contentLength && parseInt(contentLength) > MAX_CSV_SIZE) {
          setError('File is too large for preview. Please download to view.')
          setIsLoading(false)
          return
        }

        const text = await response.text()
        Papa.parse<string[]>(text, {
          complete: (results: ParseResult<string[]>) => {
            setCsvData(results.data)
            setIsLoading(false)
          },
          error: (parseError: Error) => {
            setError('Failed to parse CSV: ' + parseError.message)
            setIsLoading(false)
          },
          header: false,
          skipEmptyLines: true,
          delimiter: ',',
          newline: '\n',
        })
      } catch {
        setError('Failed to load CSV file')
        setIsLoading(false)
      }
    }

    fetchAndParseCsv()
  }, [state.urls])

  if (isLoading) {
    return <LoadingState message="Loading CSV data..." />
  }

  if (error) {
    return <ErrorState error={error} />
  }

  return (
    <div className="w-full max-h-[60vh] overflow-auto">
      <table className="w-full border-collapse">
        <thead className="bg-muted sticky top-0">
          <tr>
            {csvData[0]?.map((header, i) => (
              <th
                key={i}
                className="p-2 text-left border border-border font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {csvData.slice(1).map((row, i) => (
            <tr key={i} className="hover:bg-muted/50">
              {row.map((cell, j) => (
                <td key={j} className="p-2 border border-border">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
