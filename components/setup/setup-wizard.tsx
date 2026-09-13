'use client'

import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'

import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCheck,
  Cloud,
  Folder,
  HardDrive,
  KeyRound,
  Mail,
  Paintbrush,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { signIn } from 'next-auth/react'

import { EmailSettings } from '@/components/email/email-settings'
import { DynamicBackground } from '@/components/layout/dynamic-background'
import { Icons } from '@/components/shared/icons'
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
import { Switch } from '@/components/ui/switch'

import {
  type SetupOptionalStep,
  getSetupResumePath,
  getSetupSignInPath,
} from '@/lib/setup/navigation'
import {
  type SetupData,
  setupAdminSchema,
  setupSchema,
  setupStorageSchema,
} from '@/lib/setup/schema'
import { cn } from '@/lib/utils'
import { markSetupAsCompleted } from '@/lib/utils/setup-cache'

import { SetupAppearance } from './setup-appearance'

const steps = [
  {
    id: 'account',
    label: 'Account',
    detail: 'Your administrator account',
    title: 'Your space starts with you.',
    description: 'Create the account you’ll use to manage your Flare instance.',
    icon: KeyRound,
  },
  {
    id: 'storage',
    label: 'Storage',
    detail: 'A home for your files',
    title: 'Give your files a home.',
    description:
      'Keep files on this server or connect storage you already use.',
    icon: HardDrive,
  },
  {
    id: 'access',
    label: 'Access',
    detail: 'Choose who can join',
    title: 'Just you, or your people.',
    description:
      'Decide whether others can create an account on your instance.',
    icon: Users,
  },
  {
    id: 'appearance',
    label: 'Appearance',
    detail: 'Make it feel like yours',
    title: 'A little more you.',
    description:
      'Give your instance a name and a look. Keeping the Flare defaults is a great place to start.',
    icon: Paintbrush,
  },
  {
    id: 'email',
    label: 'Email',
    detail: 'Account recovery, ready',
    title: 'Make your account recoverable.',
    description:
      'Connect your mail provider for password recovery and email verification. You can do this later.',
    icon: Mail,
  },
  {
    id: 'ready',
    label: 'Ready',
    detail: 'Welcome to your Flare',
    title: 'Your Flare is ready.',
    description:
      'A home for your files, screenshots, and everything you want to share.',
    icon: CheckCheck,
  },
] as const

type Step = (typeof steps)[number]['id']
type FormError = { message: string; field?: string }

const initialData: SetupData = {
  admin: { name: '', email: '', password: '' },
  storage: {
    provider: 'local',
    s3: {
      bucket: '',
      region: '',
      accessKeyId: '',
      secretAccessKey: '',
      endpoint: '',
      forcePathStyle: false,
    },
  },
  registrations: { enabled: true, disabledMessage: '' },
}

function Choice({
  selected,
  onSelect,
  icon,
  title,
  description,
  name,
  disabled = false,
}: {
  selected: boolean
  onSelect: () => void
  icon: ReactNode
  title: string
  description: string
  name: string
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'relative flex cursor-pointer flex-col gap-4 rounded-xl border p-5 transition-colors hover:bg-muted/30 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
        selected ? 'border-primary bg-primary/5' : 'bg-background/40'
      )}
    >
      <input
        type="radio"
        className="sr-only"
        name={name}
        disabled={disabled}
        checked={selected}
        onChange={onSelect}
      />
      <div className="flex items-center justify-between">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background">
          {icon}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            'flex h-5 w-5 items-center justify-center rounded-full border',
            selected && 'border-primary bg-primary text-primary-foreground'
          )}
        >
          {selected && <Check className="h-3 w-3" />}
        </span>
      </div>
      <div className="space-y-1.5">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm leading-relaxed text-muted-foreground">
          {description}
        </span>
      </div>
    </label>
  )
}

