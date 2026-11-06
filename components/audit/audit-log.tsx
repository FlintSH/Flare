'use client'

import { Fragment, useEffect, useState } from 'react'

import {
  Activity,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  Shield,
  XCircle,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'

import type { AuditQuery } from '@/lib/audit/query'
import {
  AUDIT_OUTCOMES,
  type AuditEventView,
  type AuditOutcome,
  type AuditPage,
} from '@/lib/audit/types'
import { hasPermission } from '@/lib/permissions/catalog'
import { cn } from '@/lib/utils'

type Filters = {
  q: string
  category: string
  action: string
  outcome: string
  range: string
  from: string
  to: string
  actorId: string
  targetId: string
  requestId: string
}
const emptyFilters: Filters = {
  q: '',
  category: '',
  action: '',
  outcome: '',
  range: 'all',
  from: '',
  to: '',
  actorId: '',
  targetId: '',
  requestId: '',
}

const OUTCOME_LABELS: Record<AuditOutcome, string> = {
  success: 'Success',
  failure: 'Failure',
  denied: 'Denied',
}

const ACRONYMS = new Set([
  'api',
  'csv',
  'http',
  'id',
  'oidc',
  'ocr',
  'sso',
  'url',
])
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head'])

/** "http.get" -> "HTTP GET", "file_tag.createMany" -> "File tag create many". */
function describeAction(action: string) {
  const words = action
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[._\s]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
  return words
    .map((word, index) => {
      if (
        ACRONYMS.has(word) ||
        (words[index - 1] === 'http' && HTTP_METHODS.has(word))
      )
        return word.toUpperCase()
      return index === 0 ? word[0].toUpperCase() + word.slice(1) : word
    })
    .join(' ')
}

/**
 * Lets request paths and member paths wrap after a slash instead of
 * mid-word ("/api/customization/" then "preferences", never a lone "s").
 * <wbr> adds no characters, so copied text stays the same.
 */
function wrapAfterSlashes(text: string) {
  return text.split('/').map((part, index, parts) => (
    <Fragment key={index}>
      {part}
      {index < parts.length - 1 && '/'}
      {index > 0 && index < parts.length - 1 && <wbr />}
    </Fragment>
  ))
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  const id = `audit-${label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <NativeSelect
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {children}
      </NativeSelect>
    </div>
  )
}

function EventRow({
  event,
  apply,
}: {
  event: AuditEventView
  apply: (field: 'actorId' | 'targetId' | 'requestId', value: string) => void
}) {
  const Icon =
    event.outcome === 'denied'
      ? Shield
      : event.outcome === 'failure'
        ? XCircle
        : CheckCircle2
  return (
    <details className="group border-b last:border-0">
      {/* Phones show each event in four short lines: the action with its
          outcome, then the time, the actor, and the target. The actor and
          target lines run under the outcome too, so paths keep the full
          width. */}
      <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-6 py-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.2fr)_7rem] md:items-center md:gap-3 md:py-4">
        <div className="flex min-w-0 items-start gap-3">
          <div
            className={cn(
              'mt-0.5 rounded-full p-2',
              // The outcome chip already marks success; only exceptions
              // repeat it in colour.
              event.outcome === 'success'
                ? 'bg-muted text-muted-foreground'
                : event.outcome === 'denied'
                  ? 'bg-warning/10 text-warning'
                  : 'bg-danger/10 text-danger'
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <p className="break-words text-sm font-medium">
              {describeAction(event.action)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              <time dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </p>
          </div>
        </div>
        <div className="col-span-2 col-start-1 min-w-0 pl-11 md:col-span-1 md:col-start-auto md:pl-0">
          <p className="break-words text-xs md:text-sm">
            <span className="font-medium">
              {event.actorName ??
                (event.actorId ? 'Deleted account' : 'System')}
            </span>
            <span className="text-muted-foreground md:hidden"> · </span>
            <span className="capitalize text-muted-foreground md:mt-1 md:block md:text-xs">
              {event.category}
            </span>
          </p>
        </div>
        <div className="col-span-2 col-start-1 min-w-0 pl-11 md:col-span-1 md:col-start-auto md:pl-0">
          <p className="break-words text-xs md:text-sm">
            {wrapAfterSlashes(
              event.targetName ??
                event.targetType ??
                event.route ??
                'Instance activity'
            )}
            {event.targetName && (
              <>
                <span className="text-muted-foreground md:hidden"> · </span>
                <span className="capitalize text-muted-foreground md:mt-1 md:block md:text-xs">
                  {event.targetType}
                </span>
              </>
            )}
          </p>
        </div>
        <div className="col-start-2 row-start-1 flex items-center gap-2 md:col-start-auto md:row-start-auto md:justify-between md:gap-3">
          <Badge
            className="capitalize"
            variant={
              event.outcome === 'success'
                ? 'success'
                : event.outcome === 'denied'
                  ? 'warning'
                  : 'danger'
            }
          >
            {event.outcome}
          </Badge>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </div>
      </summary>
      <div className="space-y-4 border-t bg-muted/20 px-6 py-5">
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-muted-foreground">Event</dt>
            <dd className="mt-1 break-all font-mono text-xs">{event.action}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Timestamp (UTC)</dt>
            <dd className="mt-1 text-xs">
              {new Date(event.createdAt).toISOString()}
            </dd>
          </div>
          {event.route && (
            <div>
              <dt className="text-xs text-muted-foreground">Request</dt>
              <dd className="mt-1 break-words font-mono text-xs">
                {event.method} {wrapAfterSlashes(event.route)}
                {event.status ? ` · ${event.status}` : ''}
              </dd>
            </div>
          )}
          {(
            [
              ['actorId', 'Actor ID'],
              ['targetId', 'Target ID'],
              ['requestId', 'Request ID'],
            ] as const
          ).map(
            ([field, label]) =>
              event[field] && (
                <div key={field}>
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd>
                    <button
                      className="mt-1 break-all text-left font-mono text-xs text-primary underline underline-offset-4"
                      onClick={() => apply(field, event[field]!)}
                      title={`Filter by ${label.toLowerCase()}`}
                    >
                      {event[field]}
                    </button>
                  </dd>
                </div>
              )
          )}
        </dl>
        {Object.keys(event.details).length > 0 && (
          <div>
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Recorded details
            </p>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-3 text-xs leading-relaxed">
              {JSON.stringify(event.details, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </details>
  )
}

export function AuditLog() {
  const { data: session, status } = useSession()
  if (
    status !== 'authenticated' ||
    !session?.user?.id ||
    !hasPermission(session.user, 'audit.read')
  )
    return null
  return (
    <AccountAuditLog
      key={JSON.stringify([session.user.id, session.user.sessionId])}
    />
  )
}

function AccountAuditLog() {
  const [draft, setDraft] = useState<Filters>(emptyFilters)
  const [active, setActive] = useState<Filters>(emptyFilters)
  const [page, setPage] = useState(1)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<AuditPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const query = new URLSearchParams({ page: String(page), limit: '50' })
        for (const field of [
          'q',
          'category',
          'action',
          'outcome',
          'actorId',
          'targetId',
          'requestId',
        ] as const satisfies readonly (keyof AuditQuery & keyof Filters)[])
          if (active[field].trim()) query.set(field, active[field].trim())
        if (active.range !== 'all' && active.range !== 'custom')
          query.set(
            'from',
            new Date(Date.now() - Number(active.range) * 86400000).toISOString()
          )
        if (active.range === 'custom') {
          if (active.from)
            query.set('from', new Date(active.from).toISOString())
          if (active.to) query.set('to', new Date(active.to).toISOString())
        }
        const response = await fetch(`/api/audit?${query}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        const body = await response.json()
        if (!response.ok) {
          if (
            !controller.signal.aborted &&
            [401, 403].includes(response.status)
          )
            setResult(null)
          throw new Error(body.error ?? 'Unable to load audit events')
        }
        if (!controller.signal.aborted) setResult(body)
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : 'Unable to load audit events'
          )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [active, page, refresh])

  function update(field: keyof Filters, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }))
  }
  function apply(field: 'actorId' | 'targetId' | 'requestId', value: string) {
    const next = { ...active, [field]: value }
    setDraft(next)
    setActive(next)
    setPage(1)
  }
  const activeCount = Object.entries(active).filter(
    ([key, value]) =>
      value &&
      !['from', 'to'].includes(key) &&
      !(key === 'range' && value === 'all')
  ).length

  return (
    <div className="container space-y-7">
      <PageHeader
        eyebrow="Your instance"
        title="Audit log"
        description={
          <>
            Trace file activity, sign-ins, account changes, and background
            processing across your instance.
            {/* Balanced: the header's pretty wrapping (inherited) still
                left a three-word last line. */}
            <span className="mt-2 block text-balance text-xs leading-relaxed">
              Includes private filenames and historical account names. Events
              are retained after account or file deletion. History begins when
              audit logging was installed.
            </span>
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={() => setRefresh((value) => value + 1)}
            disabled={loading}
          >
            <RefreshCw
              className={cn('h-4 w-4', loading && 'animate-spin')}
              aria-hidden="true"
            />
            Refresh
          </Button>
        }
      />

      <form
        className={cn(pagePanelClassName, 'space-y-4')}
        onSubmit={(event) => {
          event.preventDefault()
          setActive({ ...draft })
          setPage(1)
        }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Filter activity</h2>
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="audit-search">Search activity</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="audit-search"
                className="pl-9"
                placeholder="File, person, action, or ID…"
                value={draft.q}
                maxLength={200}
                onChange={(event) => update('q', event.target.value)}
              />
            </div>
          </div>
          <FilterSelect
            label="Category"
            value={draft.category}
            onChange={(value) => update('category', value)}
          >
            <option value="">All categories</option>
            {result?.filters.categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Outcome"
            value={draft.outcome}
            onChange={(value) => update('outcome', value)}
          >
            <option value="">All outcomes</option>
            {AUDIT_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome]}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Action"
            value={draft.action}
            onChange={(value) => update('action', value)}
          >
            <option value="">All actions</option>
            {result?.filters.actions.map((value) => (
              <option key={value} value={value}>
                {describeAction(value)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Time range"
            value={draft.range}
            onChange={(value) => update('range', value)}
          >
            <option value="all">All time</option>
            <option value="1">Last 24 hours</option>
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="custom">Custom range</option>
          </FilterSelect>
          {draft.range === 'custom' &&
            (['from', 'to'] as const).map((field) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={`audit-${field}`}>
                  {field === 'from' ? 'From' : 'To'} (local time)
                </Label>
                <Input
                  id={`audit-${field}`}
                  type="datetime-local"
                  value={draft[field]}
                  onChange={(event) => update(field, event.target.value)}
                />
              </div>
            ))}
        </div>
        <details
          open={
            Boolean(draft.actorId || draft.targetId || draft.requestId) ||
            undefined
          }
        >
          <summary className="w-fit cursor-pointer rounded-sm text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
            Filter by actor, target, or request ID
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {(
              [
                ['actorId', 'Actor ID'],
                ['targetId', 'Target ID'],
                ['requestId', 'Request ID'],
              ] as const
            ).map(([field, label]) => (
              <div className="space-y-2" key={field}>
                <Label htmlFor={`filter-${field}`}>{label}</Label>
                <Input
                  id={`filter-${field}`}
                  value={draft[field]}
                  maxLength={200}
                  onChange={(event) => update(field, event.target.value)}
                  placeholder="Exact ID"
                />
              </div>
            ))}
          </div>
        </details>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={loading}>
            Apply filters
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(emptyFilters)
              setActive(emptyFilters)
              setPage(1)
            }}
          >
            Clear filters
          </Button>
        </div>
      </form>

      {error && (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Try again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <section
        className="overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-sm backdrop-blur-xl"
        aria-label="Audit events"
        aria-busy={loading}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-6 py-4">
          <h2 className="text-base font-semibold">Activity</h2>
          <p className="text-xs text-muted-foreground" role="status">
            {loading
              ? 'Loading activity…'
              : error
                ? 'Activity unavailable'
                : `${(result?.total ?? 0).toLocaleString()} matching events · newest first`}
          </p>
        </div>
        {!error &&
          result?.events.map((event) => (
            <EventRow key={event.id} event={event} apply={apply} />
          ))}
        {!loading && !error && result?.events.length === 0 && (
          <div className="px-5 py-14 text-center">
            <Activity
              className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="font-medium">No activity matches these filters</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Try a wider time range or clear the filters.
            </p>
          </div>
        )}
        {!error && result && result.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
            <p className="text-xs text-muted-foreground">
              Page {result.page} of {result.pages} · up to {result.limit} events
              per page
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={loading || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={loading || page >= result.pages || page >= 100000}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
