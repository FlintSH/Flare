import pkg from '@/package.json'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_CONFIG } from '@/lib/config'
import type { AgentPrincipal } from '@/lib/mcp/auth'
import { TOOL_NAMES, toolAllowed } from '@/lib/mcp/catalog'
import { mcpHandler } from '@/lib/mcp/server'
import { accountTools } from '@/lib/mcp/tools/account'
import { DEFAULT_PERMISSIONS, hasPermission } from '@/lib/permissions/catalog'

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  user: vi.fn(),
  profiles: vi.fn(),
}))
vi.mock('@/lib/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/config')>()),
  getConfig: mocks.config,
}))
vi.mock('@/lib/database/prisma', () => ({
  prisma: {
    user: { findUnique: mocks.user },
    uploadProfile: { findMany: mocks.profiles },
  },
}))

const MB = 1024 * 1024
const GB = 1024 * MB
const EVERY_SCOPE = [
  'files:upload',
  'files:read',
  'files:content',
  'files:organize',
  'files:share',
  'files:delete',
  'urls:read',
  'urls:write',
]

function principal(
  scopes: string[],
  permissions: readonly string[] = DEFAULT_PERMISSIONS,
  override: Partial<AgentPrincipal> = {}
): AgentPrincipal {
  return {
    user: {
      id: 'user-1',
      storageUsed: 7,
      urlId: 'alex',
      vanityId: null,
      permissions: [...permissions],
      roles: [
        {
          id: 'role-member',
          name: 'Member',
          description: '',
          color: '#000000',
          position: 10,
          systemKey: null,
          permissions: [...permissions],
        },
        {
          id: 'role-everyone',
          name: 'Everyone',
          description: '',
          color: '#000000',
          position: 0,
          systemKey: 'everyone',
          permissions: [],
        },
      ],
      randomizeFileUrls: true,
      credential: 'token',
      apiToken: { id: 't1', scopes: [...scopes, 'mcp'], profileId: null },
    },
    name: 'Alex',
    scopes,
    credentialKey: `token:${randomUUID()}`,
    can: (permission) => hasPermission({ permissions }, permission),
    ...override,
  }
}

/** One request through the real server, as a 2026-07-28 client sends it. */
async function rpc(
  who: AgentPrincipal,
  method: string,
  params: Record<string, unknown> = {}
) {
  const response = await mcpHandler().fetch(
    new Request('http://127.0.0.1:3000/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2026-07-28',
        'mcp-method': method,
        ...(method === 'tools/call' ? { 'mcp-name': String(params.name) } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientInfo': {
              name: 'test',
              version: '1',
            },
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    }),
    {
      authInfo: {
        token: '',
        clientId: who.credentialKey,
        scopes: [...who.scopes],
        extra: { principal: who },
      },
    }
  )
  return (await response.json()).result
}

type Account = {
  account: { id: string; name?: string; roles: string[] }
  instance: { url: string; version: string }
  connection: {
    scopes: string[]
    tools: string[]
    upload_profile?: { id: string; name?: string }
  }
  storage?: { used_bytes: number; quota_bytes?: number }
  uploads?: { max_file_bytes: number; remaining_bytes?: number }
  upload_profiles?: { id: string; name: string; default?: boolean }[]
}

/** `get_account` as the server answers it, checked against its output schema. */
async function getAccount(who: AgentPrincipal): Promise<Account> {
  const result = await rpc(who, 'tools/call', {
    name: 'get_account',
    arguments: {},
  })
  expect(result.isError, JSON.stringify(result.content)).toBeFalsy()
  const structured = result.structuredContent
  // The same answer as text, and nothing the output schema does not describe.
  expect(JSON.parse(result.content[0].text)).toEqual(structured)
  expect(accountTools[0].output.parse(structured)).toEqual(structured)
  return structured
}

