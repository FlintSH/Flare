'use client'

import { useCallback, useEffect, useId, useState } from 'react'

import { deepEqual } from 'fast-equals'
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Loader2,
  Save,
} from 'lucide-react'

import {
  colorSwatchClassName,
  numberFieldClassName,
} from '@/components/shared/form-styles'
import { SaveBar } from '@/components/shared/save-bar'
import {
  SetupActions,
  setupPrimaryActionClassName,
  setupSecondaryActionClassName,
} from '@/components/shared/setup-actions'
import { SetupOption } from '@/components/shared/setup-option'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/native-select'
import { RadioGroup } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

import { apiRequest } from '@/lib/client/request'
import type { EmailConfig } from '@/lib/email/schema'
import { cn } from '@/lib/utils'

import { useUnsavedDraft } from '@/hooks/use-draft-leave'

interface SettingsResponse {
  config: EmailConfig
  passwordConfigured: boolean
  managedFields: string[]
  diagnostics?: EmailDiagnostics
}

interface EmailDiagnostics {
  state: 'disabled' | 'configured' | 'working' | 'degraded'
  counts: { pending: number; processing: number; sent: number; failed: number }
  recent: {
    id: string
    purpose: string
    recipient: string
    status: string
    attempts: number
    createdAt: string
    sentAt: string | null
    lastError: string | null
  }[]
}

interface EmailSettingsProps {
  setup?: boolean
  onComplete?: (config: EmailConfig) => void
  /** Setup only: leave email for later from the step's footer. */
  onSkip?: () => void
}

const OPTIONAL = ' (optional)'

/** "Reply-to address (optional)" with the suffix muted, as in every form. */
function fieldLabel(label: string) {
  if (!label.endsWith(OPTIONAL)) return label
  return (
    <>
      {label.slice(0, -OPTIONAL.length)}{' '}
      <span className="font-normal text-muted-foreground">(optional)</span>
    </>
  )
}

