import type { RoleSummary } from '@/lib/permissions/catalog'

export function RoleBadges({
  roles,
}: {
  roles: Pick<RoleSummary, 'id' | 'name' | 'color'>[]
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {roles.length ? (
        roles.map((role) => (
          <span
            key={role.id}
            className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/30 px-2 py-0.5 text-xs font-medium"
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: role.color }}
              aria-hidden="true"
            />
            <span className="truncate">{role.name}</span>
          </span>
        ))
      ) : (
        <span className="text-xs text-muted-foreground">Everyone</span>
      )}
    </span>
  )
}
