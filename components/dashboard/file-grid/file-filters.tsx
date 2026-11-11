import { Fragment, type ReactNode, memo, useId, useState } from 'react'

import { format } from 'date-fns'
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  Eye,
  Filter,
  Globe,
  KeyRound,
  Lock,
  SlidersHorizontal,
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
import { Input } from '@/components/ui/input'
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

import { fileTypeGroup, fileTypeLabel } from '@/lib/files/file-kind'
import {
  type FileGrouping,
  GROUP_OPTIONS,
  SORT_OPTIONS,
  type SortOption,
  VISIBILITY_FILTERS,
  type VisibilityFilter,
} from '@/lib/library/contract'
import { cn } from '@/lib/utils'
import { scrollFadeRef } from '@/lib/utils/scroll-fade'

import { useHydrated } from '@/hooks/use-hydrated'

interface FileFiltersProps {
  tagFilter?: ReactNode
  hasTagFilter?: boolean
  sortBy: SortOption
  onSortChange: (value: SortOption) => void
  selectedTypes: string[]
  onTypesChange: (types: string[]) => void
  fileTypes: string[]
  date: DateRange | undefined
  onDateChange: (range: DateRange | undefined) => void
  groupBy: FileGrouping
  onGroupChange: (groupBy: FileGrouping) => void
  visibility: VisibilityFilter[]
  onVisibilityChange: (visibility: VisibilityFilter[]) => void
}

// The toolbar's lists share one pattern: the check sits in a column on the
// left, as in the Visibility, File type and Tags lists. SelectItem draws its
// check on the right, so move it (its first child) into that column.
const sortItemClassName =
  'pl-8 pr-2 [&>span:first-child]:left-2 [&>span:first-child]:right-auto'

const visibilityIcons = {
  public: Globe,
  private: Lock,
  hasPassword: KeyRound,
} satisfies Record<VisibilityFilter, unknown>

