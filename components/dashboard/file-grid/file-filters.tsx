import React, { memo } from 'react'

import { SortOption } from '@/types/components/file'
import { format } from 'date-fns'
import {
  ArrowDown,
  ArrowUp,
  Calendar as CalendarIcon,
  Check,
  Clock,
  Download,
  Eye,
  FileText,
  Filter,
  Globe,
  HardDrive,
  Image,
  Key,
  Lock,
  Music,
  Video,
} from 'lucide-react'
import { DateRange } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { cn } from '@/lib/utils'

interface FileFiltersProps {
  sortBy: SortOption
  onSortChange: (value: SortOption) => void
  selectedTypes: string[]
  onTypesChange: (types: string[]) => void
  fileTypes: string[]
  date: DateRange | undefined
  onDateChange: (range: DateRange | undefined) => void
  visibility: string[]
  onVisibilityChange: (visibility: string[]) => void
}

type SortCategory = 'date' | 'size' | 'views' | 'downloads'
type SortDirection = 'desc' | 'asc'

const getSortInfo = (
  sortBy: SortOption
): {
  category: SortCategory
  direction: SortDirection
  label: string
  icon: React.ElementType
} => {
  switch (sortBy) {
    case 'newest':
      return { category: 'date', direction: 'desc', label: 'Date', icon: Clock }
    case 'oldest':
      return { category: 'date', direction: 'asc', label: 'Date', icon: Clock }
    case 'largest':
      return {
        category: 'size',
        direction: 'desc',
        label: 'Size',
        icon: HardDrive,
      }
    case 'smallest':
      return {
        category: 'size',
        direction: 'asc',
        label: 'Size',
        icon: HardDrive,
      }
    case 'most-viewed':
      return { category: 'views', direction: 'desc', label: 'Views', icon: Eye }
    case 'least-viewed':
      return { category: 'views', direction: 'asc', label: 'Views', icon: Eye }
    case 'most-downloaded':
      return {
        category: 'downloads',
        direction: 'desc',
        label: 'Downloads',
        icon: Download,
      }
    case 'least-downloaded':
      return {
        category: 'downloads',
        direction: 'asc',
        label: 'Downloads',
        icon: Download,
      }
    default:
      return { category: 'date', direction: 'desc', label: 'Date', icon: Clock }
  }
}

const getSortOptionFromCategory = (
  category: SortCategory,
  direction: SortDirection
): SortOption => {
  switch (category) {
    case 'date':
      return direction === 'desc' ? 'newest' : 'oldest'
    case 'size':
      return direction === 'desc' ? 'largest' : 'smallest'
    case 'views':
      return direction === 'desc' ? 'most-viewed' : 'least-viewed'
    case 'downloads':
      return direction === 'desc' ? 'most-downloaded' : 'least-downloaded'
  }
}

const getFileTypeIcon = (type: string): React.ElementType => {
  const lowerType = type.toLowerCase()

  if (
    [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ].includes(lowerType)
  ) {
    return Image
  }

  if (['video/mp4', 'video/webm', 'video/mpeg'].includes(lowerType)) {
    return Video
  }

  if (['audio/mpeg', 'audio/wav', 'audio/ogg'].includes(lowerType)) {
    return Music
  }

  if (
    [
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ].includes(lowerType)
  ) {
    return FileText
  }

  return FileText
}

const getFileTypeCategory = (type: string): string => {
  const lowerType = type.toLowerCase()

  if (lowerType.startsWith('image/')) return 'Images'
  if (lowerType.startsWith('video/')) return 'Videos'
  if (lowerType.startsWith('audio/')) return 'Audio'
  if (
    lowerType.includes('pdf') ||
    lowerType.includes('document') ||
    lowerType.startsWith('text/')
  )
    return 'Documents'

  return 'Other'
}

