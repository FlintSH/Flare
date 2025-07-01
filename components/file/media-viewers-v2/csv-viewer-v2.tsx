'use client'

import { useCallback, useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import { AlertCircle, Download, Search, Table } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useToast } from '@/hooks/use-toast'

interface CsvViewerV2Props {
  url: string
  title: string
  verifiedPassword?: string
  isLoading: boolean
}

interface CsvData {
  headers: string[]
  rows: string[][]
}

export function CsvViewerV2({ url, title, isLoading }: CsvViewerV2Props) {
  const [csvData, setCsvData] = useState<CsvData | null>(null)
  const [filteredData, setFilteredData] = useState<CsvData | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()

  const parseCsv = useCallback((text: string): CsvData => {
    const lines = text.trim().split('\n')
    if (lines.length === 0) return { headers: [], rows: [] }

    const headers = lines[0]
      .split(',')
      .map((h) => h.trim().replace(/^"|"$/g, ''))
    const rows = lines
      .slice(1)
      .map((line) =>
        line.split(',').map((cell) => cell.trim().replace(/^"|"$/g, ''))
      )

    return { headers, rows }
  }, [])

  const fetchCsvData = useCallback(async () => {
    try {
      setLoading(true)
      const response = await fetch(DOMPurify.sanitize(url))
      if (!response.ok) throw new Error('Failed to fetch CSV data')

      const text = await response.text()
      const data = parseCsv(text)
      setCsvData(data)
      setFilteredData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load CSV data')
    } finally {
      setLoading(false)
    }
  }, [url, parseCsv])

  useEffect(() => {
    if (!isLoading) {
      fetchCsvData()
    }
  }, [fetchCsvData, isLoading])

  useEffect(() => {
    if (!csvData || !searchTerm) {
      setFilteredData(csvData)
      return
    }

    const filtered = {
      headers: csvData.headers,
      rows: csvData.rows.filter((row) =>
        row.some((cell) =>
          cell.toLowerCase().includes(searchTerm.toLowerCase())
        )
      ),
    }
    setFilteredData(filtered)
  }, [csvData, searchTerm])

  const handleDownload = useCallback(() => {
    if (!csvData) return

    const csvContent = [
      csvData.headers.join(','),
      ...csvData.rows.map((row) => row.join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = title
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    toast({
      title: 'CSV downloaded',
      description: 'The CSV file has been downloaded successfully',
    })
  }, [csvData, title, toast])

  if (loading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-3">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto" />
          <p className="text-muted-foreground">Loading CSV data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-4 p-8">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto" />
          <p className="text-muted-foreground">{error}</p>
          <p className="text-sm text-muted-foreground">{title}</p>
          <Button variant="outline" onClick={fetchCsvData}>
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  if (!filteredData || filteredData.headers.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
        <div className="text-center space-y-3">
          <Table className="h-12 w-12 text-muted-foreground mx-auto" />
          <p className="text-muted-foreground">No CSV data found</p>
          <p className="text-sm text-muted-foreground">{title}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-sm border-b">
        <div className="px-4 py-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 dark:bg-green-900/20 rounded-lg">
                <Table className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <h1 className="font-medium truncate">{title}</h1>
                <p className="text-xs text-muted-foreground">
                  {filteredData.rows.length} rows •{' '}
                  {filteredData.headers.length} columns
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search data..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9 w-full sm:w-64"
                />
              </div>
              <Button variant="outline" size="sm" onClick={handleDownload}>
                <Download className="h-4 w-4" />
                <span className="ml-2 hidden sm:inline">Download</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="p-4">
        <div className="bg-background rounded-lg border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-muted/50">
                <tr>
                  {filteredData.headers.map((header, index) => (
                    <th
                      key={index}
                      className="px-4 py-3 text-left text-sm font-medium text-muted-foreground border-r last:border-r-0"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredData.rows.map((row, rowIndex) => (
                  <tr
                    key={rowIndex}
                    className="border-b hover:bg-muted/25 transition-colors"
                  >
                    {row.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="px-4 py-3 text-sm border-r last:border-r-0 max-w-xs truncate"
                        title={cell}
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

        {searchTerm && filteredData.rows.length === 0 && (
          <div className="text-center py-8">
            <Search className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">
              No results found for &quot;{searchTerm}&quot;
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchTerm('')}
              className="mt-2"
            >
              Clear search
            </Button>
          </div>
        )}
      </div>

      {/* Mobile-optimized bottom padding */}
      <div className="h-32 sm:h-0" />
    </div>
  )
}
