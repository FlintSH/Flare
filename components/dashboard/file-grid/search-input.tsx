import { memo, useEffect, useRef, useState } from 'react'

import { HelpCircle, Search, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

import { MAX_SEARCH_LENGTH } from '@/lib/search/text'

interface SearchInputProps {
  onSearch: (value: string) => void
  initialValue?: string
}

const TIPS = [
  ['invoice lisbon', 'Every word, in names, tags, folders or contents'],
  ['"total due"', 'Words together, in this order'],
  ['-draft', 'Leave out files that match'],
  ['name:report', 'Only in filenames'],
  ['text:wifi', 'Only in text Flare read from the file'],
  ['tag:receipts', 'Only in tag names'],
  ['in:taxes', 'Only in folder names, including parent folders'],
  ['type:pdf', 'An extension, or image, video or audio'],
] as const

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
    <div className="relative min-w-0 flex-1">
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-muted-foreground"
      />
      <Input
        type="search"
        aria-label="Search files"
        placeholder="Search names, text in files, tags and folders…"
        maxLength={MAX_SEARCH_LENGTH}
        className="h-10 rounded-lg bg-background/70 pl-10 pr-[4.5rem] [&::-webkit-search-cancel-button]:appearance-none"
        value={value}
        onChange={(event) => updateSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') updateSearch(value, true)
        }}
      />
      <div className="absolute right-1 top-1 flex">
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg"
            aria-label="Clear file search"
            onClick={() => updateSearch('', true)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground data-[state=open]:bg-accent"
              aria-label="Search tips"
            >
              <HelpCircle className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-[min(22rem,calc(100vw-2rem))] p-3"
          >
            <p className="text-sm font-medium">Search tips</p>
            <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">
              Flare reads text in images, PDFs, documents, text files and
              archive contents on this server. Accents, letter case and filename
              separators don’t matter.
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              {TIPS.map(([example, meaning]) => (
                <div key={example} className="contents">
                  <dt>
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                      {example}
                    </code>
                  </dt>
                  <dd className="text-muted-foreground">{meaning}</dd>
                </div>
              ))}
            </dl>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  )
})
