'use client'

import { type ReactNode, useState } from 'react'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

import { type UseQueryResult, useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Copy,
  ExternalLink,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  Folder,
  Inbox,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { useSession } from 'next-auth/react'

import { PageHeader, pagePanelClassName } from '@/components/layout/page-header'
import { MetaLine } from '@/components/profile/meta-line'
import { destructiveActionClassName } from '@/components/settings/form-styles'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  type FileRequestPolicyView,
  type FileRequestSubmissionView,
  type FileRequestView,
  formatRequestBytes,
} from '@/lib/file-requests/policy'
import { cn } from '@/lib/utils'

import { useToast } from '@/hooks/use-toast'

import { RequestFormDialog } from './request-form-dialog'
import {
  RequestStatus,
  absolute,
  destinationText,
  jsonBody,
  lifetimeText,
  receivedText,
  relative,
  requestJson,
  requestLink,
} from './shared'

type Pagination = {
  total: number
  pageCount: number
  page: number
  limit: number
}
type ListResponse = {
  requests: FileRequestView[]
  pagination: Pagination
  policy: FileRequestPolicyView
}
type DetailResponse = {
  request: FileRequestView
  submissions: (FileRequestSubmissionView & { remainingFiles: number })[]
  pagination: Pagination
}
type StatusFilter = 'all' | 'open' | 'ended'
type Confirm = { kind: 'delete' | 'replace'; request: FileRequestView }

/** Remounts per account and browser session so another account's requests never flash. */
export function FileRequestsWorkspace() {
  const { data: session, status } = useSession()
  if (status !== 'authenticated' || !session?.user?.id) return null
  return (
    <Workspace
      key={JSON.stringify([session.user.id, session.user.sessionId])}
      userId={session.user.id}
      sessionId={session.user.sessionId}
    />
  )
}

