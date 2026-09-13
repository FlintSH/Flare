import { memo, useEffect, useRef, useState } from 'react'

import { Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

interface SearchInputProps {
  onSearch: (value: string) => void
  initialValue?: string
}

export const SearchInput = memo(function SearchInput({
  onSearch,
  initialValue = '',
}: SearchInputProps) {
  const [value, setValue] = useState(initialValue)
  const pendingSearch = useRef<ReturnType<typeof setTimeout>>()

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
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search files by name"
        placeholder="Search your files…"
        className="h-10 rounded-lg bg-background/70 pl-10 pr-10 [&::-webkit-search-cancel-button]:appearance-none"
        value={value}
        onChange={(event) => updateSearch(event.target.value)}
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1 h-8 w-8 rounded-lg"
          aria-label="Clear file search"
          onClick={() => updateSearch('', true)}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )
})
