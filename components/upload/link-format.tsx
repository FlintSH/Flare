import { useCallback, useSyncExternalStore } from 'react'

import { ChevronDown } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import {
  LINK_FORMATS,
  LINK_FORMAT_NAMES,
  type LinkFormat,
  isLinkFormat,
} from '@/lib/uploads/link-formats'

const KEY = 'flare:upload-link-format'
const watchers = new Set<() => void>()

function read(): LinkFormat {
  try {
    const saved = window.localStorage.getItem(KEY)
    return isLinkFormat(saved) ? saved : 'link'
  } catch {
    return 'link'
  }
}

/**
 * What Copy gives on the Upload page, remembered in this browser: a
 * convenience, so a private window or blocked storage just starts at Link.
 */
export function useLinkFormat() {
  const format = useSyncExternalStore(
    (watch) => {
      watchers.add(watch)
      return () => {
        watchers.delete(watch)
      }
    },
    read,
    () => 'link' as const
  )
  const choose = useCallback((next: LinkFormat) => {
    try {
      window.localStorage.setItem(KEY, next)
    } catch {
      /* Kept for this page only. */
    }
    for (const watch of watchers) watch()
  }, [])
  return [format, choose] as const
}

const DESCRIPTIONS: Record<LinkFormat, string> = {
  link: 'The share page, with its preview in chats',
  direct: 'The file itself, for embedding',
  markdown: 'Images show, other files link',
}

export function LinkFormatMenu({
  format,
  onChange,
  disabled,
}: {
  format: LinkFormat
  onChange: (format: LinkFormat) => void
  disabled?: boolean
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 px-2 text-muted-foreground data-[state=open]:bg-accent"
          aria-label={`Copy as: ${LINK_FORMAT_NAMES[format]}`}
        >
          {LINK_FORMAT_NAMES[format]}
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          Copy as
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={format}
          onValueChange={(next) => {
            if (isLinkFormat(next)) onChange(next)
          }}
        >
          {LINK_FORMATS.map((choice) => (
            <DropdownMenuRadioItem
              key={choice}
              value={choice}
              className="items-start"
            >
              <span>
                <span className="block">{LINK_FORMAT_NAMES[choice]}</span>
                <span className="block text-xs text-muted-foreground">
                  {DESCRIPTIONS[choice]}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
