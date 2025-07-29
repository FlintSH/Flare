'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'

import { MAX_CSV_SIZE } from './mime-types'

interface CsvViewerProps {
  url: string
  title: string
  verifiedPassword?: string
}

export function CsvViewer({ url, verifiedPassword }: CsvViewerProps) {
  const [csvData, setCsvData] = useState<string[][]>([])
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchAndParseCsv = async () => {
      try {
        const sanitizedUrl = DOMPurify.sanitize(
          url +
            (verifiedPassword
              ? `?password=${DOMPurify.sanitize(verifiedPassword)}`
              : '')
        )
        const response = await fetch(sanitizedUrl)

        const contentLength = response.headers.get('content-length')
        if (contentLength && parseInt(contentLength) > MAX_CSV_SIZE) {
          setError('File is too large for preview. Please download to view.')
          setIsLoading(false)
          return
        }

        const text = await response.text()
        Papa.parse<string[]>(text, {
          complete: (results: ParseResult<string[]>) => {
            console.log('CSV parsed:', results.data.length, 'rows')
            setCsvData(results.data)
            setIsLoading(false)
          },
          error: (error: Error) => {
            console.error('CSV parse error:', error)
            setError('Failed to parse CSV: ' + error.message)
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
  }, [url, verifiedPassword])

  if (isLoading) {
    return (
      <div className="w-full flex items-center justify-center p-8">
        <p className="text-muted-foreground">Loading CSV data...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full flex flex-col items-center justify-center p-8 text-center">
        <p className="text-muted-foreground mb-4">{error}</p>
        <p className="text-sm text-muted-foreground">
          Use the download button above to view this file.
        </p>
      </div>
    )
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
