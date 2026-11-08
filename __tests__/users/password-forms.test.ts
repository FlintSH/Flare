import type { ReactElement, ReactNode } from 'react'

import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RegisterForm } from '@/components/auth/register-form'
import { UserList } from '@/components/dashboard/user-list'
import {
  ForgotPasswordForm,
  ResetPasswordForm,
} from '@/components/email/auth-forms'
import { ProfileSecurity } from '@/components/profile/security/profile-security'
import { SetupWizard } from '@/components/setup/setup-wizard'

import type { User } from '@/hooks/use-user-management'

// Exercise the real event handlers and request client with explicit hook renders.
// Browser-native constraint validation is checked separately in the UI suite.
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  fetch: vi.fn<typeof fetch>(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
  refreshSecurity: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  users: [] as User[],
  canUpdateUsers: true,
}))

vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots))
      harness.slots[index] = typeof initial === 'function' ? initial() : initial
    return [
      harness.slots[index],
      (next: unknown) => {
        harness.slots[index] =
          typeof next === 'function' ? next(harness.slots[index]) : next
      },
    ]
  },
  useRef: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = { current: initial }
    return harness.slots[index]
  },
  useEffect: () => {},
  useCallback: (callback: unknown) => callback,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: harness.push, refresh: vi.fn() }),
}))
vi.mock('next-auth/react', () => ({
  signIn: harness.signIn,
  useSession: () => ({ update: vi.fn() }),
}))
vi.mock('@/hooks/use-sign-out', () => ({ useSignOut: () => harness.signOut }))
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: harness.toast }),
}))
vi.mock('@/hooks/use-security-status', () => ({
  useSecurityStatus: () => ({
    data: undefined,
    refetch: harness.refreshSecurity,
  }),
}))
vi.mock('@/hooks/use-setup-status', () => ({
  useMarkSetupComplete: () => vi.fn(),
}))
vi.mock('@/hooks/use-permissions', () => ({
  usePermissions: () => ({
    can: (permission: string) =>
      permission !== 'users.update' || harness.canUpdateUsers,
    user: { id: 'administrator', permissions: ['administrator'], roles: [] },
  }),
}))
vi.mock('@/hooks/use-roles', () => ({
  useRoles: () => ({ data: { roles: [] } }),
}))
vi.mock('@/hooks/use-user-management', () => ({
  useUserManagement: () => ({
    users: harness.users,
    isLoading: false,
    currentPage: 1,
    pagination: null,
    loadError: false,
    fetchUsers: vi.fn(),
    createUser: harness.createUser,
    updateUser: harness.updateUser,
  }),
}))

type Element = ReactElement<Record<string, unknown>>
type SubmitEvent = { preventDefault(): void; currentTarget: unknown }

function find(
  node: ReactNode,
  matches: (element: Element) => boolean
): Element | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const result = find(child, matches)
      if (result) return result
    }
    return undefined
  }
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined
  const element = node as Element
  return matches(element)
    ? element
    : find(element.props.children as ReactNode, matches)
}

function render(component: () => ReactNode) {
  harness.cursor = 0
  return component()
}

function input(view: ReactNode, id: string) {
  const result = find(view, (element) => element.props.id === id)
  expect(result, `input ${id}`).toBeDefined()
  return result!
}

function change(view: ReactNode, id: string, value: string) {
  const onChange = input(view, id).props.onChange as (event: {
    target: { value: string }
  }) => void
  onChange({ target: { value } })
}

async function submit(
  view: ReactNode,
  fields: Record<string, string> = {},
  currentTarget: unknown = fields
) {
  const form = find(view, (element) => element.type === 'form')!
  const onSubmit = form.props.onSubmit as (event: SubmitEvent) => Promise<void>
  await onSubmit({ preventDefault() {}, currentTarget })
}

const realFormData = FormData
beforeEach(() => {
  vi.clearAllMocks()
  harness.slots = []
  harness.users = []
  harness.canUpdateUsers = true
  harness.fetch.mockResolvedValue(Response.json({}))
  harness.signIn.mockResolvedValue({ ok: true })
  harness.refreshSecurity.mockResolvedValue({
    data: {
      hasPassword: true,
      twoFactorEnabled: false,
      passkeyRequired: false,
    },
    error: null,
  })
  vi.stubGlobal('fetch', harness.fetch)
  vi.stubGlobal(
    'FormData',
    class extends realFormData {
      constructor(fields?: Record<string, string>) {
        super()
        for (const [key, value] of Object.entries(fields || {}))
          this.set(key, value)
      }
    }
  )
  vi.stubGlobal('document', { getElementById: () => ({ focus() {} }) })
  vi.stubGlobal('window', { history: { replaceState: vi.fn() } })
})
afterEach(() => vi.unstubAllGlobals())