export const FileFilters = memo(function FileFilters({
  tagFilter,
  hasTagFilter = false,
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
  // The chosen days are named in the reader's time zone, which the server lacks.
  const hydrated = useHydrated()
  const [expanded, setExpanded] = useState(false)
  const controlsId = useId()
  const [typeSearch, setTypeSearch] = useState('')
  const typeQuery = typeSearch.trim().toLowerCase()
  const activeCount =
    Number(hasTagFilter) +
    selectedTypes.length +
    visibility.length +
    Number(Boolean(date?.from || date?.to)) +
    Number(groupBy !== 'none')
  const fileTypesByCategory = [...new Set([...fileTypes, ...selectedTypes])]
    .sort()
    .filter(
      (type) =>
        type.toLowerCase().includes(typeQuery) ||
        fileTypeLabel(type).toLowerCase().includes(typeQuery)
    )
    .reduce(
      (groups, type) => {
        ;(groups[fileTypeGroup(type)] ||= []).push(type)
        return groups
      },
      {} as Record<string, string[]>
    )
  const typeCategories = [
    'Images',
    'Videos',
    'Audio',
    'Documents',
    'Other files',
  ].filter((category) => fileTypesByCategory[category]?.length)
  // Every trigger shows the same fill while its menu is open.
  const filterClass =
    'relative h-10 min-w-0 justify-start gap-2 rounded-lg bg-background/70 px-3 data-[state=open]:bg-accent sm:w-auto sm:justify-between'

  return (
    <div className="flex flex-wrap gap-2">
      <Select value={sortBy} onValueChange={onSortChange}>
        {/* On narrow phones a long choice ends in an ellipsis instead of
            being cut off mid-letter. */}
        <SelectTrigger
          aria-label="Sort files"
          className="h-10 min-w-0 flex-1 gap-1 rounded-lg bg-background/70 px-2 text-sm font-medium data-[state=open]:bg-accent sm:w-[172px] sm:flex-none sm:px-3 [&>span]:block [&>span]:truncate"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className={sortItemClassName}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        variant="outline"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={() => setExpanded((value) => !value)}
        className="h-10 gap-2 rounded-lg bg-background/70 px-3 sm:hidden"
      >
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        Filters
        {activeCount > 0 && (
          <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs tabular-nums text-primary-foreground">
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 transition-transform motion-reduce:transition-none',
            expanded && 'rotate-180'
          )}
        />
      </Button>
      <div
        id={controlsId}
        className={cn(
          'w-full grid-cols-2 gap-2 sm:contents',
          expanded ? 'grid' : 'hidden'
        )}
      >
        {tagFilter}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              aria-label="Visibility"
              className={cn(
                filterClass,
                visibility.length > 0 &&
                  'border-primary bg-primary/10 [&_svg]:text-foreground'
              )}
            >
              <Eye className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">Visibility</span>
              {visibility.length > 0 && (
                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums leading-none text-primary-foreground">
                  {visibility.length}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Who can access</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {VISIBILITY_FILTERS.map(({ value, label }) => {
              const Icon = visibilityIcons[value]
              return (
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
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        <Popover
          onOpenChange={(open) => {
            if (!open) setTypeSearch('')
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              aria-label="File type"
              className={cn(
                filterClass,
                selectedTypes.length > 0 &&
                  'border-primary bg-primary/10 [&_svg]:text-foreground'
              )}
            >
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">File type</span>
              {selectedTypes.length > 0 && (
                <span className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] font-semibold tabular-nums leading-none text-primary-foreground">
                  {selectedTypes.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64 p-1">
            <div className="px-2 py-1.5 text-sm font-semibold">
              Filter by file type
            </div>
            <Input
              aria-label="Find a file type"
              placeholder="Find a file type…"
              value={typeSearch}
              onChange={(event) => setTypeSearch(event.target.value)}
              className="mb-2 h-9"
            />
            <div
              ref={scrollFadeRef}
              role="group"
              aria-label="Filter files by type"
              className="scroll-fade max-h-72 overflow-y-auto overscroll-contain outline-none"
            >
              {typeCategories.map((category) => (
                <Fragment key={category}>
                  <div className="-mx-1 my-1 h-px bg-muted" />
                  <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                    {category}
                  </div>
                  {fileTypesByCategory[category].map((type) => (
                    <button
                      data-flare-control
                      type="button"
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      key={type}
                      title={type}
                      aria-pressed={selectedTypes.includes(type)}
                      onClick={() =>
                        onTypesChange(
                          !selectedTypes.includes(type)
                            ? [...selectedTypes, type]
                            : selectedTypes.filter((item) => item !== type)
                        )
                      }
                    >
                      <Check
                        className={cn(
                          'h-4 w-4 shrink-0',
                          !selectedTypes.includes(type) && 'invisible'
                        )}
                      />
                      <span className="truncate">{fileTypeLabel(type)}</span>
                    </button>
                  ))}
                </Fragment>
              ))}
              {Object.keys(fileTypesByCategory).length === 0 && (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  {typeQuery
                    ? 'No matching file types.'
                    : 'File types appear after your first upload.'}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              aria-label="Upload date"
              className={cn(
                filterClass,
                (date?.from || groupBy !== 'none') &&
                  'border-primary bg-primary/10 [&_svg]:text-foreground'
              )}
            >
              <CalendarIcon className="h-4 w-4 text-muted-foreground" />
              <span className="truncate">
                {date?.from && hydrated
                  ? `${format(date.from, 'MMM d')}${date.to ? ` – ${format(date.to, 'MMM d')}` : ''}`
                  : 'Upload date'}
              </span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="flex max-h-[var(--radix-popover-content-available-height)] w-auto flex-col overflow-hidden p-0"
            align="end"
          >
            <Calendar
              className="min-h-0 overflow-y-auto"
              initialFocus
              mode="range"
              defaultMonth={date?.from}
              selected={date}
              onSelect={onDateChange}
              numberOfMonths={1}
            />
            <div className="flex shrink-0 items-center justify-between gap-3 border-t px-3 py-3">
              <span className="text-sm text-muted-foreground">Group files</span>
              <Select value={groupBy} onValueChange={onGroupChange}>
                <SelectTrigger
                  aria-label="Group files by upload date"
                  className="h-9 w-36 text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {date?.from && (
              <div className="shrink-0 border-t p-2">
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
    </div>
  )
})
