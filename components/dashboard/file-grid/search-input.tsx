import { memo, useEffect, useRef, useState } from 'react'

import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { cn } from '@/lib/utils'

interface SearchInputProps {
  onSearch: (value: string) => void
  initialValue?: string
}

export const SearchInput = memo(function SearchInput({
  onSearch,
  initialValue = '',
}: SearchInputProps) {
  const [value, setValue] = useState(initialValue)
  const pendingSearch = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setValue(initialValue)
    clearTimeout(pendingSearch.current)
  }, [initialValue])

  useEffect(() => () => clearTimeout(pendingSearch.current), [])

  const updateSearch = (nextValue: string, immediate = false) => {
    setValue(nextValue)
    clearTimeout(pendingSearch.current)
    if (immediate) {
      onSearch(nextValue)
    } else {
      pendingSearch.current = setTimeout(() => onSearch(nextValue), 300)
    }
  }

  return (
    <div className="relative min-w-[min(100%,128px)] sm:min-w-[min(100%,8rem)] flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 h-[16px] w-[16px] sm:left-3.5 sm:h-4 sm:w-4 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search files by name"
        placeholder="Search files…"
        className={cn(
          'h-10 rounded-lg bg-background/70 py-[8px] pl-[36px] sm:py-2 sm:pl-10 [&::-webkit-search-cancel-button]:appearance-none',
          value ? 'pr-[48px] sm:pr-12' : 'pr-[12px] sm:pr-3'
        )}
        value={value}
        onChange={(event) => updateSearch(event.target.value)}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-0 top-0 h-full w-[44px] rounded-lg sm:w-10"
          aria-label="Clear file search"
          onClick={() => updateSearch('', true)}
        >
          <X className="h-[16px] w-[16px] sm:h-4 sm:w-4" />
        </Button>
      )}
    </div>
  )
})
