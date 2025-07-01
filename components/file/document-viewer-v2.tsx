'use client'

import { useEffect, useState } from 'react'

import DOMPurify from 'dompurify'
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileText,
  Search,
  Table,
} from 'lucide-react'
import Papa from 'papaparse'
import type { ParseResult } from 'papaparse'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

import { MAX_CSV_SIZE } from './protected/mime-types'

interface DocumentViewerV2Props {
  file: {
    name: string
    urlPath: string
    mimeType: string
  }
  fileUrl: string
  isFullscreen: boolean
}

export function DocumentViewerV2({
  file,
  fileUrl,
  isFullscreen,
}: DocumentViewerV2Props) {
  const [csvData, setCsvData] = useState<string[][]>([])
  const [filteredData, setFilteredData] = useState<string[][]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [sortColumn, setSortColumn] = useState<number | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string>()
  const [isLoading, setIsLoading] = useState(true)

  const itemsPerPage = 50
  const isPdf = file.mimeType === 'application/pdf'
  const isCsv =
    file.mimeType.includes('csv') || file.name.toLowerCase().endsWith('.csv')

  // Load CSV data
  useEffect(() => {
    if (isCsv) {
      const fetchAndParseCsv = async () => {
        try {
          setIsLoading(true)
          const response = await fetch(fileUrl)

          // Check file size
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
              setFilteredData(results.data)
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
    } else {
      setIsLoading(false)
    }
  }, [fileUrl, isCsv])

  // Filter data based on search term
  useEffect(() => {
    if (!searchTerm) {
      setFilteredData(csvData)
      return
    }

    const filtered = csvData.filter((row, index) => {
      // Always include header row
      if (index === 0) return true

      return row.some((cell) =>
        cell?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    })

    setFilteredData(filtered)
    setCurrentPage(1)
  }, [searchTerm, csvData])

  // Sort data
  const handleSort = (columnIndex: number) => {
    if (sortColumn === columnIndex) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(columnIndex)
      setSortDirection('asc')
    }

    const header = filteredData[0]
    const dataRows = filteredData.slice(1)

    const sorted = [...dataRows].sort((a, b) => {
      const aVal = a[columnIndex] || ''
      const bVal = b[columnIndex] || ''

      // Try to parse as numbers for better sorting
      const aNum = parseFloat(aVal)
      const bNum = parseFloat(bVal)

      if (!isNaN(aNum) && !isNaN(bNum)) {
        return sortDirection === 'asc' ? aNum - bNum : bNum - aNum
      }

      return sortDirection === 'asc'
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal)
    })

    setFilteredData([header, ...sorted])
  }

  // Pagination
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentData = filteredData.slice(startIndex, endIndex)
  const totalPages = Math.ceil(filteredData.length / itemsPerPage)

  if (isLoading && isCsv) {
    return (
      <Card className="w-full h-96 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
          <p className="text-sm text-muted-foreground">Loading document...</p>
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="w-full h-96 flex items-center justify-center">
        <div className="text-center">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-medium mb-2">Cannot preview document</h3>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button
            onClick={() => window.open(fileUrl, '_blank')}
            variant="outline"
          >
            <Download className="h-4 w-4 mr-2" />
            Download to view
          </Button>
        </div>
      </Card>
    )
  }

  // PDF Viewer
  if (isPdf) {
    return (
      <div className="w-full">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b bg-muted/50">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              <span className="text-sm font-medium">{file.name}</span>
            </div>
            <Button
              onClick={() => window.open(fileUrl, '_blank')}
              variant="outline"
              size="sm"
            >
              <Download className="h-4 w-4 mr-2" />
              Download
            </Button>
          </div>

          <div className={`${isFullscreen ? 'h-screen' : 'h-[70vh]'}`}>
            <iframe
              src={DOMPurify.sanitize(fileUrl)}
              className="w-full h-full border-0"
              title={file.name}
            />
          </div>
        </Card>
      </div>
    )
  }

  // CSV Viewer
  if (isCsv) {
    return (
      <div className="w-full">
        <Card className="overflow-hidden">
          {/* Header with search and stats */}
          <div className="p-4 border-b bg-muted/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Table className="h-4 w-4" />
                <span className="text-sm font-medium">{file.name}</span>
              </div>
              <Button
                onClick={() => window.open(fileUrl, '_blank')}
                variant="outline"
                size="sm"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search in table..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>

              <div className="text-sm text-muted-foreground">
                {filteredData.length > 0 ? filteredData.length - 1 : 0} rows
              </div>
            </div>
          </div>

          {/* Table */}
          <div
            className={`overflow-auto ${isFullscreen ? 'max-h-[calc(100vh-200px)]' : 'max-h-[50vh]'}`}
          >
            <table className="w-full border-collapse">
              <thead className="bg-muted sticky top-0">
                <tr>
                  {currentData[0]?.map((header, i) => (
                    <th
                      key={i}
                      className="p-3 text-left border border-border font-medium cursor-pointer hover:bg-muted-foreground/10 transition-colors"
                      onClick={() => handleSort(i)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate">{header}</span>
                        {sortColumn === i &&
                          (sortDirection === 'asc' ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          ))}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentData.slice(1).map((row, i) => (
                  <tr
                    key={startIndex + i}
                    className="hover:bg-muted/30 transition-colors"
                  >
                    {row.map((cell, j) => (
                      <td key={j} className="p-3 border border-border max-w-xs">
                        <div className="truncate" title={cell}>
                          {cell}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between p-4 border-t bg-muted/30">
              <div className="text-sm text-muted-foreground">
                Showing {startIndex + 1} to{' '}
                {Math.min(endIndex, filteredData.length)} of{' '}
                {filteredData.length} entries
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.max(1, prev - 1))
                  }
                  disabled={currentPage === 1}
                >
                  Previous
                </Button>

                <span className="text-sm px-2">
                  Page {currentPage} of {totalPages}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setCurrentPage((prev) => Math.min(totalPages, prev + 1))
                  }
                  disabled={currentPage === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    )
  }

  return null
}
