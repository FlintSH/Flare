'use client'

import { Fragment } from 'react'

import Link from 'next/link'

import {
  CARD_MENU,
  FILE_ACTIONS,
  type FileActionId,
} from '@/components/dashboard/file-card/actions'
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'

import type { FileActionHandler } from './use-file-actions'

/** A file's quick actions as menu items, in the card menu's groups. */
export function FileActionMenuItems({
  offered,
  label,
  groups = CARD_MENU,
}: {
  offered: (id: FileActionId) => FileActionHandler | undefined
  label: (id: FileActionId) => string
  groups?: readonly (readonly FileActionId[])[]
}) {
  const shown = groups
    .map((group) => group.filter((id) => offered(id)))
    .filter((group) => group.length)
  return shown.map((group, index) => (
    <Fragment key={group.join()}>
      {index > 0 && <DropdownMenuSeparator />}
      {group.map((id) => {
        const handler = offered(id)
        if (!handler) return null
        const { icon: Icon } = FILE_ACTIONS[id]
        const content = (
          <>
            <Icon />
            {label(id)}
          </>
        )
        return (
          <DropdownMenuItem
            key={id}
            asChild={!!handler.href}
            disabled={handler.disabled}
            onSelect={handler.run}
            className={
              id === 'delete'
                ? 'text-destructive focus:bg-danger/10 focus:text-destructive'
                : undefined
            }
          >
            {!handler.href ? (
              content
            ) : handler.download ? (
              <a href={handler.href} download={handler.download}>
                {content}
              </a>
            ) : (
              <Link prefetch={false} href={handler.href}>
                {content}
              </Link>
            )}
          </DropdownMenuItem>
        )
      })}
    </Fragment>
  ))
}
