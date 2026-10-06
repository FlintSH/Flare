'use client'

import { useEffect, useRef, useState } from 'react'

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { History, Laptop, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { signOut, useSession } from 'next-auth/react'

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
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { useToast } from '@/hooks/use-toast'

type BrowserSession = {
  id: string
  createdAt: string
  lastSeenAt: string
  expiresAt: string
  authMethod: string
  ipAddress: string | null
  userAgent: string | null
  current: boolean
}
type LoginAttempt = {
  id: string
  createdAt: string
  authMethod: string
  outcome: string
  ipAddress: string | null
  userAgent: string | null
}
type HistoryPage = { attempts: LoginAttempt[]; nextCursor: string | null }

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...options })
  const result = await response.json()
  if (!response.ok)
    throw new Error(
      result.error || 'Unable to load account activity. Please try again.'
    )
  return result
}

function Badge({
  children,
  variant,
  className = '',
}: {
  children: React.ReactNode
  variant: 'secondary' | 'destructive'
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${variant === 'destructive' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-muted text-muted-foreground'} ${className}`}
    >
      {children}
    </span>
  )
}

function methodName(method: string) {
  return (
    (
      {
        credentials: 'Password',
        recovery: 'Authenticator recovery',
        passkey: 'Passkey',
        'passkey-recovery': 'Passkey recovery',
        oidc: 'Single sign-on',
      } as Record<string, string>
    )[method] || 'Sign-in'
  )
}
function deviceName(agent: string | null) {
  if (!agent) return 'Unknown browser'
  const browser = /Edg\//.test(agent)
    ? 'Edge'
    : /Firefox\//.test(agent)
      ? 'Firefox'
      : /Chrome\//.test(agent)
        ? 'Chrome'
        : /Safari\//.test(agent)
          ? 'Safari'
          : 'Browser'
  const platform = /iPhone|iPad/.test(agent)
    ? 'iOS'
    : /Android/.test(agent)
      ? 'Android'
      : /Windows/.test(agent)
        ? 'Windows'
        : /Macintosh|Mac OS X/.test(agent)
          ? 'macOS'
          : /Linux/.test(agent)
            ? 'Linux'
            : ''
  return platform ? `${browser} on ${platform}` : browser
}
function date(value: string) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function ProfileSessions() {
  const { data: session, status } = useSession()
  if (status !== 'authenticated' || !session?.user?.id) return null
  return (
    <AccountSessions
      key={JSON.stringify([session.user.id, session.user.sessionId])}
      userId={session.user.id}
      sessionId={session.user.sessionId}
    />
  )
}

function AccountSessions({
  userId,
  sessionId,
}: {
  userId: string
  sessionId?: string
}) {
  const { toast } = useToast()
  const [pending, setPending] = useState<BrowserSession | 'all' | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [outcome, setOutcome] = useState('all')
  const lifecycle = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    return () => {
      controller.abort()
      if (lifecycle.current === controller) lifecycle.current = null
    }
  }, [])
  const sessions = useQuery({
    queryKey: ['profile-sessions', userId, sessionId],
    queryFn: ({ signal }) =>
      request<{ sessions: BrowserSession[] }>('/api/profile/sessions', {
        signal,
      }),
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: true,
  })
  const history = useInfiniteQuery({
    queryKey: ['profile-login-history', userId, sessionId, outcome],
    staleTime: 0,
    gcTime: 0,
    initialPageParam: '',
    queryFn: ({ pageParam, signal }) =>
      request<HistoryPage>(
        `/api/profile/login-history?outcome=${outcome}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        { signal }
      ),
    getNextPageParam: (last) => last.nextCursor || undefined,
  })
  const attempts = history.data?.pages.flatMap((page) => page.attempts) || []
  async function revoke() {
    const controller = lifecycle.current
    if (!pending || revoking || !controller || controller.signal.aborted) return
    const active = () =>
      lifecycle.current === controller && !controller.signal.aborted
    setRevoking(true)
    try {
      const result = await request<{
        signedOut: boolean
        revokedCount: number
      }>(
        pending === 'all'
          ? '/api/profile/sessions'
          : `/api/profile/sessions/${encodeURIComponent(pending.id)}`,
        { method: 'DELETE', signal: controller.signal }
      )
      if (!active()) return
      setPending(null)
      if (result.signedOut) {
        await signOut({ callbackUrl: '/auth/login?local=1' })
        return
      }
      await sessions.refetch()
      if (!active()) return
      toast({
        title: 'Session revoked',
        description: 'That browser must sign in again to continue.',
      })
    } catch (error) {
      if (!active()) return
      toast({
        title: 'Unable to revoke session',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
      void sessions.refetch()
    } finally {
      if (active()) setRevoking(false)
    }
  }
  return (
    <>
      <Card id="active-sessions" className="scroll-mt-28">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5" />
                Active sessions
              </CardTitle>
              <CardDescription>
                See where you are signed in and end access to a browser.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void sessions.refetch()}
              disabled={sessions.isFetching}
              aria-label="Refresh active sessions"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessions.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading active sessions…
            </p>
          )}
          {sessions.isError && (
            <p role="alert" className="text-sm text-destructive">
              {sessions.error.message}
            </p>
          )}
          {sessions.data?.sessions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No active sessions. Sign in again to continue.
            </p>
          )}
          {sessions.data?.sessions.map((session) => (
            <div
              key={session.id}
              className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-start sm:justify-between"
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Laptop className="h-4 w-4 text-muted-foreground" />
                  <span className="font-medium">
                    {deviceName(session.userAgent)}
                  </span>
                  {session.current && (
                    <Badge variant="secondary">This browser</Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {methodName(session.authMethod)} ·{' '}
                  {session.ipAddress || 'IP unavailable'}
                </p>
                <dl className="space-y-1 text-xs text-muted-foreground">
                  <div>
                    <dt className="inline">Signed in: </dt>
                    <dd className="inline">{date(session.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Last active: </dt>
                    <dd className="inline">{date(session.lastSeenAt)}</dd>
                  </div>
                  <div>
                    <dt className="inline">Expires: </dt>
                    <dd className="inline">{date(session.expiresAt)}</dd>
                  </div>
                </dl>
                {session.userAgent && (
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer">
                      Browser details
                    </summary>
                    <p className="mt-2 break-words">{session.userAgent}</p>
                  </details>
                )}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0 self-start"
                onClick={() => setPending(session)}
                disabled={revoking}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Revoke session
              </Button>
            </div>
          ))}
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-lg text-xs text-muted-foreground">
              Sessions expire 30 days after sign-in. Browser and IP details come
              from the request; they may be shared or inaccurate. Revocation
              takes effect on the next request and does not revoke API tokens.
            </p>
            <Button
              variant="destructive"
              className="shrink-0 self-start"
              onClick={() => setPending('all')}
              disabled={revoking || !sessions.data?.sessions.length}
            >
              Revoke all sessions
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card id="login-history" className="scroll-mt-28">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Login history
              </CardTitle>
              <CardDescription>
                Your successful and failed sign-in attempts from the last 90
                days.
              </CardDescription>
            </div>
            <div className="w-full space-y-1 sm:w-44">
              <Label htmlFor="login-outcome" className="sr-only">
                Login outcome
              </Label>
              <Select value={outcome} onValueChange={setOutcome}>
                <SelectTrigger id="login-outcome">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All attempts</SelectItem>
                  <SelectItem value="success">Successful</SelectItem>
                  <SelectItem value="failure">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {history.isPending && (
            <p role="status" className="text-sm text-muted-foreground">
              Loading login history…
            </p>
          )}
          {history.isError && (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>{history.error.message}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void history.refetch()}
              >
                Try again
              </Button>
            </div>
          )}
          {!history.isPending && !history.isError && !attempts.length && (
            <p className="text-sm text-muted-foreground">
              No sign-in attempts match this filter.
            </p>
          )}
          {attempts.map((attempt) => (
            <div
              key={attempt.id}
              className="flex flex-col gap-2 rounded-xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {methodName(attempt.authMethod)} ·{' '}
                  {deviceName(attempt.userAgent)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {date(attempt.createdAt)} ·{' '}
                  {attempt.ipAddress || 'IP unavailable'}
                </p>
              </div>
              <Badge
                className="self-start"
                variant={
                  attempt.outcome === 'success' ? 'secondary' : 'destructive'
                }
              >
                {attempt.outcome === 'success' ? 'Successful' : 'Failed'}
              </Badge>
            </div>
          ))}
          {history.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => void history.fetchNextPage()}
              disabled={history.isFetchingNextPage}
            >
              {history.isFetchingNextPage ? 'Loading…' : 'Load more attempts'}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            History starts when this feature is installed. A failed attempt
            means someone tried to sign in to your account; it does not prove
            they had your password. Provider-side SSO failures and attempts
            blocked by rate limits may not appear.
          </p>
        </CardContent>
      </Card>
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) setPending(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending === 'all'
                ? 'Revoke all sessions?'
                : 'Revoke this session?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending === 'all'
                ? 'Every browser, including this one, will be signed out. You will need to sign in again. Your API tokens and upload tools will keep working.'
                : pending?.current
                  ? 'This is your current browser. You will be signed out and need to sign in again.'
                  : 'This browser will lose access on its next request and must sign in again. Requests already in progress may finish.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={revoking}
              onClick={(event) => {
                event.preventDefault()
                void revoke()
              }}
            >
              {revoking
                ? 'Revoking…'
                : pending === 'all'
                  ? 'Revoke all and sign out'
                  : pending?.current
                    ? 'Revoke and sign out'
                    : 'Revoke session'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
