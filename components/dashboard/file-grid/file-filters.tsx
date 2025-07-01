import React, { memo } from 'react'

import { SortOption } from '@/types/components/file'
import { format } from 'date-fns'
import {
  ArrowUpDown,
  Calendar as CalendarIcon,
  Eye,
  Filter,
} from 'lucide-react'
import { DateRange } from 'react-day-picker'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
  return (
    <div className="flex gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="w-[120px] bg-background/60 backdrop-blur-sm border-border/50 hover:bg-background/80 transition-all duration-200"
          >
            {sortBy === 'newest'
              ? 'Newest'
              : sortBy === 'oldest'
                ? 'Oldest'
                : sortBy === 'largest'
                  ? 'Largest'
                  : 'Smallest'}
            <ArrowUpDown className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Sort by</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => onSortChange('newest')}>
            Newest first
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortChange('oldest')}>
            Oldest first
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortChange('largest')}>
            Largest first
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onSortChange('smallest')}>
            Smallest first
          </DropdownMenuItem>
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
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Filter by visibility</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={visibility.includes('public')}
            onCheckedChange={() => {
              const newVisibility = visibility.includes('public')
                ? visibility.filter((v) => v !== 'public')
                : [...visibility, 'public']
              onVisibilityChange(newVisibility)
            }}
          >
            Public Files
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibility.includes('private')}
            onCheckedChange={() => {
              const newVisibility = visibility.includes('private')
                ? visibility.filter((v) => v !== 'private')
                : [...visibility, 'private']
              onVisibilityChange(newVisibility)
            }}
          >
            Private Files
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={visibility.includes('hasPassword')}
            onCheckedChange={() => {
              const newVisibility = visibility.includes('hasPassword')
                ? visibility.filter((v) => v !== 'hasPassword')
                : [...visibility, 'hasPassword']
              onVisibilityChange(newVisibility)
            }}
          >
            Password Protected
          </DropdownMenuCheckboxItem>
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
          className="max-h-[300px] overflow-y-auto"
        >
          <DropdownMenuLabel>Filter by type</DropdownMenuLabel>
          {fileTypes.map((type) => (
            <DropdownMenuCheckboxItem
              key={type}
              checked={selectedTypes.includes(type)}
              onCheckedChange={(checked) => {
                onTypesChange(
                  checked
                    ? [...selectedTypes, type]
                    : selectedTypes.filter((t) => t !== type)
                )
              }}
            >
              {type}
            </DropdownMenuCheckboxItem>
          ))}
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
