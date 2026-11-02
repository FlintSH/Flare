import { Badge } from '@/components/ui/badge'

import type { RoleSummary } from '@/lib/permissions/catalog'

type RoleChip = Pick<RoleSummary, 'id' | 'name' | 'color'>

function RoleDot({ color }: { color: string }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  )
}

export function RoleBadges({ roles }: { roles: RoleChip[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {roles.length ? (
        roles.map((role) => (
          <Badge
            key={role.id}
            variant="outline"
            className="gap-1.5 bg-muted/30 text-foreground"
          >
            <RoleDot color={role.color} />
            <span className="truncate">{role.name}</span>
          </Badge>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">Everyone</span>
      )}
    </span>
  )
}

/**
 * The checkbox list used wherever extra roles are chosen (account dialogs and
 * invites), so both pickers look and behave the same.
 */
export function RoleChecklist<Role extends RoleChip>({
  roles,
  selected,
  onChange,
  isDisabled,
}: {
  roles: Role[]
  selected: readonly string[]
  onChange: (roleIds: string[]) => void
  isDisabled?: (role: Role) => boolean
}) {
  if (!roles.length) return null
  return (
    <div className="max-h-48 divide-y overflow-y-auto rounded-xl border">
      {roles.map((role) => (
        <label
          key={role.id}
          className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-muted/40 has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted-foreground has-[:disabled]:hover:bg-transparent"
        >
          <input
            type="checkbox"
            checked={selected.includes(role.id)}
            disabled={isDisabled?.(role)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...selected, role.id]
                  : selected.filter((id) => id !== role.id)
              )
            }
          />
          <RoleDot color={role.color} />
          <span className="min-w-0 truncate">{role.name}</span>
        </label>
      ))}
    </div>
  )
}