export function SetupWizard({
  configured = false,
  initialStep = 'appearance',
  initialEmailEnabled = false,
  initialEmailRecoveryEnabled = false,
}: {
  configured?: boolean
  initialStep?: SetupOptionalStep
  initialEmailEnabled?: boolean
  initialEmailRecoveryEnabled?: boolean
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(configured ? initialStep : 'account')
  const [data, setData] = useState<SetupData>(initialData)
  const [created, setCreated] = useState(configured)
  const [busy, setBusy] = useState(false)
  const [needsSignIn, setNeedsSignIn] = useState(false)
  const [error, setError] = useState<FormError | null>(null)
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled)
  const [emailRecoveryEnabled, setEmailRecoveryEnabled] = useState(
    initialEmailRecoveryEnabled
  )
  const [emailBusy, setEmailBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const submitting = useRef(false)
  const index = steps.findIndex((item) => item.id === step)
  const current = steps[index]

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    window.scrollTo({ top: 0 })
  }, [step])

  function go(next: Step) {
    setError(null)
    setStep(next)
    if (next === 'appearance' || next === 'email' || next === 'ready') {
      // Keep only the resumable stage in the URL; credentials stay in memory.
      window.history.replaceState(null, '', getSetupResumePath(next))
    }
  }

  function showValidation(message: string, field?: string) {
    setError({ message, field })
    if (field) document.getElementById(`setup-${field}`)?.focus()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (submitting.current || created) return
    setError(null)
    if (step === 'account') {
      const result = setupAdminSchema.safeParse(data.admin)
      if (!result.success) {
        const issue = result.error.issues[0]
        showValidation(issue.message, `admin.${issue.path.join('.')}`)
        return
      }
      setData((previous) => ({ ...previous, admin: result.data }))
      go('storage')
      return
    }
    if (step === 'storage') {
      const result = setupStorageSchema.safeParse(data.storage)
      if (!result.success) {
        const issue = result.error.issues[0]
        showValidation(issue.message, `storage.${issue.path.join('.')}`)
        return
      }
      setData((previous) => ({ ...previous, storage: result.data }))
      go('access')
      return
    }
    const result = setupSchema.safeParse(data)
    if (!result.success) {
      showValidation(result.error.issues[0].message)
      return
    }
    submitting.current = true
    setBusy(true)
    let accountCreated = false
    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(result.data),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok)
        throw new Error(
          body.error || 'We couldn’t create your instance. Please try again.'
        )
      accountCreated = true
      setCreated(true)
      markSetupAsCompleted()
      setData((previous) => ({
        ...previous,
        admin: { ...previous.admin, password: '' },
        storage: {
          ...previous.storage,
          s3: { ...previous.storage.s3, accessKeyId: '', secretAccessKey: '' },
        },
      }))
      const session = await signIn('credentials', {
        email: result.data.admin.email,
        password: result.data.admin.password,
        redirect: false,
      })
      if (!session?.ok || session.error) {
        setNeedsSignIn(true)
      }
      go('appearance')
    } catch (cause) {
      if (accountCreated) {
        setNeedsSignIn(true)
        go('appearance')
      } else {
        showValidation(
          cause instanceof Error
            ? cause.message
            : 'Setup couldn’t be saved. Please try again.'
        )
      }
    } finally {
      setBusy(false)
      submitting.current = false
    }
  }

  const field = (
    path: string,
    label: string,
    value: string,
    onChange: (value: string) => void,
    options: {
      type?: string
      hint?: string
      placeholder?: string
      autoComplete?: string
    } = {}
  ) => (
    <div className="space-y-2">
      <Label htmlFor={`setup-${path}`}>{label}</Label>
      <Input
        id={`setup-${path}`}
        type={options.type || 'text'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={options.placeholder}
        autoComplete={options.autoComplete}
        className="h-11"
        disabled={busy}
        aria-invalid={error?.field === path}
        aria-describedby={options.hint ? `setup-${path}-hint` : undefined}
      />
      {options.hint && (
        <p
          id={`setup-${path}-hint`}
          className="text-sm leading-relaxed text-muted-foreground"
        >
          {options.hint}
        </p>
      )}
    </div>
  )

  const updateAdmin = (key: keyof SetupData['admin'], value: string) =>
    setData((previous) => ({
      ...previous,
      admin: { ...previous.admin, [key]: value },
    }))
  const updateS3 = (
    key: keyof SetupData['storage']['s3'],
    value: string | boolean
  ) =>
    setData((previous) => ({
      ...previous,
      storage: {
        ...previous.storage,
        s3: { ...previous.storage.s3, [key]: value },
      },
    }))

  return (
    <div className="relative isolate min-h-screen">
      <DynamicBackground />
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-6 sm:px-8 sm:pt-10">
        <header className="mb-8 flex items-center justify-between gap-4 border-b pb-6 sm:mb-12">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border bg-card">
              <Icons.logo className="h-7 w-7" />
            </span>
            <span className="flare-text text-2xl tracking-tight">Flare</span>
          </div>
          <span className="rounded-full border bg-card/70 px-3 py-1.5 text-xs text-muted-foreground">
            Welcome home
          </span>
        </header>

        <div className="grid gap-8 lg:grid-cols-[230px_minmax(0,1fr)] lg:gap-12">
          <aside>
            <div className="lg:sticky lg:top-8">
              <nav aria-label="Setup progress">
                <ol className="grid grid-cols-6 gap-1 lg:grid-cols-1 lg:gap-2">
                  {steps.map((item, position) => {
                    const done = position < index
                    const active = position === index
                    const canReturn = !created && position < index && !busy
                    return (
                      <li
                        key={item.id}
                        aria-current={active ? 'step' : undefined}
                      >
                        <button
                          type="button"
                          disabled={!canReturn}
                          onClick={() => go(item.id)}
                          className={cn(
                            'flex w-full flex-col items-center gap-2 rounded-xl px-1 py-3 text-center disabled:cursor-default lg:flex-row lg:gap-3 lg:px-3 lg:text-left',
                            active && 'border bg-card/80 shadow-sm',
                            !active && 'border border-transparent',
                            canReturn && 'hover:bg-muted/30'
                          )}
                          aria-label={`${item.label}${done ? ', completed' : active ? ', current step' : ''}`}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-medium',
                              active
                                ? 'border-primary bg-primary text-primary-foreground'
                                : done
                                  ? 'border-primary/30 text-foreground'
                                  : 'text-muted-foreground'
                            )}
                          >
                            {done ? (
                              <Check className="h-3.5 w-3.5" />
                            ) : (
                              position + 1
                            )}
                          </span>
                          <span className="min-w-0">
                            <span
                              className={cn(
                                'block text-[10px] font-medium sm:text-xs lg:text-sm',
                                !active && !done && 'text-muted-foreground'
                              )}
                            >
                              {item.label}
                            </span>
                            <span className="mt-0.5 hidden text-xs text-muted-foreground lg:block">
                              {item.detail}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </nav>
              <div className="mt-10 hidden border-t px-3 pt-6 lg:block">
                <ShieldCheck className="mb-3 h-5 w-5 text-muted-foreground" />
                <p className="text-sm font-medium">Your files. Your home.</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Hosted by you, shaped around you. You can revisit these
                  choices in Settings whenever you like.
                </p>
              </div>
            </div>
          </aside>

          <main className="min-w-0 space-y-6 pb-8">
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Step {index + 1} of {steps.length}
                {(step === 'appearance' || step === 'email') && ' · Optional'}
              </p>
              <h1
                ref={heading}
                tabIndex={-1}
                className="text-3xl font-semibold tracking-tight outline-none sm:text-4xl"
              >
                {needsSignIn ? 'Your account is ready.' : current.title}
              </h1>
              <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">
                {needsSignIn
                  ? 'Your instance was created successfully. Sign in to finish the optional steps.'
                  : current.description}
              </p>
            </div>

            {needsSignIn ? (
              <Card>
                <CardHeader>
                  <CardTitle>Continue with your new account</CardTitle>
                  <CardDescription>
                    Use the email address and password you just chose. Your
                    account and storage settings are already saved.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button asChild>
                    <Link href={getSetupSignInPath(step)}>
                      Sign in to continue
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ) : step === 'appearance' ? (
              <SetupAppearance
                onComplete={() => {
                  go('email')
                  router.refresh()
                }}
                onSkip={() => go('email')}
              />
            ) : step === 'email' ? (
              <div className="space-y-5">
                <div className="flex flex-col gap-4 rounded-xl border bg-card/70 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      Prefer to do this later?
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      You can add a mail provider in Settings → Email.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => go('ready')}
                    disabled={emailBusy}
                  >
                    Set up email later
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
                <EmailSettings
                  setup
                  onBusyChange={setEmailBusy}
                  onComplete={(config) => {
                    setEmailEnabled(config.enabled)
                    setEmailRecoveryEnabled(
                      config.enabled && config.recovery.enabled
                    )
                    go('ready')
                  }}
                />
              </div>
            ) : step === 'ready' ? (
              <div className="space-y-5">
                <Card className="overflow-hidden">
                  <CardHeader className="space-y-4 pb-5">
                    <span className="flex h-12 w-12 items-center justify-center rounded-xl border bg-primary/5">
                      <CheckCheck className="h-6 w-6" />
                    </span>
                    <CardTitle className="text-xl">
                      All set. Make yourself at home.
                    </CardTitle>
                    <CardDescription>
                      Your administrator account, storage, and registration
                      settings are saved. The rest can grow with you.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {emailEnabled && (
                      <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed">
                        Email is configured.{' '}
                        <Link
                          href="/auth/verify-email"
                          className="font-medium underline underline-offset-4"
                        >
                          Verify your email address
                        </Link>{' '}
                        {emailRecoveryEnabled
                          ? 'to make password recovery available for your account.'
                          : 'to confirm the address associated with your account.'}
                      </div>
                    )}
                    <Button asChild className="h-11 w-full sm:w-auto">
                      <Link href="/dashboard">
                        Open my workspace
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Link
                    href="/dashboard/upload"
                    className="group rounded-xl border bg-card p-5 transition-colors hover:bg-muted/30"
                  >
                    <Folder className="mb-4 h-5 w-5 text-muted-foreground" />
                    <p className="font-medium">
                      Share your first file
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-block transition-transform group-hover:translate-x-1"
                      >
                        →
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Drop in a screenshot and make your first link.
                    </p>
                  </Link>
                  <Link
                    href="/dashboard/customize"
                    className="group rounded-xl border bg-card p-5 transition-colors hover:bg-muted/30"
                  >
                    <Sparkles className="mb-4 h-5 w-5 text-muted-foreground" />
                    <p className="font-medium">
                      Keep making it yours
                      <span
                        aria-hidden="true"
                        className="ml-2 inline-block transition-transform group-hover:translate-x-1"
                      >
                        →
                      </span>
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Explore themes, branding, and your share pages.
                    </p>
                  </Link>
                </div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate className="space-y-5">
                {step === 'account' && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Create your admin account</CardTitle>
                      <CardDescription>
                        This account will manage your instance and its settings.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5">
                      {field(
                        'admin.name',
                        'Username',
                        data.admin.name,
                        (value) => updateAdmin('name', value),
                        {
                          placeholder: 'Your name or handle',
                          autoComplete: 'username',
                        }
                      )}
                      {field(
                        'admin.email',
                        'Email address',
                        data.admin.email,
                        (value) => updateAdmin('email', value),
                        {
                          type: 'email',
                          placeholder: 'you@example.com',
                          autoComplete: 'email',
                          hint: 'Use an address you own. You can enable recovery in the email step.',
                        }
                      )}
                      {field(
                        'admin.password',
                        'Password',
                        data.admin.password,
                        (value) => updateAdmin('password', value),
                        {
                          type: 'password',
                          placeholder: 'Choose a strong password',
                          autoComplete: 'new-password',
                          hint: 'At least 8 characters.',
                        }
                      )}
                    </CardContent>
                  </Card>
                )}

                {step === 'storage' && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Choose your storage</CardTitle>
                        <CardDescription>
                          Flare will use this location for new uploads.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Choice
                            disabled={busy}
                            name="storage-provider"
                            title="Local storage"
                            description="Simple and ready to go. Store uploads on your Flare server."
                            icon={<HardDrive className="h-5 w-5" />}
                            selected={data.storage.provider === 'local'}
                            onSelect={() =>
                              setData((previous) => ({
                                ...previous,
                                storage: {
                                  ...previous.storage,
                                  provider: 'local',
                                },
                              }))
                            }
                          />
                          <Choice
                            disabled={busy}
                            name="storage-provider"
                            title="S3-compatible storage"
                            description="Use a bucket from Amazon S3, MinIO, or another compatible provider."
                            icon={<Cloud className="h-5 w-5" />}
                            selected={data.storage.provider === 's3'}
                            onSelect={() =>
                              setData((previous) => ({
                                ...previous,
                                storage: {
                                  ...previous.storage,
                                  provider: 's3',
                                },
                              }))
                            }
                          />
                        </div>
                        {data.storage.provider === 'local' && (
                          <div className="rounded-lg border bg-muted/20 p-4 text-sm leading-relaxed text-muted-foreground">
                            Keep your uploads directory on a persistent volume
                            and include it in your backups.
                          </div>
                        )}
                      </CardContent>
                    </Card>
                    {data.storage.provider === 's3' && (
                      <Card>
                        <CardHeader>
                          <CardTitle>Your bucket details</CardTitle>
                          <CardDescription>
                            Use the connection details from your storage
                            provider. Connectivity is not tested during setup.
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-5">
                          <div className="grid gap-5 sm:grid-cols-2">
                            {field(
                              'storage.s3.bucket',
                              'Bucket name',
                              data.storage.s3.bucket,
                              (value) => updateS3('bucket', value),
                              { placeholder: 'flare-uploads' }
                            )}
                            {field(
                              'storage.s3.region',
                              'Region',
                              data.storage.s3.region,
                              (value) => updateS3('region', value),
                              { placeholder: 'us-east-1' }
                            )}
                            {field(
                              'storage.s3.accessKeyId',
                              'Access key ID',
                              data.storage.s3.accessKeyId,
                              (value) => updateS3('accessKeyId', value),
                              { autoComplete: 'off' }
                            )}
                            {field(
                              'storage.s3.secretAccessKey',
                              'Secret access key',
                              data.storage.s3.secretAccessKey,
                              (value) => updateS3('secretAccessKey', value),
                              { type: 'password', autoComplete: 'off' }
                            )}
                          </div>
                          {field(
                            'storage.s3.endpoint',
                            'Custom endpoint (optional)',
                            data.storage.s3.endpoint || '',
                            (value) => updateS3('endpoint', value),
                            {
                              type: 'url',
                              placeholder: 'https://storage.example.com',
                              hint: 'Leave blank for Amazon S3. Use the endpoint your provider supplies for other services.',
                            }
                          )}
                          <div className="flex items-start justify-between gap-5 rounded-lg border p-4">
                            <div className="space-y-1">
                              <Label htmlFor="setup-path-style">
                                Use path-style URLs
                              </Label>
                              <p className="text-sm text-muted-foreground">
                                Enable if your S3-compatible provider requires
                                it.
                              </p>
                            </div>
                            <Switch
                              id="setup-path-style"
                              checked={data.storage.s3.forcePathStyle}
                              onCheckedChange={(value) =>
                                updateS3('forcePathStyle', value)
                              }
                            />
                          </div>
                        </CardContent>
                      </Card>
                    )}
                  </>
                )}

                {step === 'access' && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Who can create an account?</CardTitle>
                        <CardDescription>
                          Your administrator account is included either way.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-5">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <Choice
                            disabled={busy}
                            name="registration"
                            title="Open registration"
                            description="Let people create their own accounts on your instance."
                            icon={<Users className="h-5 w-5" />}
                            selected={data.registrations.enabled}
                            onSelect={() =>
                              setData((previous) => ({
                                ...previous,
                                registrations: {
                                  ...previous.registrations,
                                  enabled: true,
                                },
                              }))
                            }
                          />
                          <Choice
                            disabled={busy}
                            name="registration"
                            title="Private instance"
                            description="Keep sign-ups closed. You can create accounts for others later."
                            icon={<ShieldCheck className="h-5 w-5" />}
                            selected={!data.registrations.enabled}
                            onSelect={() =>
                              setData((previous) => ({
                                ...previous,
                                registrations: {
                                  ...previous.registrations,
                                  enabled: false,
                                },
                              }))
                            }
                          />
                        </div>
                        {!data.registrations.enabled &&
                          field(
                            'registrations.disabledMessage',
                            'Message for visitors (optional)',
                            data.registrations.disabledMessage || '',
                            (value) =>
                              setData((previous) => ({
                                ...previous,
                                registrations: {
                                  ...previous.registrations,
                                  disabledMessage: value,
                                },
                              })),
                            {
                              placeholder:
                                'This is a private Flare. Contact me for access.',
                            }
                          )}
                      </CardContent>
                    </Card>
                    <div className="rounded-xl border bg-card/70 p-5">
                      <p className="mb-4 text-sm font-medium">
                        Ready to create your instance
                      </p>
                      <dl className="grid gap-4 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="text-muted-foreground">
                            Administrator
                          </dt>
                          <dd className="mt-1 break-words font-medium">
                            {data.admin.email}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-muted-foreground">Storage</dt>
                          <dd className="mt-1 font-medium">
                            {data.storage.provider === 'local'
                              ? 'Local storage'
                              : 'S3-compatible storage'}
                          </dd>
                        </div>
                      </dl>
                      <p className="mt-4 border-t pt-4 text-xs leading-relaxed text-muted-foreground">
                        Next, you can personalize your instance and add email.
                        Both are optional.
                      </p>
                    </div>
                  </>
                )}

                {error && (
                  <p
                    role="alert"
                    className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
                  >
                    {error.message}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3 border-t pt-5">
                  {index > 0 ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => go(steps[index - 1].id)}
                    >
                      <ArrowLeft className="mr-2 h-4 w-4" />
                      Back
                    </Button>
                  ) : (
                    <span className="hidden text-xs text-muted-foreground sm:block">
                      A few choices. Then you’re home.
                    </span>
                  )}
                  <Button
                    type="submit"
                    disabled={busy}
                    className="ml-auto h-11 min-w-36"
                  >
                    {busy ? (
                      <>
                        <Icons.spinner className="mr-2 h-4 w-4 animate-spin" />
                        Creating your instance…
                      </>
                    ) : (
                      <>
                        {step === 'access' ? 'Create my instance' : 'Continue'}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </main>
        </div>
        <footer className="mt-6 border-t pt-6 text-center text-xs text-muted-foreground">
          Flare · Open source. Self-hosted. Yours.
        </footer>
      </div>
    </div>
  )
}