export function EmailSettings({
  setup = false,
  onComplete,
  onSkip,
}: EmailSettingsProps) {
  const id = useId()
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [config, setConfig] = useState<EmailConfig | null>(null)
  const [clearPassword, setClearPassword] = useState(false)
  const [applyToExisting, setApplyToExisting] = useState(false)
  const [impact, setImpact] = useState<{
    unverifiedUsers: number
    affectedUsers: number
  } | null>(null)
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [feedbackLocation, setFeedbackLocation] = useState<'test' | 'save'>(
    'save'
  )

  const dirty = Boolean(
    config && settings && (clearPassword || !deepEqual(config, settings.config))
  )
  useUnsavedDraft(dirty || busy === 'save')

  const load = useCallback(async () => {
    try {
      const result = await apiRequest<SettingsResponse>('/api/settings/email')
      setSettings(result)
      setConfig(result.config)
      setError('')
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to load email settings.'
      )
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (config?.verification.mode !== 'all_users') {
      setImpact(null)
      setApplyToExisting(false)
      return
    }
    let active = true
    setImpact(null)
    setApplyToExisting(false)
    const timer = setTimeout(() => {
      apiRequest<{ unverifiedUsers: number; affectedUsers: number }>(
        '/api/settings/email/impact',
        { body: { config, clearPassword } }
      )
        .then((result) => {
          if (active) setImpact(result)
        })
        .catch(() => {
          if (active) setImpact(null)
        })
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [config, clearPassword])

  if (!config || !settings) {
    const status = (
      <Card>
        <CardContent className="py-6" aria-live="polite">
          {error ? (
            <>
              <p className="text-destructive">{error}</p>
              <Button
                className="mt-3"
                variant="outline"
                onClick={() => void load()}
              >
                Try again
              </Button>
            </>
          ) : (
            'Loading email settings…'
          )}
        </CardContent>
      </Card>
    )
    // Setup can always move on, even when the settings can't be loaded.
    if (!setup || !onSkip) return status
    return (
      <div className="space-y-5">
        {status}
        <SetupActions>
          <Button
            type="button"
            variant="outline"
            onClick={onSkip}
            className={setupSecondaryActionClassName}
          >
            Set up email later
          </Button>
        </SetupActions>
      </div>
    )
  }

  const managed = (path: string) =>
    settings.managedFields.some(
      (field) => field === path || path.startsWith(`${field}.`)
    )
  const disabled = (path: string) => Boolean(busy) || managed(path)
  const read = (path: string): unknown =>
    path
      .split('.')
      .reduce<unknown>(
        (value, key) => (value as Record<string, unknown>)[key],
        config
      )
  const change = (path: string, value: string | number | boolean) => {
    if (path === 'smtp.password' && value) setClearPassword(false)
    setConfig((current) => {
      if (!current) return current
      const next = structuredClone(current)
      const keys = path.split('.')
      let target = next as unknown as Record<string, unknown>
      for (const key of keys.slice(0, -1))
        target = target[key] as Record<string, unknown>
      target[keys[keys.length - 1]] = value
      return next
    })
    setMessage('')
  }
  const note = (path: string, hint?: string) => (
    <>
      {hint && (
        <p className="text-pretty text-xs text-muted-foreground">{hint}</p>
      )}
      {managed(path) && (
        <p className="text-xs text-muted-foreground">Managed by environment</p>
      )}
    </>
  )
  const field = (
    path: string,
    label: string,
    type = 'text',
    hint?: string,
    min?: number,
    max?: number
  ) => (
    <div className="space-y-2" key={path}>
      <Label htmlFor={`${id}-${path}`}>{fieldLabel(label)}</Label>
      <Input
        id={`${id}-${path}`}
        type={type}
        value={String(read(path) ?? '')}
        onChange={(event) =>
          change(
            path,
            type === 'number' ? Number(event.target.value) : event.target.value
          )
        }
        disabled={disabled(path)}
        min={min}
        max={max}
        inputMode={type === 'number' ? 'numeric' : undefined}
        autoComplete={type === 'password' ? 'new-password' : undefined}
        // Short numbers, and the colour swatch, take one compact width.
        className={cn(
          type === 'number' && numberFieldClassName,
          type === 'color' &&
            cn(
              numberFieldClassName,
              'cursor-pointer p-1.5',
              colorSwatchClassName
            )
        )}
      />
      {note(path, hint)}
    </div>
  )
  // The switch row used across Settings: a 14px description, no inset box.
  const toggle = (path: string, label: string, hint: string) => (
    <div className="flex items-center justify-between gap-4" key={path}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <Label htmlFor={`${id}-${path}`}>{label}</Label>
        <p className="text-pretty text-sm text-muted-foreground">{hint}</p>
        {note(path)}
      </div>
      <Switch
        id={`${id}-${path}`}
        checked={Boolean(read(path))}
        onCheckedChange={(value) => change(path, value)}
        disabled={disabled(path)}
      />
    </div>
  )
  const choice = (
    path: string,
    label: string,
    options: [string, string][],
    hint?: string
  ) => (
    <div className="space-y-2" key={path}>
      <Label htmlFor={`${id}-${path}`}>{label}</Label>
      <NativeSelect
        id={`${id}-${path}`}
        value={String(read(path))}
        disabled={disabled(path)}
        onChange={(event) => change(path, event.target.value)}
      >
        {options.map(([value, title]) => (
          <option key={value} value={value}>
            {title}
          </option>
        ))}
      </NativeSelect>
      {note(path, hint)}
    </div>
  )
  const preset = (verification: boolean) => {
    if (!managed('enabled')) change('enabled', true)
    if (!managed('recovery.enabled')) change('recovery.enabled', true)
    if (!managed('verification.mode'))
      change('verification.mode', verification ? 'new_users' : 'off')
  }
  const activePreset =
    config.enabled && config.recovery.enabled
      ? config.verification.mode === 'off'
        ? 'recovery'
        : config.verification.mode === 'new_users'
          ? 'verify'
          : ''
      : ''

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setFeedbackLocation('save')
    setBusy('save')
    setError('')
    setMessage('')
    try {
      const result = await apiRequest<SettingsResponse>('/api/settings/email', {
        method: 'PUT',
        body: { config, clearPassword, applyToExisting },
      })
      setSettings(result)
      setConfig(result.config)
      setClearPassword(false)
      setApplyToExisting(false)
      setMessage('Email settings saved.')
      onComplete?.(result.config)
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to save email settings.'
      )
    } finally {
      setBusy(null)
    }
  }

  const test = async (action: 'connection' | 'send') => {
    setFeedbackLocation('test')
    if (action === 'send' && !recipient.trim()) {
      setError('Enter an address for the test email.')
      return
    }
    setBusy(action)
    setError('')
    setMessage('')
    try {
      const result = await apiRequest<{ message?: string }>(
        '/api/settings/email/test',
        {
          body: {
            config,
            clearPassword,
            action,
            ...(action === 'send' ? { recipient: recipient.trim() } : {}),
          },
        }
      )
      setMessage(
        result.message ||
          (action === 'connection'
            ? 'Connected successfully. Send a test email to check the sender address and delivery.'
            : 'Test email submitted. Check your inbox and spam folder.')
      )
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Email test failed.')
    } finally {
      setBusy(null)
    }
  }

  const enablingAll =
    config.enabled &&
    config.verification.mode === 'all_users' &&
    (!settings.config.enabled ||
      settings.config.verification.mode !== 'all_users')

  return (
    <form className="space-y-5" onSubmit={save}>
      <Card>
        <CardHeader>
          {/* Settings already heads this section "Email". */}
          <CardTitle>
            {setup ? 'Add email to your instance' : 'Email delivery'}
          </CardTitle>
          <CardDescription>
            Connect your own mail provider for account recovery and email
            verification. You choose which features to enable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {setup && (
            // The option cards every setup step uses. Choosing one turns
            // email on with that policy; neither is chosen while email is off.
            <RadioGroup
              value={activePreset}
              onValueChange={(value) => preset(value === 'verify')}
              disabled={Boolean(busy)}
              aria-label="Email features"
              className="gap-3 sm:grid-cols-2"
            >
              <SetupOption
                id={`${id}-preset-recovery`}
                value="recovery"
                selected={activePreset === 'recovery'}
                title="Password recovery only"
                description="Let people reset a forgotten password. Verifying an address stays optional."
              />
              <SetupOption
                id={`${id}-preset-verify`}
                value="verify"
                selected={activePreset === 'verify'}
                title="Recovery + verify new users"
                description="Also ask new accounts to confirm their address before they use Flare."
              />
            </RadioGroup>
          )}
          {toggle(
            'enabled',
            'Enable email',
            'Email is optional. Enabling delivery does not automatically require anyone to verify their address.'
          )}
          {!config.enabled && (
            <p className="text-pretty text-sm text-muted-foreground">
              Email is off. Users can continue signing in as before. Settings
              below can be prepared and tested before enabling email.
            </p>
          )}
          {setup && config.enabled && (
            <p className="text-pretty text-sm text-muted-foreground">
              {config.verification.mode === 'new_users'
                ? 'New users will confirm their address before using Flare. Your administrator account keeps access.'
                : 'Users can sign in as usual. Email recovery becomes available after they confirm their address.'}{' '}
              After saving, you can verify your own address.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connect your mail provider</CardTitle>
          <CardDescription>
            Use the SMTP details supplied by your email provider or your own
            mail server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            {field(
              'smtp.host',
              'SMTP host',
              'text',
              'For example, smtp.example.com'
            )}
            {field(
              'smtp.port',
              'Port',
              'number',
              'Usually 587 for STARTTLS or 465 for TLS.',
              1,
              65535
            )}
            {choice(
              'smtp.security',
              'Connection security',
              [
                ['starttls', 'STARTTLS (required)'],
                ['tls', 'TLS'],
                ['none', 'Unencrypted local relay'],
              ],
              'Use an encrypted connection for an external mail provider.'
            )}
            {field(
              'publicUrl',
              'Public Flare URL',
              'url',
              'The address users open, such as https://files.example.com. Links in emails use this URL.'
            )}
          </div>
          {toggle(
            'smtp.authentication',
            'SMTP authentication',
            'Turn off only if your mail server accepts messages from Flare without a username and password.'
          )}
          {config.smtp.authentication && (
            <div className="grid gap-4 sm:grid-cols-2">
              {field('smtp.username', 'SMTP username')}
              {field(
                'smtp.password',
                settings.passwordConfigured
                  ? 'Replace SMTP password'
                  : 'SMTP password',
                'password',
                settings.passwordConfigured
                  ? 'A password is saved. Leave blank to keep it.'
                  : 'Use the password or application password provided by your mail service.'
              )}
            </div>
          )}
          {settings.passwordConfigured && !managed('smtp.password') && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={clearPassword}
                disabled={Boolean(busy)}
                onChange={(event) => {
                  setClearPassword(event.target.checked)
                  if (event.target.checked) change('smtp.password', '')
                }}
              />
              Remove the saved SMTP password when saving
            </label>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {field('fromName', 'Sender name')}
            {field(
              'fromAddress',
              'Sender email address',
              'email',
              'Use an address your provider permits you to send from.'
            )}
            {field('replyTo', 'Reply-to address (optional)', 'email')}
          </div>
          <div className="space-y-4 rounded-xl border bg-muted/30 p-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">Check your connection</p>
              <p className="text-pretty text-sm text-muted-foreground">
                Tests use the details above without saving them. A successful
                connection confirms the server and credentials; the test email
                checks sending.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                aria-label="Test email recipient"
                type="email"
                placeholder="you@example.com"
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
                disabled={Boolean(busy)}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => void test('connection')}
                disabled={Boolean(busy)}
              >
                {busy === 'connection' ? 'Connecting…' : 'Test connection'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void test('send')}
                disabled={Boolean(busy) || !recipient.trim()}
              >
                {busy === 'send' ? 'Sending…' : 'Send test email'}
              </Button>
            </div>
            {feedbackLocation === 'test' && (
              <div aria-live="polite">
                {error && (
                  <p className="text-sm text-destructive" role="alert">
                    {error}
                  </p>
                )}
                {message && <p className="text-sm">{message}</p>}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!setup && (
        <Card>
          <CardHeader>
            <CardTitle>Account features</CardTitle>
            <CardDescription>
              Configure recovery and verification separately. Existing accounts
              keep access unless you explicitly include them.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {toggle(
              'recovery.enabled',
              'Email password recovery',
              'Let users who have confirmed their address reset a local password. Existing users first confirm their password and enroll their address from their profile.'
            )}
            {choice(
              'verification.mode',
              'Require email verification',
              [
                ['off', 'Off'],
                ['optional', 'Optional — users may verify'],
                ['new_users', 'Required for new users only'],
                ['all_users', 'Required for all users'],
              ],
              'An exemption preserves access without claiming that an address has been verified.'
            )}
            {config.verification.mode === 'new_users' && (
              <p className="text-pretty text-sm text-muted-foreground">
                Accounts created before this policy is enabled keep access. They
                can verify from their profile when ready.
              </p>
            )}
            {config.verification.mode === 'all_users' && (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                {config.verification.graceEndsAt && (
                  <p className="text-pretty text-sm text-muted-foreground">
                    The current grace period ends{' '}
                    {new Date(config.verification.graceEndsAt).toLocaleString()}
                    .
                  </p>
                )}
                <p className="text-sm">
                  {impact
                    ? `${impact.unverifiedUsers} users have not verified their address. ${impact.affectedUsers} users would be affected by applying this policy.`
                    : 'The affected-user count is unavailable. Refresh the preview before applying this policy to existing users.'}
                </p>
                {field(
                  'verification.graceDays',
                  'Grace period for existing users (days)',
                  'number',
                  'Users keep access during the grace period while they verify.',
                  0,
                  90
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={Boolean(busy)}
                  onClick={async () => {
                    try {
                      setImpact(
                        await apiRequest('/api/settings/email/impact', {
                          body: { config, clearPassword },
                        })
                      )
                    } catch {
                      setError(
                        'Unable to refresh the affected-user count. Please try again.'
                      )
                      setImpact(null)
                    }
                  }}
                >
                  Refresh affected-user count
                </Button>
                {enablingAll && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={applyToExisting}
                      disabled={Boolean(busy) || !impact}
                      onChange={(event) =>
                        setApplyToExisting(event.target.checked)
                      }
                    />
                    Apply this requirement to existing users. I have reviewed
                    the affected-user count and grace period.
                  </label>
                )}
              </div>
            )}
            {toggle(
              'changes.enabled',
              'Allow email address changes',
              'Users confirm the new address before it replaces their current address.'
            )}
            {toggle(
              'changes.requireOldEmail',
              'Confirm email changes from the old address',
              'Require approval from the current address as well as confirmation of the new one.'
            )}
          </CardContent>
        </Card>
      )}

      <details className="rounded-xl border bg-card">
        <summary className="cursor-pointer rounded-xl px-6 py-5 text-sm font-medium">
          Advanced email settings
        </summary>
        <div className="space-y-7 border-t p-6">
          <section className="space-y-4">
            <h3 className="font-medium">Security and account policy</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {field(
                'recovery.tokenMinutes',
                'Reset link lifetime (minutes)',
                'number',
                undefined,
                5,
                120
              )}
              {field(
                'verification.tokenHours',
                'Verification link lifetime (hours)',
                'number',
                undefined,
                1,
                168
              )}
              {choice(
                'verification.adminCreated',
                'Accounts created by administrators',
                [
                  ['inherit', 'Follow the instance verification policy'],
                  ['exempt', 'Exempt from required verification'],
                ]
              )}
            </div>
            {toggle(
              'verification.trustOidc',
              'Accept verified addresses from SSO',
              'Trust the configured identity provider when it explicitly confirms email ownership. Matching an email never links accounts.'
            )}
            {toggle(
              'recovery.rotateUploadToken',
              'Rotate upload tokens after a password reset',
              'Invalidates upload tool credentials as well as existing sessions. Users will need to reconfigure their upload tools.'
            )}
          </section>
          <section className="space-y-4">
            <h3 className="font-medium">Sending limits</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {field(
                'limits.resendSeconds',
                'Resend cooldown (seconds)',
                'number',
                undefined,
                30,
                3600
              )}
              {field(
                'limits.addressPerHour',
                'Messages per address per hour',
                'number',
                undefined,
                1,
                100
              )}
              {field(
                'limits.ipPerHour',
                'Requests per IP per hour',
                'number',
                undefined,
                1,
                1000
              )}
              {field(
                'limits.dailyLimit',
                'Maximum messages per day',
                'number',
                undefined,
                1,
                100000
              )}
            </div>
          </section>
          <section className="space-y-4">
            <h3 className="font-medium">Delivery</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              {field(
                'delivery.maxAttempts',
                'Maximum delivery attempts',
                'number',
                undefined,
                1,
                10
              )}
              {field(
                'delivery.retrySeconds',
                'Initial retry delay (seconds)',
                'number',
                undefined,
                10,
                3600
              )}
              {field(
                'delivery.concurrency',
                'Concurrent deliveries',
                'number',
                undefined,
                1,
                10
              )}
              {field(
                'delivery.retentionDays',
                'Delivery history retention (days)',
                'number',
                undefined,
                1,
                90
              )}
              {field(
                'smtp.timeoutSeconds',
                'SMTP timeout (seconds)',
                'number',
                undefined,
                3,
                120
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-ca`}>
                {fieldLabel('Custom certificate authority (optional)')}
              </Label>
              <Textarea
                id={`${id}-ca`}
                className="min-h-24 font-mono"
                value={config.smtp.ca}
                disabled={disabled('smtp.ca')}
                onChange={(event) => change('smtp.ca', event.target.value)}
                placeholder="PEM certificate for your internal mail server"
              />
              {note(
                'smtp.ca',
                'Certificate validation stays enabled. Leave blank to use system certificates.'
              )}
            </div>
          </section>
          <section className="space-y-4">
            <h3 className="font-medium">Email appearance</h3>
            <p className="text-pretty text-sm text-muted-foreground">
              Customize the built-in templates. Text is escaped automatically,
              and security links are supplied by Flare.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              {field('branding.instanceName', 'Instance name')}
              {field('branding.logoUrl', 'Logo URL (optional)', 'url')}
              {field('branding.accentColor', 'Accent color', 'color')}
              {field(
                'branding.supportAddress',
                'Support email (optional)',
                'email'
              )}
              {field('branding.subjectPrefix', 'Subject prefix (optional)')}
              {field('branding.verificationSubject', 'Verification subject')}
              {field('branding.resetSubject', 'Password reset subject')}
              {field('branding.changeSubject', 'Email change subject')}
              {field('branding.introText', 'Introduction (optional)')}
              {field('branding.footer', 'Footer text (optional)')}
            </div>
          </section>
        </div>
      </details>

      {feedbackLocation === 'save' && (
        <div aria-live="polite" className="space-y-2">
          {error && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {message && (
            <Alert variant="success" role="status">
              <CheckCircle2 aria-hidden="true" />
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
        </div>
      )}
      {setup ? (
        <SetupActions>
          {onSkip && (
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy)}
              onClick={onSkip}
              className={setupSecondaryActionClassName}
            >
              Set up email later
            </Button>
          )}
          <Button
            type="submit"
            disabled={
              Boolean(busy) || (enablingAll && (!applyToExisting || !impact))
            }
            className={setupPrimaryActionClassName}
          >
            {busy === 'save' ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Saving…
              </>
            ) : (
              <>
                Save and continue
                <ArrowRight aria-hidden="true" />
              </>
            )}
          </Button>
        </SetupActions>
      ) : (
        <>
          {/* The save bar every editor shares. It saves the settings above;
              delivery status below is read-only. */}
          <SaveBar
            tone={dirty ? 'unsaved' : 'saved'}
            title={dirty ? 'Unsaved changes' : 'All changes saved'}
            description="Email settings are saved separately from other instance settings."
          >
            <Button
              type="button"
              variant="outline"
              disabled={Boolean(busy) || !dirty}
              onClick={() => {
                setConfig(structuredClone(settings.config))
                setClearPassword(false)
                setApplyToExisting(false)
                setError('')
                setMessage('')
              }}
            >
              Discard
            </Button>
            <Button
              type="submit"
              disabled={
                Boolean(busy) ||
                !dirty ||
                (enablingAll && (!applyToExisting || !impact))
              }
            >
              {busy === 'save' ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {busy === 'save' ? 'Saving…' : 'Save email settings'}
            </Button>
          </SaveBar>
          {settings.diagnostics && (
            <DeliveryStatus
              diagnostics={settings.diagnostics}
              onRefresh={async () => {
                const result = await apiRequest<SettingsResponse>(
                  '/api/settings/email'
                )
                setSettings((current) =>
                  current
                    ? { ...current, diagnostics: result.diagnostics }
                    : result
                )
              }}
            />
          )}
        </>
      )}
    </form>
  )
}

function DeliveryStatus({
  diagnostics,
  onRefresh,
}: {
  diagnostics: EmailDiagnostics
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const refresh = async (retryId?: string) => {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      if (retryId) {
        const result = await apiRequest<{ message: string }>(
          '/api/settings/email/retry',
          { body: { id: retryId } }
        )
        setMessage(result.message)
      }
      await onRefresh()
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'Unable to refresh delivery status.'
      )
    } finally {
      setBusy(false)
    }
  }
  const labels = {
    disabled: 'Email disabled',
    configured: 'Configured',
    working: 'Delivery active',
    degraded: 'Delivery needs attention',
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Delivery status</CardTitle>
        <CardDescription>
          {labels[diagnostics.state]}. Sent messages have been accepted by your
          mail server; inbox delivery can take longer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(diagnostics.counts).map(([key, value]) => (
            <div key={key}>
              <dt className="text-sm capitalize text-muted-foreground">
                {key}
              </dt>
              <dd className="mt-1 text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
        {diagnostics.recent.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Recent messages</h3>
            {diagnostics.recent.map((entry) => (
              <div
                key={entry.id}
                className="space-y-2 rounded-lg border p-3 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="break-all">
                    {entry.recipient}{' '}
                    <span className="text-muted-foreground">
                      · {entry.purpose.replaceAll('_', ' ')}
                    </span>
                  </p>
                  <span className="text-xs capitalize">
                    {entry.status.toLowerCase()}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {new Date(entry.createdAt).toLocaleString()} ·{' '}
                  {entry.attempts} delivery attempts
                </p>
                {entry.lastError && (
                  <p className="text-xs text-destructive">{entry.lastError}</p>
                )}
                {entry.status.toLowerCase() === 'failed' && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || diagnostics.state === 'disabled'}
                    onClick={() => void refresh(entry.id)}
                  >
                    Retry delivery
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
        {/* The result sits beside the button, so the card ends at the
            button, like the other cards, until there is something to say. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void refresh()}
          >
            {busy ? 'Refreshing…' : 'Refresh delivery status'}
          </Button>
          <div aria-live="polite" className="min-w-0">
            {message && <p className="text-sm">{message}</p>}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