const invalidPasswords = [
  ['short ASCII', 'a'.repeat(7)],
  ['four simple emoji', '🔒'.repeat(4)],
  ['two composed emoji', '👩‍💻'.repeat(2)],
  ['73 ASCII bytes', 'a'.repeat(73)],
  ['76 emoji bytes', '🔒'.repeat(19)],
  ['73 accented/mixed bytes', 'é'.repeat(36) + 'a'],
] as const
const boundaryPasswords = [
  ['72 ASCII bytes', 'a'.repeat(72)],
  ['eight simple emoji', '🔒'.repeat(8)],
  ['three composed emoji', '👩‍💻'.repeat(3)],
  ['72 emoji bytes', '🔒'.repeat(18)],
  ['72 accented bytes', 'é'.repeat(36)],
] as const

const uncontrolledForms = [
  [
    'registration',
    () => RegisterForm({ verificationRequired: false }),
    '/api/auth/register',
  ],
  [
    'reset',
    () =>
      ResetPasswordForm({
        token: 'disposable-test-token',
        recoveryEnabled: true,
      }),
    '/api/auth/email/reset',
  ],
] as const

describe.each(uncontrolledForms)(
  '%s password submission',
  (_, component, endpoint) => {
    it.each(invalidPasswords)('rejects %s before POST', async (_, password) => {
      await submit(render(component), {
        name: 'Example',
        email: 'example@example.test',
        password,
        confirmPassword: password,
      })
      expect(harness.fetch).not.toHaveBeenCalled()
      expect(harness.signIn).not.toHaveBeenCalled()
    })

    it.each(boundaryPasswords)(
      'sends all %s unchanged',
      async (_, password) => {
        await submit(render(component), {
          name: 'Example',
          email: 'example@example.test',
          password,
          confirmPassword: password,
        })
        expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
          endpoint,
          expect.objectContaining({ method: 'POST' })
        )
        expect(
          JSON.parse(harness.fetch.mock.calls[0][1]!.body as string).password
        ).toBe(password)
      }
    )

    it('rejects a confirmation mismatch before POST', async () => {
      await submit(render(component), {
        password: 'valid-password',
        confirmPassword: 'different-password',
      })
      expect(harness.fetch).not.toHaveBeenCalled()
    })
  }
)

function profile(password: string, confirmation = password) {
  const view = render(() => ProfileSecurity({ onUpdate: vi.fn() }))
  for (const [id, value] of [
    ['current-password', 'current-password'],
    ['new-password', password],
    ['confirm-password', confirmation],
  ])
    (input(view, id).props.ref as { current: { value: string } }).current = {
      value,
    }
  return view
}

describe('profile password submission', () => {
  it.each(invalidPasswords)(
    'rejects %s before proof refresh or PUT',
    async (_, password) => {
      await submit(profile(password))
      expect(harness.refreshSecurity).not.toHaveBeenCalled()
      expect(harness.fetch).not.toHaveBeenCalled()
      expect(harness.signOut).not.toHaveBeenCalled()
    }
  )
  it.each(boundaryPasswords)(
    'preserves proof and all %s',
    async (_, password) => {
      await submit(profile(password))
      expect(harness.refreshSecurity).toHaveBeenCalledOnce()
      expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
        '/api/profile',
        expect.objectContaining({ method: 'PUT' })
      )
      expect(
        JSON.parse(harness.fetch.mock.calls[0][1]!.body as string)
      ).toMatchObject({
        currentPassword: 'current-password',
        newPassword: password,
      })
      expect(harness.signOut).toHaveBeenCalledOnce()
    }
  )
  it('rejects mismatched confirmation before proof or PUT', async () => {
    await submit(profile('valid-password', 'different-password'))
    expect(harness.refreshSecurity).not.toHaveBeenCalled()
    expect(harness.fetch).not.toHaveBeenCalled()
  })
  it('still requires the existing current-password proof for a valid password', async () => {
    const view = profile('valid-password')
    ;(
      input(view, 'current-password').props.ref as {
        current: { value: string }
      }
    ).current.value = ''
    await submit(view)
    expect(harness.refreshSecurity).toHaveBeenCalledOnce()
    expect(harness.fetch).not.toHaveBeenCalled()
  })
})

