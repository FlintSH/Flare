'use client'

import { Icons } from '@/components/shared/icons'

import { cn } from '@/lib/utils'

import { useAppearance } from './appearance-provider'

export function InstanceBrand({
  className,
  iconClassName = 'h-6 w-6',
  textClassName = 'text-lg font-medium',
  showTagline = false,
}: {
  className?: string
  iconClassName?: string
  textClassName?: string
  showTagline?: boolean
}) {
  const { brand } = useAppearance()
  const light = brand.logoLight || brand.logoDark
  const dark = brand.logoDark || brand.logoLight
  return (
    <span
      className={cn('inline-flex items-center gap-2.5 min-w-0', className)}
      data-flare-brand
    >
      {light ? (
        <>
          <img
            src={light}
            alt=""
            className={cn('object-contain shrink-0 dark:hidden', iconClassName)}
          />
          <img
            src={dark}
            alt=""
            className={cn(
              'object-contain shrink-0 hidden dark:block',
              iconClassName
            )}
          />
        </>
      ) : (
        <Icons.logo className={cn('shrink-0', iconClassName)} />
      )}
      <span className="min-w-0">
        <span className={cn('flare-text block truncate', textClassName)}>
          {brand.name}
        </span>
        {showTagline && brand.tagline && (
          <span className="block text-sm font-normal text-muted-foreground mt-1">
            {brand.tagline}
          </span>
        )}
      </span>
    </span>
  )
}
