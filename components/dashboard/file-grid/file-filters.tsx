import { Fragment, type ReactNode, memo, useId, useState } from 'react'

import { format } from 'date-fns'
import {
  Calendar as CalendarIcon,
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
  dateControl?: ReactNode
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
  dateControl,
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
  const activeCount =
    Number(hasTagFilter) +
    selectedTypes.length +
    visibility.length +
    Number(Boolean(date?.from || date?.to)) +
    Number(groupBy !== 'none')
  const fileTypesByCategory = [...new Set([...fileTypes, ...selectedTypes])]
    .sort()
    .reduce(
      (groups, type) => {
        ;(groups[fileTypeGroup(type)] ||= []).push(type)
        return groups
      },
      {} as Record<string, string[]>
    )
  // Every trigger shows the same fill while its menu is open.
  const filterClass =
    'relative h-10 min-w-0 justify-start gap-2 rounded-lg bg-background/70 px-3 data-[state=open]:bg-accent sm:w-auto sm:justify-between'

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={() => setExpanded((value) => !value)}
        className="h-10 gap-2 rounded-lg bg-background/70 px-3 sm:hidden"
      >
        <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
        Sort & filters
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
      {dateControl}
      <div
        id={controlsId}
        className={cn(
          'w-full grid-cols-2 gap-2 sm:contents',
          expanded ? 'grid' : 'hidden'
        )}
      >
        <Select value={sortBy} onValueChange={onSortChange}>
          {/* On narrow phones a long choice ends in an ellipsis instead of
            being cut off mid-letter. */}
          <SelectTrigger
            aria-label="Sort files"
            className="h-10 min-w-0 col-span-2 w-full gap-1 rounded-lg bg-background/70 px-2 text-sm font-medium data-[state=open]:bg-accent sm:w-[172px] sm:flex-none sm:px-3 [&>span]:block [&>span]:truncate"
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
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
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>Filter by file type</DropdownMenuLabel>
            {/* Only the list scrolls, so its fade never reaches the menu's
              border and the heading stays in view. */}
            {/* Not a tab stop of its own: the menu's arrow keys move through
              the items, and the fade mask would hide its focus ring. A click
              on a heading focuses the list itself, where those keys don't
              work, so focus goes back to the menu. */}
            <div
              ref={scrollFadeRef}
              tabIndex={-1}
              onFocus={(event) => {
                if (event.target === event.currentTarget)
                  event.currentTarget
                    .closest<HTMLElement>('[role="menu"]')
                    ?.focus()
              }}
              className="scroll-fade max-h-72 overflow-y-auto overscroll-contain outline-none"
            >
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
                      <span className="truncate">{fileTypeLabel(type)}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </Fragment>
              ))}
              {Object.keys(fileTypesByCategory).length === 0 && (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  File types appear after your first upload.
                </p>
              )}
            </div>
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
