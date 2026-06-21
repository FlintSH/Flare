'use client'

import type { ViewMode } from '@/types/components/file'
import { FolderTree, LayoutGrid, List } from 'lucide-react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

import { cn } from '@/lib/utils'

interface ViewSwitcherProps {
  value: ViewMode
  onChange: (mode: ViewMode) => void
  allowFolder?: boolean
}

const OPTIONS: { mode: ViewMode; icon: React.ElementType; label: string }[] = [
  { mode: 'grid', icon: LayoutGrid, label: 'Grid' },
  { mode: 'list', icon: List, label: 'List' },
  { mode: 'folder', icon: FolderTree, label: 'Folders' },
]

export function ViewSwitcher({
  value,
  onChange,
  allowFolder = true,
}: ViewSwitcherProps) {
  const options = allowFolder
    ? OPTIONS
    : OPTIONS.filter((o) => o.mode !== 'folder')
  return (
    <TooltipProvider delayDuration={150}>
      <div className="inline-flex items-center rounded-lg border border-border/50 bg-background/60 backdrop-blur-sm p-0.5">
        {options.map(({ mode, icon: Icon, label }) => (
          <Tooltip key={mode}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(mode)}
                aria-label={`${label} view`}
                aria-pressed={value === mode}
                className={cn(
                  'flex h-8 w-9 items-center justify-center rounded-md transition-all duration-200',
                  value === mode
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  )
}