function Workspace({
  userId,
  sessionId,
}: {
  userId: string
  sessionId?: string
}) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const selectedId = searchParams.get('id')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const [detailPage, setDetailPage] = useState(1)
  const [form, setForm] = useState<{ editing: FileRequestView | null } | null>(
    null
  )
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [busy, setBusy] = useState(false)

  const list = useQuery({
    queryKey: ['file-requests', userId, sessionId, status, page],
    queryFn: ({ signal }) =>
      requestJson<ListResponse>(
        `/api/file-requests?status=${status}&page=${page}&limit=20`,
        { signal }
      ),
    staleTime: 0,
    gcTime: 0,
    placeholderData: (previous) => previous,
    refetchOnWindowFocus: true,
  })
  const detail = useQuery({
    queryKey: ['file-request', userId, sessionId, selectedId, detailPage],
    queryFn: ({ signal }) =>
      requestJson<DetailResponse>(
        `/api/file-requests/${encodeURIComponent(selectedId!)}?page=${detailPage}`,
        { signal }
      ),
    enabled: Boolean(selectedId),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  })
  const policy = list.data?.policy
  const atLimit = Boolean(policy && policy.openCount >= policy.maxOpen)

  const refresh = async () => {
    await Promise.all([
      list.refetch(),
      selectedId ? detail.refetch() : Promise.resolve(),
    ])
  }

  const open = (id: string | null) => {
    setDetailPage(1)
    router.push(
      id
        ? `/dashboard/requests?id=${encodeURIComponent(id)}`
        : '/dashboard/requests',
      { scroll: true }
    )
  }

  async function copy(request: FileRequestView) {
    try {
      await navigator.clipboard.writeText(requestLink(request))
      toast({ title: 'Request link copied' })
    } catch {
      toast({
        title: 'Could not copy the link',
        description: 'Your browser blocked clipboard access.',
        variant: 'destructive',
      })
    }
  }

  async function update(
    request: FileRequestView,
    body: Record<string, unknown>,
    done: string
  ) {
    setBusy(true)
    try {
      await requestJson(
        `/api/file-requests/${encodeURIComponent(request.id)}`,
        jsonBody('PATCH', body)
      )
      toast({ title: done })
      await refresh()
      return true
    } catch (error) {
      toast({
        title: 'Could not update the request',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
      return false
    } finally {
      setBusy(false)
    }
  }

  async function confirmAction() {
    if (!confirm || busy) return
    const { kind, request } = confirm
    if (kind === 'replace') {
      if (await update(request, { replaceLink: true }, 'New link ready'))
        setConfirm(null)
      return
    }
    setBusy(true)
    try {
      await requestJson(
        `/api/file-requests/${encodeURIComponent(request.id)}`,
        { method: 'DELETE' }
      )
      setConfirm(null)
      toast({
        title: 'Request deleted',
        description:
          'The link no longer works. Received files stay in your library.',
      })
      if (selectedId === request.id) open(null)
      await list.refetch()
    } catch (error) {
      toast({
        title: 'Could not delete the request',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  const menu = (request: FileRequestView) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          className="h-9 w-9 shrink-0 data-[state=open]:bg-accent"
          aria-label={`Manage ${request.title}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Manage request</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setForm({ editing: request })}>
          <Pencil />
          Edit request
        </DropdownMenuItem>
        {request.closedAt ? (
          <DropdownMenuItem
            onSelect={() =>
              void update(request, { closed: false }, 'Request reopened')
            }
          >
            <LockOpen />
            Reopen request
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() =>
              void update(request, { closed: true }, 'Request closed')
            }
          >
            <Lock />
            Close request
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onSelect={() => setConfirm({ kind: 'replace', request })}
        >
          <RefreshCw />
          Replace link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:bg-danger/10 focus:text-destructive"
          onSelect={() => setConfirm({ kind: 'delete', request })}
        >
          <Trash2 />
          Delete request
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const newButton = policy?.canCreate && (
    <Button onClick={() => setForm({ editing: null })} disabled={atLimit}>
      <Plus aria-hidden="true" />
      New request
    </Button>
  )

  return (
    <>
      {selectedId ? (
        <RequestDetail
          query={detail}
          onBack={() => open(null)}
          onCopy={copy}
          menu={menu}
          onPage={setDetailPage}
        />
      ) : (
        <>
          <PageHeader
            eyebrow="Your files"
            title="File requests"
            description="Send someone a link and the files they choose land in your library, privately. They don’t need an account."
            actions={newButton}
          />
          <div className={cn(pagePanelClassName, 'space-y-5')}>
            {atLimit && policy && (
              <Alert variant="warning" role="status">
                <TriangleAlert aria-hidden="true" />
                <AlertDescription>
                  You have {policy.openCount} open requests, the most you can
                  have at once. Close one to create another.
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="w-full space-y-2 sm:w-44">
                <Label htmlFor="request-status">Show</Label>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    setStatus(value as StatusFilter)
                    setPage(1)
                  }}
                >
                  <SelectTrigger id="request-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All requests</SelectItem>
                    <SelectItem value="open">Open requests</SelectItem>
                    <SelectItem value="ended">Ended requests</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                variant="outline"
                onClick={() => void list.refetch()}
                disabled={list.isFetching}
                aria-label="Refresh requests"
              >
                <RefreshCw
                  className={cn(list.isFetching && 'animate-spin')}
                  aria-hidden="true"
                />
                Refresh
              </Button>
            </div>
            {list.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading requests…
              </p>
            )}
            {list.isError && (
              <Alert variant="destructive">
                <AlertCircle aria-hidden="true" />
                <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
                  <span>{list.error.message}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void list.refetch()}
                  >
                    Try again
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {list.isSuccess && list.data.requests.length === 0 && (
              <div className="rounded-xl border border-dashed px-6 py-12 text-center">
                <Inbox
                  className="mx-auto mb-3 h-8 w-8 text-muted-foreground"
                  aria-hidden="true"
                />
                <p className="font-medium">
                  {status === 'ended'
                    ? 'No ended requests'
                    : status === 'open'
                      ? 'No open requests'
                      : 'No file requests yet'}
                </p>
                <p className="mx-auto mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
                  {status === 'ended'
                    ? 'Closed, expired, and full requests appear here.'
                    : 'Create a link, send it to anyone, and collect their files here. Large files are fine.'}
                </p>
                {status !== 'ended' && newButton && (
                  <div className="mt-5 flex justify-center">{newButton}</div>
                )}
              </div>
            )}
            {list.data && list.data.requests.length > 0 && (
              <ul className="space-y-3" aria-label="File requests">
                {list.data.requests.map((request) => (
                  <li
                    key={request.id}
                    className="flex flex-col gap-4 rounded-xl border bg-muted/30 p-4 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <Link
                          href={`/dashboard/requests?id=${encodeURIComponent(request.id)}`}
                          onClick={() => setDetailPage(1)}
                          className="min-w-0 truncate rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {request.title}
                        </Link>
                        <RequestStatus status={request.status} />
                        {request.unseen && (
                          <Badge variant="info">New files</Badge>
                        )}
                      </div>
                      <MetaLine
                        className="text-xs text-muted-foreground"
                        items={[
                          {
                            key: 'received',
                            text: receivedText(request),
                          },
                          ...(request.lastReceivedAt
                            ? [
                                {
                                  key: 'last',
                                  text: `Last file ${relative(request.lastReceivedAt)}`,
                                  title: absolute(request.lastReceivedAt),
                                },
                              ]
                            : []),
                          {
                            key: 'lifetime',
                            text: lifetimeText(request),
                            title: request.expiresAt
                              ? absolute(request.expiresAt)
                              : undefined,
                          },
                        ]}
                      />
                      <p className="truncate text-xs text-muted-foreground">
                        {destinationText(request)}
                      </p>
                      {request.pausedReason && (
                        <p className="text-pretty text-xs text-warning">
                          Paused: {request.pausedReason}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2 self-start">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-9"
                        onClick={() => void copy(request)}
                        aria-label={`Copy link for ${request.title}`}
                      >
                        <Copy aria-hidden="true" />
                        Copy link
                      </Button>
                      {menu(request)}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {list.data && list.data.pagination.pageCount > 1 && (
              <Pager
                label="Request pages"
                pagination={list.data.pagination}
                disabled={list.isFetching}
                onPage={setPage}
              />
            )}
          </div>
        </>
      )}

      {policy && form && (
        <RequestFormDialog
          open
          onOpenChange={(next) => !next && setForm(null)}
          policy={policy}
          editing={form.editing}
          onSaved={() => void refresh()}
        />
      )}

      <AlertDialog
        open={Boolean(confirm)}
        onOpenChange={(next) => !next && !busy && setConfirm(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === 'delete'
                ? 'Delete this request?'
                : 'Replace this link?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              {confirm?.kind === 'delete'
                ? 'The link stops working and sender names and notes are removed. Files it received stay in your library.'
                : 'The current link stops working immediately, including uploads in progress. Share the new link with the people who should still send files.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                void confirmAction()
              }}
              disabled={busy}
              className={
                confirm?.kind === 'delete'
                  ? destructiveActionClassName
                  : undefined
              }
            >
              {confirm?.kind === 'delete'
                ? busy
                  ? 'Deleting…'
                  : 'Delete request'
                : busy
                  ? 'Replacing…'
                  : 'Replace link'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function Pager({
  label,
  pagination,
  disabled,
  onPage,
}: {
  label: string
  pagination: Pagination
  disabled: boolean
  onPage: (page: number) => void
}) {
  return (
    <nav
      aria-label={label}
      className="flex items-center justify-between gap-3 text-sm"
    >
      <Button
        variant="outline"
        size="sm"
        disabled={pagination.page <= 1 || disabled}
        onClick={() => onPage(pagination.page - 1)}
      >
        Previous
      </Button>
      <span className="text-muted-foreground">
        Page {pagination.page} of {pagination.pageCount}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={pagination.page >= pagination.pageCount || disabled}
        onClick={() => onPage(pagination.page + 1)}
      >
        Next
      </Button>
    </nav>
  )
}

function fileIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return FileImage
  if (mimeType.startsWith('video/')) return FileVideo
  if (mimeType.startsWith('audio/')) return FileAudio
  if (/zip|tar|gzip|7z|rar|bzip/.test(mimeType)) return FileArchive
  if (mimeType.startsWith('text/') || mimeType === 'application/pdf')
    return FileText
  return File
}

function filePath(urlPath: string) {
  return urlPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function RequestDetail({
  query,
  onBack,
  onCopy,
  menu,
  onPage,
}: {
  query: UseQueryResult<DetailResponse>
  onBack: () => void
  onCopy: (request: FileRequestView) => void
  menu: (request: FileRequestView) => ReactNode
  onPage: (page: number) => void
}) {
  const back = (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 rounded-sm text-[11px] font-medium uppercase tracking-[.2em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      File requests
    </button>
  )
  if (query.isPending)
    return (
      <>
        <PageHeader eyebrow={back} title="Loading…" />
        <p role="status" className="sr-only">
          Loading the request…
        </p>
      </>
    )
  if (query.isError)
    return (
      <>
        <PageHeader eyebrow={back} title="Request unavailable" />
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>{query.error.message}</span>
            <Button variant="outline" size="sm" onClick={onBack}>
              All requests
            </Button>
          </AlertDescription>
        </Alert>
      </>
    )
  const { request, submissions, pagination } = query.data
  const link = requestLink(request)
  return (
    <>
      <PageHeader
        eyebrow={back}
        title={<span className="break-words">{request.title}</span>}
        description={
          request.message ? (
            <span className="whitespace-pre-line">{request.message}</span>
          ) : undefined
        }
        actions={
          <>
            <Button variant="outline" onClick={() => onCopy(request)}>
              <Copy aria-hidden="true" />
              Copy link
            </Button>
            {menu(request)}
          </>
        }
      />
      <div className={cn(pagePanelClassName, 'space-y-6')}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <RequestStatus status={request.status} />
            <MetaLine
              className="text-sm text-muted-foreground"
              items={[
                { key: 'received', text: receivedText(request) },
                {
                  key: 'lifetime',
                  text: lifetimeText(request),
                  title: request.expiresAt
                    ? absolute(request.expiresAt)
                    : undefined,
                },
                {
                  key: 'notify',
                  text: request.notify ? 'Email on' : 'Email off',
                },
              ]}
            />
          </div>
          {request.pausedReason && (
            <Alert variant="warning">
              <TriangleAlert aria-hidden="true" />
              <AlertDescription>
                Senders see that this request can’t accept files right now.{' '}
                {request.pausedReason}
              </AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Label htmlFor="request-link" className="sr-only">
              Request link
            </Label>
            <Input
              id="request-link"
              readOnly
              value={link}
              onFocus={(event) => event.currentTarget.select()}
              className="font-mono text-xs"
            />
            <Button variant="outline" className="shrink-0" asChild>
              <a href={link} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Open
              </a>
            </Button>
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{destinationText(request)}</span>
            {request.folder && (
              <Link
                href={`/dashboard?folder=${encodeURIComponent(request.folder.id)}`}
                className="inline-flex items-center gap-1 rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Folder className="h-3.5 w-3.5" aria-hidden="true" />
                Open folder
              </Link>
            )}
          </p>
        </div>

        <section aria-labelledby="received-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-5">
            <h2 id="received-heading" className="text-base font-semibold">
              Received
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw
                className={cn(query.isFetching && 'animate-spin')}
                aria-hidden="true"
              />
              Refresh
            </Button>
          </div>
          {submissions.length === 0 ? (
            <div className="rounded-xl border border-dashed px-6 py-10 text-center">
              <Inbox
                className="mx-auto mb-3 h-7 w-7 text-muted-foreground"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Nothing yet</p>
              <p className="mx-auto mt-1 max-w-sm text-pretty text-sm text-muted-foreground">
                Files people send appear here, grouped by who sent them.
              </p>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Received files">
              {submissions.map((submission) => (
                <li
                  key={submission.id}
                  className="rounded-xl border bg-muted/30"
                >
                  <div className="space-y-1 border-b border-border/60 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-medium">
                        {submission.senderName || 'Someone'}
                      </span>
                      {!submission.completedAt &&
                        Date.now() - new Date(submission.createdAt).getTime() <
                          3_600_000 && <Badge variant="info">Sending…</Badge>}
                    </div>
                    <MetaLine
                      className="text-xs text-muted-foreground"
                      items={[
                        {
                          key: 'count',
                          text: `${submission.fileCount} ${submission.fileCount === 1 ? 'file' : 'files'}`,
                        },
                        {
                          key: 'bytes',
                          text: formatRequestBytes(submission.bytes),
                        },
                        {
                          key: 'when',
                          text: relative(submission.createdAt),
                          title: absolute(submission.createdAt),
                        },
                      ]}
                    />
                    {submission.note && (
                      <p className="whitespace-pre-line break-words pt-1 text-sm">
                        {submission.note}
                      </p>
                    )}
                  </div>
                  <ul className="divide-y divide-border/60">
                    {submission.files.map((file) => {
                      const Icon = fileIcon(file.mimeType)
                      return (
                        <li
                          key={file.id}
                          className="flex items-center gap-3 px-4 py-2.5"
                        >
                          <Icon
                            className="h-4 w-4 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                          />
                          <a
                            href={filePath(file.urlPath)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            title={file.name}
                          >
                            {file.name}
                          </a>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {formatRequestBytes(file.sizeBytes)}
                          </span>
                        </li>
                      )
                    })}
                    {submission.remainingFiles > 0 && (
                      <li className="px-4 py-2.5 text-xs text-muted-foreground">
                        And {submission.remainingFiles} more{' '}
                        {submission.remainingFiles === 1 ? 'file' : 'files'} in
                        your library.
                      </li>
                    )}
                    {submission.files.length + submission.remainingFiles <
                      submission.fileCount && (
                      <li className="px-4 py-2.5 text-xs text-muted-foreground">
                        {submission.fileCount -
                          submission.files.length -
                          submission.remainingFiles}{' '}
                        deleted since they arrived.
                      </li>
                    )}
                  </ul>
                </li>
              ))}
            </ul>
          )}
          {pagination.pageCount > 1 && (
            <Pager
              label="Received pages"
              pagination={pagination}
              disabled={query.isFetching}
              onPage={onPage}
            />
          )}
        </section>
      </div>
    </>
  )
}