let quotaGb: number | null
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXTAUTH_URL', 'https://files.example.com/')
  quotaGb = null
  mocks.config.mockImplementation(async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.settings.general.storage.maxUploadSize = { value: 250, unit: 'MB' }
    config.settings.general.storage.quotas = {
      enabled: quotaGb !== null,
      default: { value: quotaGb ?? 10, unit: 'GB' },
    }
    return config
  })
  mocks.user.mockResolvedValue({
    storageUsed: 1024,
    defaultUploadProfileId: 'profile-screens',
  })
  // Like the database, the list holds only the rows the filter names.
  mocks.profiles.mockImplementation(
    async ({ where }: { where: { id?: string } }) =>
      [
        { id: 'profile-private', name: 'Private' },
        { id: 'profile-screens', name: 'Screenshots' },
      ].filter((profile) => !where.id || profile.id === where.id)
  )
})
afterEach(() => vi.unstubAllEnvs())

describe('get_account', () => {
  it('needs no scope: any connection can ask who it acts as', async () => {
    const answer = await getAccount(principal([]))
    expect(answer).toEqual({
      account: { id: 'user-1', name: 'Alex', roles: ['Member', 'Everyone'] },
      instance: { url: 'https://files.example.com', version: pkg.version },
      connection: { scopes: [], tools: ['get_account'] },
    })
    expect(mocks.profiles).not.toHaveBeenCalled()
  })

  it('reads the account as the connection it serves', async () => {
    await getAccount(principal(['files:read']))
    expect(mocks.user).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'user-1' } })
    )
  })

  it('leaves out the name of an account that has none', async () => {
    const answer = await getAccount(principal([], [], { name: null }))
    expect(answer.account).toEqual({
      id: 'user-1',
      roles: ['Member', 'Everyone'],
    })
  })

  it('states the scopes the connection acts with, without the marker', async () => {
    const answer = await getAccount(principal(['urls:read', 'files:read']))
    expect(answer.connection.scopes).toEqual(['urls:read', 'files:read'])
    expect(answer.connection.scopes).not.toContain('mcp')
  })

  describe('storage', () => {
    it.each([['files:read'], ['files:upload'], ['files:read', 'files:upload']])(
      'is shown to a connection with %s whose role allows the same',
      async (...scopes) => {
        const answer = await getAccount(principal(scopes))
        expect(answer.storage).toEqual({ used_bytes: 1024 * MB })
      }
    )

    it.each([
      [[]],
      [['files:content']],
      [['files:organize', 'files:share', 'files:delete']],
      [['urls:read', 'urls:write']],
      [
        EVERY_SCOPE.filter(
          (scope) => !['files:read', 'files:upload'].includes(scope)
        ),
      ],
    ])(
      'is not shown to a connection with %j, whatever the role allows',
      async (scopes) => {
        for (const permissions of [DEFAULT_PERMISSIONS, ['administrator']]) {
          const answer = await getAccount(principal(scopes, permissions))
          expect(answer).not.toHaveProperty('storage')
          expect(JSON.stringify(answer)).not.toContain('used_bytes')
        }
      }
    )

    // A scope shows storage only while the role still allows what it is for.
    it.each<[string, string[], string[], boolean]>([
      [
        'is shown for files:read with files.read',
        ['files:read'],
        ['files.read'],
        true,
      ],
      [
        'is shown for files:upload with files.upload',
        ['files:upload'],
        ['files.upload'],
        true,
      ],
      [
        'is not shown for files:read without files.read',
        ['files:read'],
        ['files.upload'],
        false,
      ],
      [
        'is not shown for files:upload without files.upload',
        ['files:upload'],
        ['files.read'],
        false,
      ],
      [
        'is shown for both scopes with one of the permissions',
        ['files:read', 'files:upload'],
        ['files.upload'],
        true,
      ],
      [
        'is not shown for both scopes with neither permission',
        ['files:read', 'files:upload'],
        ['links.read', 'folders.manage'],
        false,
      ],
      [
        'is not shown for every scope and a role that allows nothing',
        EVERY_SCOPE,
        [],
        false,
      ],
      [
        'is shown for files:read and an administrator',
        ['files:read'],
        ['administrator'],
        true,
      ],
    ])('%s', async (_what, scopes, permissions, shown) => {
      const answer = await getAccount(principal(scopes, permissions))
      if (shown) expect(answer.storage).toEqual({ used_bytes: 1024 * MB })
      else {
        expect(answer).not.toHaveProperty('storage')
        expect(JSON.stringify(answer)).not.toContain('used_bytes')
      }
    })

    it('states the quota when the instance has one', async () => {
      quotaGb = 10
      const answer = await getAccount(principal(['files:read']))
      expect(answer.storage).toEqual({
        used_bytes: 1 * GB,
        quota_bytes: 10 * GB,
      })
    })

    it('states no quota for an account that bypasses it', async () => {
      quotaGb = 10
      const answer = await getAccount(
        principal(['files:read'], [...DEFAULT_PERMISSIONS, 'quotas.bypass'])
      )
      expect(answer.storage).toEqual({ used_bytes: 1 * GB })
    })

    it('reports what the account stores now, not what the credential last saw', async () => {
      mocks.user.mockResolvedValue({
        storageUsed: 2.5,
        defaultUploadProfileId: null,
      })
      expect((await getAccount(principal(['files:read']))).storage).toEqual({
        used_bytes: 2.5 * MB,
      })
      // An account row that cannot be read falls back to the credential's.
      mocks.user.mockResolvedValue(null)
      expect((await getAccount(principal(['files:read']))).storage).toEqual({
        used_bytes: 7 * MB,
      })
    })
  })

  describe('upload limits', () => {
    it('are shown to a connection with files:upload whose role may upload', async () => {
      const answer = await getAccount(principal(['files:upload']))
      expect(answer.uploads).toEqual({ max_file_bytes: 250 * MB })
      // The permission to upload is all the role needs for them.
      expect(
        (await getAccount(principal(['files:upload'], ['files.upload'])))
          .uploads
      ).toEqual({ max_file_bytes: 250 * MB })
    })

    it('are not shown to an account whose role may not upload, whatever the scopes', async () => {
      const cannotUpload = DEFAULT_PERMISSIONS.filter(
        (permission) => permission !== 'files.upload'
      )
      for (const scopes of [['files:upload'], EVERY_SCOPE]) {
        const answer = await getAccount(principal(scopes, cannotUpload))
        expect(answer).not.toHaveProperty('uploads')
        expect(answer.connection.tools).not.toContain('upload_file')
      }
      // Storage then rests on the scope and permission to view files alone.
      expect(
        await getAccount(principal(['files:upload'], cannotUpload))
      ).not.toHaveProperty('storage')
      expect(
        (await getAccount(principal(EVERY_SCOPE, cannotUpload))).storage
      ).toEqual({ used_bytes: 1024 * MB })
    })

    it.each([
      [[]],
      [['files:read']],
      [['files:read', 'files:content', 'urls:read']],
      [EVERY_SCOPE.filter((scope) => scope !== 'files:upload')],
    ])('are not shown to a connection with %j', async (scopes) => {
      const answer = await getAccount(principal(scopes))
      expect(answer).not.toHaveProperty('uploads')
      expect(JSON.stringify(answer)).not.toContain('max_file_bytes')
    })

    it('state what the quota has left', async () => {
      quotaGb = 10
      const answer = await getAccount(principal(['files:upload']))
      expect(answer.uploads).toEqual({
        max_file_bytes: 250 * MB,
        remaining_bytes: 9 * GB,
      })
    })

    it('state zero, not a negative number, for an account over its quota', async () => {
      quotaGb = 1
      mocks.user.mockResolvedValue({
        storageUsed: 2048,
        defaultUploadProfileId: null,
      })
      const answer = await getAccount(principal(['files:upload']))
      expect(answer.uploads?.remaining_bytes).toBe(0)
    })

    it('state no remaining amount without a quota', async () => {
      const answer = await getAccount(principal(['files:upload']))
      expect(answer.uploads).not.toHaveProperty('remaining_bytes')
    })
  })

  describe('upload profiles', () => {
    it('are listed for a connection with files:upload whose role manages profiles', async () => {
      const answer = await getAccount(principal(['files:upload']))
      expect(answer.upload_profiles).toEqual([
        { id: 'profile-private', name: 'Private' },
        { id: 'profile-screens', name: 'Screenshots', default: true },
      ])
      expect(mocks.profiles).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        orderBy: { name: 'asc' },
        // Names to pass as `profile`, never the settings they hold.
        select: { id: true, name: true },
      })
    })

    it('are an empty list for an account that has none', async () => {
      mocks.profiles.mockResolvedValue([])
      expect(
        (await getAccount(principal(['files:upload']))).upload_profiles
      ).toEqual([])
    })

    it('are not listed when the role does not manage profiles, as the profile list route refuses', async () => {
      const answer = await getAccount(
        principal(
          EVERY_SCOPE,
          DEFAULT_PERMISSIONS.filter(
            (permission) => permission !== 'uploadProfiles.manage'
          )
        )
      )
      expect(answer).not.toHaveProperty('upload_profiles')
      // The limits need only the scope and the permission to upload.
      expect(answer.uploads).toEqual({ max_file_bytes: 250 * MB })
      expect(mocks.profiles).not.toHaveBeenCalled()
    })

    it('are not listed for an account that manages profiles but may not upload', async () => {
      const answer = await getAccount(
        principal(
          EVERY_SCOPE,
          DEFAULT_PERMISSIONS.filter(
            (permission) => permission !== 'files.upload'
          )
        )
      )
      expect(answer).not.toHaveProperty('upload_profiles')
      expect(answer).not.toHaveProperty('uploads')
      expect(mocks.profiles).not.toHaveBeenCalled()
    })

    it('are listed with exactly the scope and the two permissions they need', async () => {
      const answer = await getAccount(
        principal(['files:upload'], ['files.upload', 'uploadProfiles.manage'])
      )
      expect(answer.upload_profiles).toHaveLength(2)
      expect(answer.uploads).toEqual({ max_file_bytes: 250 * MB })
    })

    it.each([
      [[]],
      [['files:read']],
      [EVERY_SCOPE.filter((scope) => scope !== 'files:upload')],
    ])(
      'are not listed for a connection with %j, whatever the role allows',
      async (scopes) => {
        const answer = await getAccount(principal(scopes, ['administrator']))
        expect(answer).not.toHaveProperty('upload_profiles')
        expect(mocks.profiles).not.toHaveBeenCalled()
      }
    )

    it('mark no default when the account has none', async () => {
      mocks.user.mockResolvedValue({
        storageUsed: 0,
        defaultUploadProfileId: null,
      })
      const answer = await getAccount(principal(['files:upload']))
      expect(answer.upload_profiles).toEqual([
        { id: 'profile-private', name: 'Private' },
        { id: 'profile-screens', name: 'Screenshots' },
      ])
    })
  })

  describe('a token bound to an upload profile', () => {
    const bound = (
      scopes: string[],
      permissions: readonly string[] = DEFAULT_PERMISSIONS,
      profileId = 'profile-screens'
    ) => {
      const who = principal(scopes, permissions)
      who.user.apiToken = { ...who.user.apiToken!, profileId }
      return who
    }

    it('names the profile every upload will use, and lists no other', async () => {
      const answer = await getAccount(bound(['files:upload']))
      expect(answer.connection.upload_profile).toEqual({
        id: 'profile-screens',
        name: 'Screenshots',
      })
      expect(answer.upload_profiles).toEqual([
        { id: 'profile-screens', name: 'Screenshots', default: true },
      ])
      expect(mocks.profiles).toHaveBeenCalledExactlyOnceWith({
        where: { userId: 'user-1', id: 'profile-screens' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      })
      expect(JSON.stringify(answer)).not.toContain('profile-private')
    })

    it('does not mark the bound profile as the default when the account has another', async () => {
      const answer = await getAccount(
        bound(['files:upload'], DEFAULT_PERMISSIONS, 'profile-private')
      )
      expect(answer.connection.upload_profile).toEqual({
        id: 'profile-private',
        name: 'Private',
      })
      expect(answer.upload_profiles).toEqual([
        { id: 'profile-private', name: 'Private' },
      ])
    })

    it.each<[string, string[], readonly string[]]>([
      [
        'whose role does not manage profiles',
        ['files:upload'],
        ['files.upload'],
      ],
      ['without the upload scope', ['files:read'], DEFAULT_PERMISSIONS],
      ['without any scope', [], DEFAULT_PERMISSIONS],
    ])(
      'still says it is bound, by ID alone, for a connection %s',
      async (_what, scopes, permissions) => {
        const answer = await getAccount(bound(scopes, permissions))
        // The binding is a fact about the token; the name is the list's to give.
        expect(answer.connection.upload_profile).toEqual({
          id: 'profile-screens',
        })
        expect(answer).not.toHaveProperty('upload_profiles')
        expect(mocks.profiles).not.toHaveBeenCalled()
      }
    )

    it('names a bound profile that no longer exists by its ID, and lists nothing', async () => {
      const answer = await getAccount(
        bound(['files:upload'], DEFAULT_PERMISSIONS, 'profile-deleted')
      )
      expect(answer.connection.upload_profile).toEqual({
        id: 'profile-deleted',
      })
      expect(answer.upload_profiles).toEqual([])
    })

    it('is not mentioned for a token that is not bound', async () => {
      const answer = await getAccount(principal(EVERY_SCOPE))
      expect(answer.connection).not.toHaveProperty('upload_profile')
      expect(Object.keys(answer.connection).sort()).toEqual(['scopes', 'tools'])
      expect(mocks.profiles).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ where: { userId: 'user-1' } })
      )
    })
  })

  describe('tools', () => {
    const cases: [string, string[], readonly string[]][] = [
      ['no scope', [], DEFAULT_PERMISSIONS],
      [
        'the read-only scopes',
        ['files:read', 'files:content', 'urls:read'],
        DEFAULT_PERMISSIONS,
      ],
      [
        'read and upload',
        ['files:read', 'files:content', 'urls:read', 'files:upload'],
        DEFAULT_PERMISSIONS,
      ],
      ['every scope', EVERY_SCOPE, DEFAULT_PERMISSIONS],
      [
        'every scope and a role that only views files',
        EVERY_SCOPE,
        ['files.read'],
      ],
      ['every scope and a role that allows nothing', EVERY_SCOPE, []],
      ['every scope and an administrator', EVERY_SCOPE, ['administrator']],
      [
        'organizing without the role permission to edit files',
        ['files:organize'],
        ['folders.manage', 'tags.manage'],
      ],
    ]

    it.each(cases)(
      'lists exactly the tools the connection may call, with %s',
      async (_what, scopes, permissions) => {
        const who = principal(scopes, permissions)
        const answer = await getAccount(who)
        // What the access rule allows, in the catalog's order.
        expect(answer.connection.tools).toEqual(
          TOOL_NAMES.filter((name) => toolAllowed(name, who))
        )
        // And exactly what the server offers the same connection.
        const listed: { name: string }[] = (await rpc(who, 'tools/list')).tools
        expect([...answer.connection.tools].sort()).toEqual(
          listed.map((tool) => tool.name).sort()
        )
      }
    )

    it('lists the seven read tools for the read-only scopes', async () => {
      const answer = await getAccount(
        principal(['files:read', 'files:content', 'urls:read'])
      )
      expect(answer.connection.tools).toEqual([
        'get_account',
        'search_files',
        'get_file',
        'read_file',
        'list_folders',
        'list_tags',
        'list_short_links',
      ])
    })

    it('always lists itself', async () => {
      expect((await getAccount(principal([], []))).connection.tools).toEqual([
        'get_account',
      ])
    })
  })

  describe('the instance', () => {
    it('is the public address links use, and the running version', async () => {
      const answer = await getAccount(principal([]))
      expect(answer.instance).toEqual({
        url: 'https://files.example.com',
        version: pkg.version,
      })
    })

    it("is the request's own address when no public address is set", async () => {
      vi.stubEnv('NEXTAUTH_URL', '')
      const answer = await getAccount(principal([]))
      expect(answer.instance.url).toBe('http://127.0.0.1:3000')
    })
  })

  it('holds nothing that identifies the credential or how the account signs in', async () => {
    const who = principal(EVERY_SCOPE)
    const text = JSON.stringify(await getAccount(who))
    expect(text).not.toContain(who.credentialKey)
    expect(text).not.toContain('"t1"')
    expect(text).not.toContain('urlId')
    expect(text).not.toContain('permissions')
  })
})

describe('the account tools', () => {
  it('are get_account alone, which takes no arguments', () => {
    expect(accountTools.map((tool) => tool.name)).toEqual(['get_account'])
    expect(accountTools[0].input.parse({})).toEqual({})
    expect(accountTools[0].description).toMatch(/Call it first/)
    expect(accountTools[0].description).not.toMatch(/[\u2013\u2014]/)
  })
})