export const FileFilters = memo(function FileFilters({
  sortBy,
  onSortChange,
  selectedTypes,
  onTypesChange,
  fileTypes,
  date,
  onDateChange,
  visibility,
  onVisibilityChange,
}: FileFiltersProps) {
  const { category, direction, label } = getSortInfo(sortBy)
  const SortIcon = direction === 'desc' ? ArrowDown : ArrowUp

  const handleSortSelect = (
    newCategory: SortCategory,
    newDirection: SortDirection
  ) => {
    const newSortOption = getSortOptionFromCategory(newCategory, newDirection)
    onSortChange(newSortOption)
  }

  const fileTypesByCategory = fileTypes.reduce(
    (acc, type) => {
      const category = getFileTypeCategory(type)
      if (!acc[category]) acc[category] = []
      acc[category].push(type)
      return acc
    },
    {} as Record<string, string[]>
  )

  return (
    <div className="flex gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-[120px] flex items-center justify-between bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200"
          >
            <span>{label}</span>
            <SortIcon className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          {}
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Date
              </div>
            </div>
            <div className="flex gap-1 mt-2">
              <Button
                variant={
                  category === 'date' && direction === 'desc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('date', 'desc')}
              >
                Newest
              </Button>
              <Button
                variant={
                  category === 'date' && direction === 'asc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('date', 'asc')}
              >
                Oldest
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          {}
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                Size
              </div>
            </div>
            <div className="flex gap-1 mt-2">
              <Button
                variant={
                  category === 'size' && direction === 'desc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('size', 'desc')}
              >
                Largest
              </Button>
              <Button
                variant={
                  category === 'size' && direction === 'asc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('size', 'asc')}
              >
                Smallest
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          {}
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Views
              </div>
            </div>
            <div className="flex gap-1 mt-2">
              <Button
                variant={
                  category === 'views' && direction === 'desc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('views', 'desc')}
              >
                Most
              </Button>
              <Button
                variant={
                  category === 'views' && direction === 'asc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('views', 'asc')}
              >
                Least
              </Button>
            </div>
          </div>
          <DropdownMenuSeparator />
          {}
          <div className="px-2 py-1.5">
            <div className="flex items-center justify-between text-sm font-medium">
              <div className="flex items-center gap-2">
                <Download className="h-4 w-4" />
                Downloads
              </div>
            </div>
            <div className="flex gap-1 mt-2">
              <Button
                variant={
                  category === 'downloads' && direction === 'desc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('downloads', 'desc')}
              >
                Most
              </Button>
              <Button
                variant={
                  category === 'downloads' && direction === 'asc'
                    ? 'default'
                    : 'outline'
                }
                size="sm"
                className="flex-1 h-7 text-xs"
                onClick={() => handleSortSelect('downloads', 'asc')}
              >
                Least
              </Button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-[120px] flex items-center justify-between bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200"
          >
            <span>Visibility</span>
            {visibility.length > 0 ? (
              <span className="ml-2 rounded-full bg-primary w-5 h-5 flex items-center justify-center text-[10px] font-medium text-primary-foreground">
                {visibility.length}
              </span>
            ) : (
              <Eye className="ml-2 h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Filter by visibility</DropdownMenuLabel>
          <DropdownMenuItem
            onClick={() => {
              const newVisibility = visibility.includes('public')
                ? visibility.filter((v) => v !== 'public')
                : [...visibility, 'public']
              onVisibilityChange(newVisibility)
            }}
            onSelect={(e) => e.preventDefault()}
            className={cn(
              'flex items-center justify-between',
              visibility.includes('public') && 'bg-accent'
            )}
          >
            <div className="flex items-center">
              <Globe className="mr-2 h-4 w-4 opacity-70" />
              Public Files
            </div>
            {visibility.includes('public') && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const newVisibility = visibility.includes('private')
                ? visibility.filter((v) => v !== 'private')
                : [...visibility, 'private']
              onVisibilityChange(newVisibility)
            }}
            onSelect={(e) => e.preventDefault()}
            className={cn(
              'flex items-center justify-between',
              visibility.includes('private') && 'bg-accent'
            )}
          >
            <div className="flex items-center">
              <Lock className="mr-2 h-4 w-4 opacity-70" />
              Private Files
            </div>
            {visibility.includes('private') && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              const newVisibility = visibility.includes('hasPassword')
                ? visibility.filter((v) => v !== 'hasPassword')
                : [...visibility, 'hasPassword']
              onVisibilityChange(newVisibility)
            }}
            onSelect={(e) => e.preventDefault()}
            className={cn(
              'flex items-center justify-between',
              visibility.includes('hasPassword') && 'bg-accent'
            )}
          >
            <div className="flex items-center">
              <Key className="mr-2 h-4 w-4 opacity-70" />
              Password Protected
            </div>
            {visibility.includes('hasPassword') && (
              <Check className="ml-auto h-4 w-4" />
            )}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="min-w-[120px] flex items-center justify-between bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200"
          >
            <span>File Type</span>
            {selectedTypes.length > 0 ? (
              <span className="ml-2 rounded-full bg-primary w-5 h-5 flex items-center justify-center text-[10px] font-medium text-primary-foreground">
                {selectedTypes.length}
              </span>
            ) : (
              <Filter className="ml-2 h-4 w-4" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-64 max-h-[400px] overflow-y-auto"
        >
          <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
          {Object.entries(fileTypesByCategory).map(
            ([categoryName, types], categoryIndex) => (
              <React.Fragment key={categoryName}>
                {categoryIndex > 0 && <DropdownMenuSeparator />}
                <div className="px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {categoryName}
                </div>
                {types.map((type) => {
                  const TypeIcon = getFileTypeIcon(type)
                  return (
                    <DropdownMenuItem
                      key={type}
                      onClick={() => {
                        onTypesChange(
                          selectedTypes.includes(type)
                            ? selectedTypes.filter((t) => t !== type)
                            : [...selectedTypes, type]
                        )
                      }}
                      onSelect={(e) => e.preventDefault()}
                      className={cn(
                        'flex items-center justify-between',
                        selectedTypes.includes(type) && 'bg-accent'
                      )}
                    >
                      <div className="flex items-center">
                        <TypeIcon className="mr-2 h-4 w-4 opacity-70" />
                        {type}
                      </div>
                      {selectedTypes.includes(type) && (
                        <Check className="ml-auto h-4 w-4" />
                      )}
                    </DropdownMenuItem>
                  )
                })}
              </React.Fragment>
            )
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className={cn(
              'min-w-[120px] justify-start text-left font-normal bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200',
              !date && 'text-muted-foreground'
            )}
          >
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date?.from ? (
              date.to ? (
                <>
                  {format(date.from, 'LLL dd')} - {format(date.to, 'LLL dd')}
                </>
              ) : (
                format(date.from, 'LLL dd')
              )
            ) : (
              <span>Date range</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <Calendar
            initialFocus
            mode="range"
            defaultMonth={date?.from}
            selected={date}
            onSelect={onDateChange}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
})
