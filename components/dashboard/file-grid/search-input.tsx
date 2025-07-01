import React, { memo, useEffect, useState } from 'react'

import { Search } from 'lucide-react'

import { Input } from '@/components/ui/input'

import { useDebounce } from '@/hooks/use-debounce'

interface SearchInputProps {
  onSearch: (value: string) => void
  initialValue?: string
}

export const SearchInput = memo(function SearchInput({
  onSearch,
  initialValue = '',
}: SearchInputProps) {
  const [value, setValue] = useState(initialValue)
  const debouncedSearch = useDebounce(value, 300)

  useEffect(() => {
    setValue(initialValue)
  }, [initialValue])

  useEffect(() => {
    onSearch(debouncedSearch)
  }, [debouncedSearch, onSearch])

  return (
    <div className="relative flex-1">
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground z-10" />
      <Input
        placeholder="Search files..."
        className="pl-9 bg-background/60 backdrop-blur-sm border-border/50 focus:bg-background/80 transition-all duration-200"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
    </div>
  )
})