const setup = () => SetupWizard({ documentationUrl: '/docs' })
function setupAccount(password: string, confirmation = password) {
  for (const [id, value] of [
    ['setup-admin.name', 'Example'],
    ['setup-admin.email', 'example@example.test'],
    ['setup-admin.password', password],
    ['setup-admin.passwordConfirmation', confirmation],
  ])
    change(render(setup), id, value)
  return render(setup)
}

function setupPasswordFields(password: string, confirmation = password) {
  const field = (value: string) => ({
    value,
    setCustomValidity: vi.fn(),
    // Native reportValidity requests validation/focus on this particular field.
    // The browser's actual focus behavior remains a separate UI-suite check.
    reportValidity: vi.fn(() => false),
    form: null as unknown,
  })
  const primary = field(password)
  const repeated = field(confirmation)
  const form = {
    elements: {
      namedItem: (id: string) =>
        id === 'setup-admin.password'
          ? primary
          : id === 'setup-admin.passwordConfirmation'
            ? repeated
            : null,
    },
  }
  primary.form = repeated.form = form
  return { primary, repeated, form }
}

describe('setup account password', () => {
  it.each(invalidPasswords)(
    'rejects %s without advancing or POST',
    async (_, password) => {
      const fields = setupPasswordFields(password)
      await submit(setupAccount(password), {}, fields.form)
      expect(input(render(setup), 'setup-admin.password').props.value).toBe(
        password
      )
      expect(
        input(render(setup), 'setup-admin.passwordConfirmation').props.value
      ).toBe(password)
      expect(fields.primary.reportValidity).toHaveBeenCalledOnce()
      expect(fields.repeated.reportValidity).not.toHaveBeenCalled()
      expect(fields.primary.setCustomValidity).toHaveBeenLastCalledWith(
        expect.stringMatching(/8|72/)
      )
      expect(
        input(render(setup), 'setup-admin.password').props['aria-invalid']
      ).toBe(true)
      expect(
        find(
          render(setup),
          (element) => element.props.id === 'setup-storage-title'
        )
      ).toBeUndefined()
      expect(harness.fetch).not.toHaveBeenCalled()
    }
  )
  it.each(boundaryPasswords)(
    'allows %s through to the existing setup POST',
    async (_, password) => {
      const fields = setupPasswordFields(password)
      await submit(setupAccount(password), {}, fields.form) // Account → storage.
      expect(fields.primary.setCustomValidity).toHaveBeenLastCalledWith('')
      expect(fields.repeated.setCustomValidity).toHaveBeenLastCalledWith('')
      expect(fields.primary.reportValidity).not.toHaveBeenCalled()
      expect(fields.repeated.reportValidity).not.toHaveBeenCalled()
      await submit(render(setup)) // Local storage → access.
      await submit(render(setup)) // Create the instance.
      expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
        '/api/setup',
        expect.objectContaining({ method: 'POST' })
      )
      expect(
        JSON.parse(harness.fetch.mock.calls[0][1]!.body as string).admin
      ).toEqual({
        name: 'Example',
        email: 'example@example.test',
        password,
      })
    }
  )

  it.each([
    ['empty', '', 'Confirm your password.'],
    ['mismatched', 'different-password', 'Passwords do not match.'],
  ])(
    'keeps %s confirmation on Account and targets that field without a request',
    async (_, confirmation, message) => {
      const fields = setupPasswordFields('valid-password', confirmation)
      await submit(
        setupAccount('valid-password', confirmation),
        {},
        fields.form
      )
      const view = render(setup)
      const repeated = input(view, 'setup-admin.passwordConfirmation')
      expect(repeated.props.required).toBe(true)
      expect(repeated.props.value).toBe(confirmation)
      expect(repeated.props['aria-invalid']).toBe(true)
      expect(repeated.props['aria-describedby']).toBe(
        'setup-admin.passwordConfirmation-error'
      )
      expect(
        find(
          view,
          (element) =>
            element.props.id === 'setup-admin.passwordConfirmation-error'
        )?.props.message
      ).toBe(message)
      expect(fields.primary.setCustomValidity).toHaveBeenLastCalledWith('')
      expect(fields.primary.reportValidity).not.toHaveBeenCalled()
      expect(fields.repeated.setCustomValidity).toHaveBeenLastCalledWith(
        message
      )
      expect(fields.repeated.reportValidity).toHaveBeenCalledOnce()
      expect(
        find(view, (element) => element.props.id === 'setup-storage-title')
      ).toBeUndefined()
      expect(harness.fetch).not.toHaveBeenCalled()
      expect(harness.signIn).not.toHaveBeenCalled()
    }
  )

  it('clears a corrected confirmation and advances locally without sending it to setup', async () => {
    const password = 'valid-password'
    const fields = setupPasswordFields(password, 'different-password')
    await submit(setupAccount(password, 'different-password'), {}, fields.form)
    expect(fields.repeated.reportValidity).toHaveBeenCalledOnce()
    expect(harness.fetch).not.toHaveBeenCalled()
    change(render(setup), 'setup-admin.passwordConfirmation', password)
    fields.repeated.value = password
    ;(
      input(render(setup), 'setup-admin.passwordConfirmation').props
        .onInput as (event: unknown) => void
    )({ currentTarget: fields.repeated })
    expect(fields.repeated.setCustomValidity).toHaveBeenLastCalledWith('')
    expect(
      input(render(setup), 'setup-admin.passwordConfirmation').props[
        'aria-invalid'
      ]
    ).toBeUndefined()
    await submit(render(setup), {}, fields.form)
    expect(
      find(
        render(setup),
        (element) => element.props.id === 'setup-admin.passwordConfirmation'
      )
    ).toBeUndefined()
    expect(
      find(
        render(setup),
        (element) => element.props.id === 'setup-storage-title'
      )
    ).toBeDefined()
    expect(harness.fetch).not.toHaveBeenCalled()
    expect(harness.signIn).not.toHaveBeenCalled()
    await submit(render(setup)) // Local storage → access, still no request.
    expect(harness.fetch).not.toHaveBeenCalled()
    await submit(render(setup))
    expect(harness.fetch).toHaveBeenCalledExactlyOnceWith(
      '/api/setup',
      expect.objectContaining({ method: 'POST' })
    )
    const payload = JSON.parse(harness.fetch.mock.calls[0][1]!.body as string)
    expect(Object.keys(payload).sort()).toEqual([
      'admin',
      'registrations',
      'storage',
    ])
    expect(payload.admin).toEqual({
      name: 'Example',
      email: 'example@example.test',
      password,
    })
    expect(payload).not.toHaveProperty('passwordConfirmation')
  })
})

