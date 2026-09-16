import { Fragment, memo } from 'react'

import { FileGrouping, SortOption } from '@/types/components/file'
import { format } from 'date-fns'
import {
  Calendar as CalendarIcon,
  Eye,
  Filter,
  Globe,
  KeyRound,
  Lock,
} from 'lucide-react'
import { DateRange } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { cn } from '@/lib/utils'

interface FileFiltersProps {
  sortBy: SortOption
  onSortChange: (value: SortOption) => void
  selectedTypes: string[]
  onTypesChange: (types: string[]) => void
  fileTypes: string[]
  date: DateRange | undefined
  onDateChange: (range: DateRange | undefined) => void
  groupBy: FileGrouping
  onGroupChange: (groupBy: FileGrouping) => void
  visibility: string[]
  onVisibilityChange: (visibility: string[]) => void
}

const sortOptions: { value: SortOption; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'largest', label: 'Largest first' },
  { value: 'smallest', label: 'Smallest first' },
  { value: 'most-viewed', label: 'Most viewed' },
  { value: 'least-viewed', label: 'Least viewed' },
  { value: 'most-downloaded', label: 'Most downloaded' },
  { value: 'least-downloaded', label: 'Least downloaded' },
]

const visibilityOptions = [
  { value: 'public', label: 'Public', icon: Globe },
  { value: 'private', label: 'Private', icon: Lock },
  { value: 'hasPassword', label: 'Password protected', icon: KeyRound },
]

function getFileTypeCategory(type: string) {
  if (type.startsWith('image/')) return 'Images'
  if (type.startsWith('video/')) return 'Videos'
  if (type.startsWith('audio/')) return 'Audio'
  if (
    type.includes('pdf') ||
    type.includes('document') ||
    type.startsWith('text/')
  )
    return 'Documents'
  return 'Other files'
}

function getFileTypeLabel(type: string) {
  const knownTypes: Record<string, string> = {
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      'Word document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
      'Excel spreadsheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation':
      'PowerPoint presentation',
    'application/octet-stream': 'Other file',
    'text/plain': 'Plain text',
    'image/svg+xml': 'SVG',
  }
  return knownTypes[type] || (type.split('/')[1] || type).toUpperCase()
}

export const FileFilters = memo(function FileFilters({
  sortBy,
  onSortChange,
  selectedTypes,
  onTypesChange,
  fileTypes,
  date,
  onDateChange,
  groupBy,
  onGroupChange,
  visibility,
  onVisibilityChange,
}: FileFiltersProps) {
  const fileTypesByCategory = [...new Set([...fileTypes, ...selectedTypes])]
    .sort()
    .reduce(
      (groups, type) => {
        const category = getFileTypeCategory(type)
        ;(groups[category] ||= []).push(type)
        return groups
      },
      {} as Record<string, string[]>
    )
  const filterClass =
    'relative h-10 w-10 shrink-0 justify-center rounded-lg bg-background/70 p-0 sm:w-auto sm:justify-between sm:gap-2 sm:px-3'

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={sortBy} onValueChange={onSortChange}>
        <SelectTrigger
          aria-label="Sort files"
          className="h-10 min-w-0 flex-1 rounded-lg bg-background/70 sm:w-[172px] sm:flex-none"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {sortOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-label="Visibility"
            className={cn(
              filterClass,
              visibility.length > 0 && 'border-primary/40 bg-primary/5'
            )}
          >
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="hidden sm:inline">Visibility</span>
            {visibility.length > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-background px-1 text-xs text-primary sm:static sm:bg-transparent sm:p-0">
                {visibility.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56 bg-popover">
          <DropdownMenuLabel>Who can access</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {visibilityOptions.map(({ value, label, icon: Icon }) => (
            <DropdownMenuCheckboxItem
              key={value}
              checked={visibility.includes(value)}
              onSelect={(event) => event.preventDefault()}
              onCheckedChange={(checked) =>
                onVisibilityChange(
                  checked
                    ? [...visibility, value]
                    : visibility.filter((item) => item !== value)
                )
              }
            >
              <Icon className="mr-2 h-4 w-4 text-muted-foreground" />
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            aria-label="File type"
            className={cn(
              filterClass,
              selectedTypes.length > 0 && 'border-primary/40 bg-primary/5'
            )}
          >
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="hidden sm:inline">File type</span>
            {selectedTypes.length > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-background px-1 text-xs text-primary sm:static sm:bg-transparent sm:p-0">
                {selectedTypes.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-80 w-64 overflow-y-auto bg-popover"
        >
          <DropdownMenuLabel>Filter by file type</DropdownMenuLabel>
          {Object.entries(fileTypesByCategory).map(([category, types]) => (
            <Fragment key={category}>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                {category}
              </DropdownMenuLabel>
              {types.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  title={type}
                  checked={selectedTypes.includes(type)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(checked) =>
                    onTypesChange(
                      checked
                        ? [...selectedTypes, type]
                        : selectedTypes.filter((item) => item !== type)
                    )
                  }
                >
                  <span className="truncate">{getFileTypeLabel(type)}</span>
                </DropdownMenuCheckboxItem>
              ))}
            </Fragment>
          ))}
          {Object.keys(fileTypesByCategory).length === 0 && (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              File types appear after your first upload.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            aria-label="Upload date"
            className={cn(
              filterClass,
              (date?.from || groupBy !== 'none') &&
                'border-primary/40 bg-primary/5'
            )}
          >
            <CalendarIcon className="h-4 w-4 text-muted-foreground" />
            <span className="hidden truncate sm:inline">
              {date?.from
                ? `${format(date.from, 'MMM d')}${date.to ? ` – ${format(date.to, 'MMM d')}` : ''}`
                : 'Upload date'}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={onDateChange}
            numberOfMonths={1}
          />
          <div className="flex items-center justify-between gap-3 border-t px-3 py-3">
            <span className="text-sm text-muted-foreground">Group files</span>
            <Select value={groupBy} onValueChange={onGroupChange}>
              <SelectTrigger
                aria-label="Group files by upload date"
                className="h-9 w-36 text-sm"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No grouping</SelectItem>
                <SelectItem value="week">By week</SelectItem>
                <SelectItem value="month">By month</SelectItem>
                <SelectItem value="year">By year</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {date?.from && (
            <div className="border-t p-2">
              <Button
                variant="ghost"
                className="w-full"
                onClick={() => onDateChange(undefined)}
              >
                Clear date range
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
})