const managedUser: User = {
  id: 'example',
  name: 'Example',
  email: 'example@example.test',
  image: null,
  roles: [],
  urlId: 'ABCDE',
  vanityId: null,
  storageUsed: 0,
  _count: { files: 0, shortenedUrls: 0 },
}
function editUser() {
  harness.users = [managedUser]
  const edit = find(
    render(UserList),
    (element) => element.props['aria-label'] === 'Edit Example'
  )!
  ;(edit.props.onClick as () => void)()
  return render(UserList)
}

describe('administrator account password', () => {
  it.each(invalidPasswords)(
    'rejects %s in new and edit before mutation',
    async (_, password) => {
      change(render(UserList), 'password', password)
      await submit(render(UserList))
      expect(harness.createUser).not.toHaveBeenCalled()
      change(editUser(), 'newPassword', password)
      await submit(render(UserList))
      expect(harness.updateUser).not.toHaveBeenCalled()
    }
  )
  it.each(boundaryPasswords)(
    'passes all %s to create and edit unchanged',
    async (_, password) => {
      change(render(UserList), 'password', password)
      await submit(render(UserList))
      expect(harness.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ password })
      )
      change(editUser(), 'newPassword', password)
      await submit(render(UserList))
      expect(harness.updateUser).toHaveBeenCalledWith(
        'example',
        expect.objectContaining({ password })
      )
    }
  )
  it('lets an edit keep its existing password when the field is empty', async () => {
    change(editUser(), 'newPassword', '')
    await submit(render(UserList))
    expect(harness.updateUser).toHaveBeenCalledOnce()
    expect(harness.toast).not.toHaveBeenCalled()
  })
  it('does not validate or send identity fields for a role-only editor', async () => {
    change(editUser(), 'newPassword', 'too-short')
    harness.canUpdateUsers = false
    await submit(render(UserList))
    expect(harness.updateUser).toHaveBeenCalledExactlyOnceWith('example', {
      roleIds: [],
    })
  })
})

describe('native password validity and persistent guidance', () => {
  it.each([
    [
      'registration',
      () => render(() => RegisterForm({ verificationRequired: false })),
      'password',
    ],
    [
      'reset',
      () =>
        render(() =>
          ResetPasswordForm({ token: 'test-token', recoveryEnabled: true })
        ),
      'reset-password',
    ],
    ['profile', () => profile(''), 'new-password'],
    ['setup', () => render(setup), 'setup-admin.password'],
    ['admin create', () => render(UserList), 'password'],
    ['admin edit', editUser, 'newPassword'],
  ] as const)(
    'marks long values invalid and clears the error at the byte boundary in %s',
    (_, component, id) => {
      const view = component()
      const rerender = id === 'newPassword' ? () => render(UserList) : component
      const field = input(view, id)
      expect(field.props.maxLength).toBeUndefined()
      const hintId = field.props['aria-describedby']
      expect(typeof hintId).toBe('string')
      expect(find(view, (element) => element.props.id === hintId)).toBeDefined()
      const validate = field.props.onInput as (event: {
        currentTarget: {
          value: string
          setCustomValidity: (message: string) => void
        }
      }) => void
      const setCustomValidity = vi.fn()
      for (const [, password] of invalidPasswords) {
        validate({ currentTarget: { value: password, setCustomValidity } })
        expect(setCustomValidity).toHaveBeenLastCalledWith(
          expect.stringMatching(/8|72/)
        )
      }
      expect(input(rerender(), id).props['aria-invalid']).toBeUndefined()
      const invalidEvent = {
        currentTarget: { value: 'a'.repeat(73), setCustomValidity },
      }
      ;(field.props.onInvalid as (event: typeof invalidEvent) => void)(
        invalidEvent
      )
      const invalid = input(rerender(), id)
      expect(invalid.props['aria-invalid']).toBe(true)
      expect(invalid.props['aria-describedby']).toContain(id + '-error')
      expect(
        find(rerender(), (node) => node.props.id === id + '-error')?.props
          .message
      ).toMatch(/72/)
      for (const [, password] of boundaryPasswords) {
        validate({ currentTarget: { value: password, setCustomValidity } })
        expect(setCustomValidity).toHaveBeenLastCalledWith('')
      }
      expect(input(rerender(), id).props['aria-invalid']).toBeUndefined()
      if (id === 'newPassword') {
        validate({ currentTarget: { value: '', setCustomValidity } })
        expect(setCustomValidity).toHaveBeenLastCalledWith('')
      }
    }
  )
})

it('associates a confirmation mismatch with that field and rechecks a corrected primary', () => {
  const component = () => RegisterForm({ verificationRequired: false })
  const view = render(component)
  const primary = {
    value: 'first-password',
    setCustomValidity: vi.fn(),
    form: null as unknown,
  }
  const repeated = {
    value: 'second-password',
    setCustomValidity: vi.fn(),
    form: null as unknown,
  }
  const form = {
    elements: {
      namedItem: (id: string) => (id === 'password' ? primary : repeated),
    },
  }
  primary.form = repeated.form = form
  const invalid = input(view, 'confirmPassword').props.onInvalid as (
    event: unknown
  ) => void
  invalid({ currentTarget: repeated })
  let current = render(component)
  expect(input(current, 'confirmPassword').props['aria-invalid']).toBe(true)
  expect(input(current, 'confirmPassword').props['aria-describedby']).toBe(
    'confirmPassword-error'
  )
  expect(
    find(current, (node) => node.props.id === 'confirmPassword-error')?.props
      .message
  ).toBe('Passwords do not match.')
  primary.value = repeated.value
  ;(input(current, 'password').props.onInput as (event: unknown) => void)({
    currentTarget: primary,
  })
  current = render(component)
  expect(repeated.setCustomValidity).toHaveBeenLastCalledWith('')
  expect(
    input(current, 'confirmPassword').props['aria-invalid']
  ).toBeUndefined()
  expect(harness.fetch).not.toHaveBeenCalled()
})

describe('recovery availability guidance', () => {
  it.each([true, false, null])(
    'uses the actual %s capability without offering an unavailable reset',
    (recoveryEnabled) => {
      const html = renderToStaticMarkup(
        render(() =>
          ResetPasswordForm({ token: 'disposable-token', recoveryEnabled })
        )
      )
      expect(html).toContain('Back to sign in')
      if (recoveryEnabled === true) {
        expect(html).toContain('id="reset-password"')
        expect(html).toContain('Request a new reset link')
      } else {
        expect(html).not.toContain('id="reset-password"')
        expect(html).not.toContain('Request a new reset link')
        expect(html).toContain(
          recoveryEnabled === false
            ? 'Contact the person who provided or manages your account.'
            : 'Checking recovery options'
        )
        if (recoveryEnabled === null)
          expect(html).toContain('Check recovery options')
      }
    }
  )
  it('does not offer the request form when recovery is disabled', () => {
    const html = renderToStaticMarkup(
      render(() => ForgotPasswordForm({ recoveryEnabled: false }))
    )
    expect(html).not.toContain('Send reset link')
    expect(html).toContain(
      'Contact the person who provided or manages your account.'
    )
    expect(html).toContain('Back to sign in')
  })
})
