import type { Prisma } from '@prisma/client'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// The MCP endpoint never asks for a browser session; this proves it.
const session = vi.hoisted(() => ({ read: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  getAccessSession: session.read,
}))
// A passkey is registered here without an authenticator: the one check a
// real device answers is stood in for, and everything else is the library.
const webauthn = vi.hoisted(() => ({ verify: vi.fn() }))
vi.mock('@simplewebauthn/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@simplewebauthn/server')>()),
  verifyRegistrationResponse: webauthn.verify,
}))

const databaseUrl = process.env.FLARE_MCP_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

// Real queries; a full parallel run can take one past the 5 s default.
vi.setConfig({ testTimeout: 30_000 })

const ORIGIN = 'https://files.example.com'
const TRANSFER_PREFIX = `${ORIGIN}/api/mcp/transfer/`

/** A transfer URL of this instance: the fixed address, then a 43-character secret. */
const isTransferUrl = (url: string) =>
  url.startsWith(TRANSFER_PREFIX) &&
  /^[A-Za-z0-9_-]{43}$/.test(url.slice(TRANSFER_PREFIX.length))
const TOKEN = 'flr_database-suite-agent-token-0123456789abcdefghij'
const OTHER_TOKEN = 'flr_database-suite-other-token-0123456789abcdefghij'
const SCRIPT_TOKEN = 'flr_database-suite-script-token-0123456789abcdefghi'

suite.sequential('MCP against disposable PostgreSQL', () => {
  let prisma: typeof import('@/lib/database/prisma').prisma
  let auth: typeof import('@/lib/mcp/auth')
  let transfer: typeof import('@/lib/mcp/transfer')
  let settings: typeof import('@/lib/mcp/settings')
  let route: typeof import('@/app/api/mcp/route')
  let tokens: typeof import('@/lib/integrations/tokens')
  let config: typeof import('@/lib/config')
  let audit: typeof import('@/lib/audit')
  const events: Prisma.AuditEventCreateManyInput[] = []

  beforeAll(async () => {
    const url = new URL(databaseUrl!)
    // The suite's own database, or a numbered copy of it for a second checkout.
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !/^\/flare_mcp\d*_test$/.test(url.pathname)
    )
      throw new Error('Use the disposable local flare_mcp_test database')
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv('NEXTAUTH_URL', ORIGIN)
    vi.stubEnv(
      'NEXTAUTH_SECRET',
      'database-suite-session-secret-of-at-least-32-characters'
    )
    vi.stubEnv('FLARE_CORS_ORIGINS', '')
    prisma = (await import('@/lib/database/prisma')).prisma
    audit = await import('@/lib/audit')
    config = await import('@/lib/config')
    tokens = await import('@/lib/integrations/tokens')
    auth = await import('@/lib/mcp/auth')
    transfer = await import('@/lib/mcp/transfer')
    settings = await import('@/lib/mcp/settings')
    route = await import('@/app/api/mcp/route')
    audit.configureAuditWriter(async (event) => {
      events.push(event)
    })
  })

  beforeEach(async () => {
    await audit.auditSettled()
    session.read.mockClear()
    // Users take their tokens, files, folders, tags and transfers with them,
    // and the agents they signed in. Registered clients belong to nobody.
    await prisma.user.deleteMany()
    await prisma.oAuthClient.deleteMany()
    await prisma.authRateLimit.deleteMany()
    await prisma.role.deleteMany()
    await prisma.config.deleteMany()
    await prisma.event.deleteMany()
    await prisma.role.create({
      data: {
        name: 'Everyone',
        description: 'Base permissions for every account.',
        color: '#64748b',
        position: 0,
        systemKey: 'everyone',
        permissions: ['files.read', 'links.read'],
      },
    })
    for (const id of ['mcp-alex', 'mcp-sam'])
      await prisma.user.create({
        data: { id, name: id, urlId: id, uploadToken: `legacy-${id}` },
      })
    await prisma.apiToken.createMany({
      data: [
        {
          id: 'token-agent',
          userId: 'mcp-alex',
          name: 'Agent',
          hash: tokens.hashApiToken(TOKEN),
          scopes: ['files:read', 'files:content', 'mcp'],
        },
        {
          id: 'token-other',
          userId: 'mcp-alex',
          name: 'Second agent',
          hash: tokens.hashApiToken(OTHER_TOKEN),
          scopes: ['files:read', 'files:content', 'mcp'],
        },
        {
          id: 'token-script',
          userId: 'mcp-alex',
          name: 'Script',
          hash: tokens.hashApiToken(SCRIPT_TOKEN),
          scopes: ['files:read', 'files:upload'],
        },
      ],
    })
    events.length = 0
  })

  afterAll(async () => {
    await audit?.auditSettled()
    await prisma?.$disconnect()
    vi.unstubAllEnvs()
  })

  const bearer = (token: string, cookie?: string) =>
    new Request(`${ORIGIN}/api/mcp`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        ...(cookie ? { cookie } : {}),
      },
    })
  async function principalOf(token = TOKEN) {
    const principal = await auth.authenticateAgent(bearer(token))
    if (!principal) throw new Error('The fixture token did not authenticate')
    return principal
  }
  const secretOf = (url: string) => url.slice(url.lastIndexOf('/') + 1)
  const rowOf = (url: string) =>
    prisma.agentTransfer.findUniqueOrThrow({
      where: { secretHash: tokens.hashApiToken(secretOf(url)) },
    })
  const expire = (where: Prisma.AgentTransferWhereInput) =>
    prisma.agentTransfer.updateMany({
      where,
      data: { expiresAt: new Date(Date.now() - 1000) },
    })

  describe('authenticateAgent', () => {
    it('accepts a real token row that carries the marker, as its account and role', async () => {
      const principal = await principalOf()
      expect(principal.user).toMatchObject({
        id: 'mcp-alex',
        urlId: 'mcp-alex',
        credential: 'token',
        apiToken: {
          id: 'token-agent',
          scopes: ['files:read', 'files:content', 'mcp'],
          profileId: null,
        },
      })
      expect(principal.name).toBe('mcp-alex')
      expect(principal.scopes).toEqual(['files:read', 'files:content'])
      expect(principal.credentialKey).toBe('token:token-agent')
      // What the Everyone role in the database holds, and nothing more.
      expect(principal.can('files.read')).toBe(true)
      expect(principal.can('links.read')).toBe(true)
      expect(principal.can('files.delete')).toBe(false)
      expect(session.read).not.toHaveBeenCalled()
    })

    it('records the use on the token row', async () => {
      const before = new Date()
      await principalOf()
      const row = await prisma.apiToken.findUniqueOrThrow({
        where: { id: 'token-agent' },
      })
      expect(row.lastUsedAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000
      )
    })

    it('follows a role the account was given', async () => {
      await prisma.role.create({
        data: {
          name: 'Editors',
          position: 10,
          permissions: ['files.update', 'folders.manage'],
          users: { connect: { id: 'mcp-alex' } },
        },
      })
      const principal = await principalOf()
      expect(principal.can('files.update')).toBe(true)
      expect(principal.can('folders.manage')).toBe(true)
      expect(principal.can('files.read')).toBe(true)
      expect(principal.can('tags.manage')).toBe(false)
    })

    it.each([
      ['a token without the marker', SCRIPT_TOKEN],
      ['the legacy upload token', 'legacy-mcp-alex'],
      [
        'a token nobody issued',
        'flr_nobody-issued-this-token-0123456789abcdefghijk',
      ],
    ])('refuses %s, with or without a session cookie', async (_what, token) => {
      expect(await auth.authenticateAgent(bearer(token))).toBeNull()
      expect(
        await auth.authenticateAgent(
          bearer(token, 'next-auth.session-token=an-administrator')
        )
      ).toBeNull()
      expect(session.read).not.toHaveBeenCalled()
    })

    it('refuses the token once it is revoked or expired, and the transfers made for it', async () => {
      const principal = await principalOf()
      expect(
        await auth.credentialPrincipal(principal.credentialKey)
      ).not.toBeNull()
      await prisma.apiToken.update({
        where: { id: 'token-agent' },
        data: { revokedAt: new Date() },
      })
      expect(await auth.authenticateAgent(bearer(TOKEN))).toBeNull()
      expect(await auth.credentialPrincipal(principal.credentialKey)).toBeNull()

      await prisma.apiToken.update({
        where: { id: 'token-agent' },
        data: { revokedAt: null, expiresAt: new Date(Date.now() - 1000) },
      })
      expect(await auth.authenticateAgent(bearer(TOKEN))).toBeNull()
      expect(await auth.credentialPrincipal(principal.credentialKey)).toBeNull()
    })

    it('stops serving a credential whose marker was removed', async () => {
      const principal = await principalOf()
      await prisma.apiToken.update({
        where: { id: 'token-agent' },
        data: { scopes: ['files:read', 'files:content'] },
      })
      expect(await auth.authenticateAgent(bearer(TOKEN))).toBeNull()
      expect(await auth.credentialPrincipal(principal.credentialKey)).toBeNull()
    })
  })

  describe('transfer URLs', () => {
    it('store a digest of the secret, never the secret', async () => {
      const principal = await principalOf()
      const made = await transfer.createDownloadUrl(principal, ORIGIN, 'file-1')
      expect(isTransferUrl(made.url)).toBe(true)
      const secret = secretOf(made.url)
      const rows = await prisma.agentTransfer.findMany()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        userId: 'mcp-alex',
        credential: 'token:token-agent',
        kind: 'download',
        fileId: 'file-1',
        claimedAt: null,
        secretHash: tokens.hashApiToken(secret),
      })
      expect(JSON.stringify(rows)).not.toContain(secret)
      // Ten minutes for a download.
      const lifetime = rows[0].expiresAt.getTime() - Date.now()
      expect(lifetime).toBeGreaterThan(9 * 60_000)
      expect(lifetime).toBeLessThanOrEqual(10 * 60_000)
      expect(made.expires_at).toBe(rows[0].expiresAt.toISOString())
    })

    it('find a transfer by its secret, only as the kind it was made for and until it expires', async () => {
      const principal = await principalOf()
      const download = await transfer.createDownloadUrl(
        principal,
        ORIGIN,
        'file-1'
      )
      const upload = await transfer.createUploadUrl(principal, ORIGIN, {
        filename: 'notes.txt',
        options: { visibility: 'PRIVATE' },
        passwordHash: null,
      })
      const found = await transfer.findTransfer(
        secretOf(download.url),
        'download'
      )
      expect(found).toMatchObject({ kind: 'download', fileId: 'file-1' })
      expect(
        await transfer.findTransfer(secretOf(download.url), 'upload')
      ).toBeNull()

      const uploadRow = await transfer.findTransfer(
        secretOf(upload.url),
        'upload'
      )
      expect(uploadRow).toMatchObject({ kind: 'upload', fileId: null })
      expect(transfer.uploadOf(uploadRow!)).toEqual({
        filename: 'notes.txt',
        options: { visibility: 'PRIVATE' },
        passwordHash: null,
      })
      expect(
        await transfer.findTransfer(secretOf(upload.url), 'download')
      ).toBeNull()
      // Fifteen minutes for an upload to start.
      const lifetime = uploadRow!.expiresAt.getTime() - Date.now()
      expect(lifetime).toBeGreaterThan(14 * 60_000)
      expect(lifetime).toBeLessThanOrEqual(15 * 60_000)

      for (const wrong of [
        '',
        'short',
        `${secretOf(download.url)}x`,
        'A'.repeat(43),
        tokens.hashApiToken(secretOf(download.url)),
      ])
        expect(await transfer.findTransfer(wrong, 'download')).toBeNull()

      await expire({ id: found!.id })
      expect(
        await transfer.findTransfer(secretOf(download.url), 'download')
      ).toBeNull()
    })

    it('give an upload URL to exactly one of several simultaneous claims', async () => {
      const principal = await principalOf()
      for (let round = 0; round < 10; round++) {
        const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
          options: {},
        })
        const { id } = await rowOf(url)
        const claims = await Promise.all(
          Array.from({ length: 8 }, () => transfer.claimUpload(id))
        )
        expect(
          claims.filter(Boolean),
          `round ${round}: ${claims.join(', ')}`
        ).toHaveLength(1)
        expect((await rowOf(url)).claimedAt).toBeInstanceOf(Date)
        // Later claims are refused too.
        expect(await transfer.claimUpload(id)).toBe(false)
      }
    })

    it('give exactly one of two simultaneous claims the URL', async () => {
      const principal = await principalOf()
      const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      const { id } = await rowOf(url)
      const claims = await Promise.all([
        transfer.claimUpload(id),
        transfer.claimUpload(id),
      ])
      expect(claims.sort()).toEqual([false, true])
    })

    it('let a released upload URL be claimed again, once', async () => {
      const principal = await principalOf()
      const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      const { id } = await rowOf(url)
      expect(await transfer.claimUpload(id)).toBe(true)
      await transfer.releaseUpload(id)
      expect((await rowOf(url)).claimedAt).toBeNull()
      const again = await Promise.all([
        transfer.claimUpload(id),
        transfer.claimUpload(id),
        transfer.claimUpload(id),
      ])
      expect(again.filter(Boolean)).toHaveLength(1)
    })

    it('refuse to claim an expired upload URL, or one that does not exist', async () => {
      const principal = await principalOf()
      const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      const { id } = await rowOf(url)
      await expire({ id })
      expect(await transfer.claimUpload(id)).toBe(false)
      expect(await transfer.claimUpload('no-such-transfer')).toBe(false)
      // Releasing or using up something that is gone is not an error.
      await transfer.releaseUpload('no-such-transfer')
      await prisma.$transaction((tx) =>
        transfer.consumeUpload(tx, 'no-such-transfer')
      )
    })

    it('remove an upload URL with the transaction that publishes its file, or not at all', async () => {
      const principal = await principalOf()
      const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      const { id } = await rowOf(url)
      await transfer.claimUpload(id)
      // A publication that rolls back leaves the URL to be released.
      await expect(
        prisma.$transaction(async (tx) => {
          await transfer.consumeUpload(tx, id)
          throw new Error('publication failed')
        })
      ).rejects.toThrow('publication failed')
      expect((await rowOf(url)).claimedAt).toBeInstanceOf(Date)
      await transfer.releaseUpload(id)
      expect(await transfer.claimUpload(id)).toBe(true)

      // Published: the URL is gone with the same commit, so it names nothing
      // and no later request can claim it and publish a second file.
      await prisma.$transaction((tx) => transfer.consumeUpload(tx, id))
      expect(await prisma.agentTransfer.count()).toBe(0)
      expect(await transfer.findTransfer(secretOf(url), 'upload')).toBeNull()
      expect(await transfer.claimUpload(id)).toBe(false)
      // Releasing it afterwards, as a late failure path might, brings nothing back.
      await transfer.releaseUpload(id)
      expect(await prisma.agentTransfer.count()).toBe(0)
      expect(await transfer.claimUpload(id)).toBe(false)
    })

    it('let only the request that claimed an upload URL publish with it', async () => {
      const principal = await principalOf()
      const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      const { id } = await rowOf(url)
      // Two uploads arrive together; one wins the claim and publishes.
      const [first, second] = await Promise.all([
        transfer.claimUpload(id),
        transfer.claimUpload(id),
      ])
      expect([first, second].filter(Boolean)).toHaveLength(1)
      await prisma.$transaction((tx) => transfer.consumeUpload(tx, id))
      // The loser, retrying after the winner is done, finds no URL at all.
      expect(await transfer.findTransfer(secretOf(url), 'upload')).toBeNull()
      expect(await transfer.claimUpload(id)).toBe(false)
    })

    const LINKS_FULL = (cap: number) =>
      `This connection already has ${cap} download links waiting. Wait a few minutes for them to expire.`
    const UPLOADS_FULL = (cap: number) =>
      `This connection already has ${cap} upload URLs waiting. Use them, or wait: one that was never used expires 15 minutes after it was made, and one whose upload never finished after 24 hours.`

    it('refuse another download link once a credential has the most it may have waiting, and still make upload URLs', async () => {
      const principal = await principalOf()
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      // The number the design gives a credential.
      expect(cap).toBe(20)
      for (let made = 0; made < cap; made++)
        await transfer.createDownloadUrl(principal, ORIGIN, `file-${made}`)
      await expect(
        transfer.createDownloadUrl(principal, ORIGIN, 'one-too-many')
      ).rejects.toThrow(LINKS_FULL(cap))
      expect(await prisma.agentTransfer.count()).toBe(cap)

      // Uploads are counted apart: all twenty are still to be had.
      for (let made = 0; made < cap; made++)
        await transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      await expect(
        transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      ).rejects.toThrow(UPLOADS_FULL(cap))
      await expect(
        transfer.createDownloadUrl(principal, ORIGIN, 'one-too-many')
      ).rejects.toThrow(LINKS_FULL(cap))
      expect(
        await prisma.agentTransfer.groupBy({
          by: ['kind'],
          _count: true,
          orderBy: { kind: 'asc' },
        })
      ).toEqual([
        { kind: 'download', _count: cap },
        { kind: 'upload', _count: cap },
      ])

      // The cap is each credential's own: the account's other token is free.
      const other = await principalOf(OTHER_TOKEN)
      expect(other.credentialKey).toBe('token:token-other')
      await transfer.createDownloadUrl(other, ORIGIN, 'file-1')
      await transfer.createUploadUrl(other, ORIGIN, { options: {} })
      expect(
        await prisma.agentTransfer.count({
          where: { credential: 'token:token-other' },
        })
      ).toBe(2)
    })

    it('refuse another upload URL at the cap, and still make download links', async () => {
      const principal = await principalOf()
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      for (let made = 0; made < cap; made++)
        await transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      await expect(
        transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      ).rejects.toThrow(UPLOADS_FULL(cap))
      // Reading files is not held up by upload URLs that wait.
      const link = await transfer.createDownloadUrl(principal, ORIGIN, 'file-1')
      expect(
        await transfer.findTransfer(secretOf(link.url), 'download')
      ).not.toBeNull()
      expect(await prisma.agentTransfer.count()).toBe(cap + 1)
    })

    it('make room again as URLs are used up or expire, clearing the expired rows', async () => {
      const principal = await principalOf()
      const other = await principalOf(OTHER_TOKEN)
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      const urls: string[] = []
      for (let made = 0; made < cap; made++)
        urls.push(
          (await transfer.createUploadUrl(principal, ORIGIN, { options: {} }))
            .url
        )
      await transfer.createUploadUrl(other, ORIGIN, { options: {} })
      await expect(
        transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      ).rejects.toThrow(UPLOADS_FULL(cap))

      // An upload URL that published its file frees one place.
      const used = await rowOf(urls[0])
      await transfer.claimUpload(used.id)
      await prisma.$transaction((tx) => transfer.consumeUpload(tx, used.id))
      await transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      await expect(
        transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      ).rejects.toThrow(UPLOADS_FULL(cap))

      // Three expire, and so does the other credential's.
      const expired = await Promise.all(urls.slice(1, 4).map(rowOf))
      await expire({ id: { in: expired.map((row) => row.id) } })
      await expire({ credential: 'token:token-other' })
      await transfer.createUploadUrl(principal, ORIGIN, { options: {} })
      // Making one cleared this credential's expired rows, and only its own.
      expect(
        await prisma.agentTransfer.count({
          where: { id: { in: expired.map((row) => row.id) } },
        })
      ).toBe(0)
      expect(
        await prisma.agentTransfer.count({
          where: { credential: 'token:token-agent' },
        })
      ).toBe(cap - 2)
      expect(
        await prisma.agentTransfer.count({
          where: { credential: 'token:token-other' },
        })
      ).toBe(1)
    })

    it('clear expired URLs of both kinds when either kind is made', async () => {
      const principal = await principalOf()
      const link = await transfer.createDownloadUrl(principal, ORIGIN, 'old')
      const upload = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      await expire({ credential: 'token:token-agent' })
      await transfer.createDownloadUrl(principal, ORIGIN, 'new')
      expect(await prisma.agentTransfer.findMany()).toEqual([
        expect.objectContaining({ kind: 'download', fileId: 'new' }),
      ])
      expect(
        await transfer.findTransfer(secretOf(link.url), 'download')
      ).toBeNull()
      expect(
        await transfer.findTransfer(secretOf(upload.url), 'upload')
      ).toBeNull()
    })

    it('never go past the cap of either kind, however many are asked for at once', async () => {
      const principal = await principalOf()
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      // Thirty of each kind, interleaved.
      const asked = await Promise.allSettled(
        Array.from({ length: cap * 3 }, (_, index) =>
          index % 2
            ? transfer.createDownloadUrl(principal, ORIGIN, `file-${index}`)
            : transfer.createUploadUrl(principal, ORIGIN, { options: {} })
        )
      )
      const made = asked.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : []
      )
      const refused = asked.flatMap((result) =>
        result.status === 'rejected' ? [String(result.reason?.message)] : []
      )
      expect(made).toHaveLength(cap * 2)
      for (const kind of ['download', 'upload'])
        expect(
          await prisma.agentTransfer.count({ where: { kind } }),
          kind
        ).toBe(cap)
      // Every other call was refused for its cap, not by a lock or a timeout.
      expect(refused).toHaveLength(cap)
      expect(new Set(refused)).toEqual(
        new Set([LINKS_FULL(cap), UPLOADS_FULL(cap)])
      )
      // Each URL that was handed out names a row of its own.
      const rows = await Promise.all(made.map(({ url }) => rowOf(url)))
      expect(new Set(rows.map((row) => row.id)).size).toBe(cap * 2)
    })

    it('never go past the cap when sixty download links are asked for at once', async () => {
      const principal = await principalOf()
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      const asked = await Promise.allSettled(
        Array.from({ length: cap * 3 }, (_, index) =>
          transfer.createDownloadUrl(principal, ORIGIN, `file-${index}`)
        )
      )
      expect(
        asked.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(cap)
      expect(await prisma.agentTransfer.count()).toBe(cap)
      const reasons = new Set(
        asked.flatMap((result) =>
          result.status === 'rejected' ? [String(result.reason?.message)] : []
        )
      )
      expect(reasons).toEqual(new Set([LINKS_FULL(cap)]))
    })

    it('count each credential on its own when two ask at once', async () => {
      const principal = await principalOf()
      const other = await principalOf(OTHER_TOKEN)
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      const asked = await Promise.allSettled(
        Array.from({ length: cap * 3 }, (_, index) =>
          transfer.createDownloadUrl(
            index % 2 ? principal : other,
            ORIGIN,
            `file-${index}`
          )
        )
      )
      // Thirty calls each: twenty succeed for each credential.
      expect(
        asked.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(cap * 2)
      for (const credential of ['token:token-agent', 'token:token-other'])
        expect(
          await prisma.agentTransfer.count({ where: { credential } }),
          credential
        ).toBe(cap)
    })

    it('make room for exactly as many as expired when many are asked for at once', async () => {
      const principal = await principalOf()
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      for (let made = 0; made < cap; made++)
        await transfer.createDownloadUrl(principal, ORIGIN, `file-${made}`)
      const some = await prisma.agentTransfer.findMany({ take: 5 })
      await expire({ id: { in: some.map((row) => row.id) } })
      const asked = await Promise.allSettled(
        Array.from({ length: 15 }, (_, index) =>
          transfer.createDownloadUrl(principal, ORIGIN, `again-${index}`)
        )
      )
      expect(
        asked.filter((result) => result.status === 'fulfilled')
      ).toHaveLength(5)
      expect(await prisma.agentTransfer.count()).toBe(cap)
      expect(
        await prisma.agentTransfer.count({
          where: { id: { in: some.map((row) => row.id) } },
        })
      ).toBe(0)
    })

    it('delete expired transfers in the sweep, and nothing else', async () => {
      const principal = await principalOf()
      const other = await principalOf(OTHER_TOKEN)
      const kept = await transfer.createDownloadUrl(principal, ORIGIN, 'kept')
      const gone = [
        await transfer.createDownloadUrl(principal, ORIGIN, 'gone-1'),
        await transfer.createUploadUrl(principal, ORIGIN, { options: {} }),
        await transfer.createDownloadUrl(other, ORIGIN, 'gone-2'),
      ]
      const rows = await Promise.all(gone.map(({ url }) => rowOf(url)))
      await expire({ id: { in: rows.map((row) => row.id) } })

      expect(await transfer.deleteExpiredTransfers()).toBe(3)
      expect(await prisma.agentTransfer.findMany()).toEqual([
        expect.objectContaining({ fileId: 'kept' }),
      ])
      expect(await transfer.deleteExpiredTransfers()).toBe(0)
      expect(
        await transfer.findTransfer(secretOf(kept.url), 'download')
      ).not.toBeNull()

      // `now` decides what has expired: a row ending at that instant has.
      const { expiresAt } = await rowOf(kept.url)
      expect(
        await transfer.deleteExpiredTransfers(new Date(expiresAt.getTime() - 1))
      ).toBe(0)
      expect(await transfer.deleteExpiredTransfers(expiresAt)).toBe(1)
      expect(await prisma.agentTransfer.count()).toBe(0)
    })

    it('go with their account when it is deleted', async () => {
      const principal = await principalOf()
      await transfer.createDownloadUrl(principal, ORIGIN, 'file-1')
      const upload = await transfer.createUploadUrl(principal, ORIGIN, {
        options: {},
      })
      await prisma.agentTransfer.create({
        data: {
          secretHash: 'sam-digest',
          userId: 'mcp-sam',
          credential: 'token:sam',
          kind: 'download',
          fileId: 'sam-file',
          expiresAt: new Date(Date.now() + 60_000),
        },
      })
      expect(await prisma.agentTransfer.count()).toBe(3)

      await prisma.user.delete({ where: { id: 'mcp-alex' } })

      expect(await prisma.agentTransfer.findMany()).toEqual([
        expect.objectContaining({ userId: 'mcp-sam' }),
      ])
      expect(
        await transfer.findTransfer(secretOf(upload.url), 'upload')
      ).toBeNull()
      expect(await auth.credentialPrincipal(principal.credentialKey)).toBeNull()
    })
  })

  describe('the switch', () => {
    const save = (enabled: boolean | undefined) => {
      const value = structuredClone(config.DEFAULT_CONFIG) as {
        settings: { general: { mcp?: { enabled: boolean } } }
      }
      if (enabled === undefined) delete value.settings.general.mcp
      else value.settings.general.mcp = { enabled }
      return prisma.config.upsert({
        where: { key: 'flare_config' },
        create: { key: 'flare_config', value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      })
    }

    it('is off before any settings are saved', async () => {
      expect(await settings.mcpEnabled()).toBe(false)
    })

    it('is off for settings saved before MCP existed', async () => {
      await save(undefined)
      expect(await settings.mcpEnabled()).toBe(false)
    })

    it('follows the saved settings row, each change on the next read', async () => {
      await save(true)
      expect(await settings.mcpEnabled()).toBe(true)
      await save(false)
      expect(await settings.mcpEnabled()).toBe(false)
      await save(true)
      expect(await settings.mcpEnabled()).toBe(true)
    })
  })

  describe('end to end', () => {
    const enable = (enabled: boolean) => {
      const value = structuredClone(config.DEFAULT_CONFIG)
      value.settings.general.mcp.enabled = enabled
      return prisma.config.upsert({
        where: { key: 'flare_config' },
        create: { key: 'flare_config', value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      })
    }

    async function seedLibrary() {
      const folder = await prisma.vaultFolder.create({
        data: {
          userId: 'mcp-alex',
          name: 'Reports',
          normalizedName: 'reports',
        },
      })
      const tag = await prisma.vaultTag.create({
        data: {
          userId: 'mcp-alex',
          name: 'Invoice',
          normalizedName: 'invoice',
        },
      })
      const file = (
        id: string,
        userId: string,
        data: Partial<Prisma.FileUncheckedCreateInput>
      ) =>
        prisma.file.create({
          data: {
            id,
            userId,
            name: `${id}.txt`,
            urlPath: `/${userId}/${id}.txt`,
            mimeType: 'text/plain',
            size: 0.5,
            path: `uploads/${userId}/${id}/${id}.txt`,
            ...data,
          },
        })
      await file('alex-report', 'mcp-alex', {
        name: 'quarterly report.pdf',
        urlPath: '/mcp-alex/quarterly report.pdf',
        mimeType: 'application/pdf',
        visibility: 'PRIVATE',
        folderId: folder.id,
        uploadedAt: new Date('2026-11-03T10:00:00.000Z'),
        tags: { create: { tagId: tag.id } },
      })
      await file('alex-scan', 'mcp-alex', {
        name: 'scan.png',
        urlPath: '/mcp-alex/scan.png',
        mimeType: 'image/png',
        ocrText: 'Quarterly totals',
        isOcrProcessed: true,
        uploadedAt: new Date('2026-11-02T10:00:00.000Z'),
      })
      await file('alex-notes', 'mcp-alex', {
        uploadedAt: new Date('2026-11-01T10:00:00.000Z'),
      })
      await file('sam-report', 'mcp-sam', {
        name: 'quarterly report.pdf',
        urlPath: '/mcp-sam/quarterly report.pdf',
        mimeType: 'application/pdf',
      })
    }

    /** One tool call through the real route, as a 2026-07-28 client sends it. */
    async function callTool(
      name: string,
      args: Record<string, unknown>,
      token = TOKEN
    ) {
      const response = await route.POST(
        new Request(`${ORIGIN}/api/mcp`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2026-07-28',
            'mcp-method': 'tools/call',
            'mcp-name': name,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name,
              arguments: args,
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
        })
      )
      return {
        status: response.status,
        headers: response.headers,
        body: await response.json(),
      }
    }
    const names = (answer: {
      body: { result: { structuredContent: { files: { name: string }[] } } }
    }) => answer.body.result.structuredContent.files.map((file) => file.name)

    it('answers 404 until the saved settings turn MCP on, whatever the token', async () => {
      await seedLibrary()
      expect((await callTool('search_files', {})).status).toBe(404)
      await enable(false)
      expect((await callTool('search_files', {})).status).toBe(404)
      await enable(true)
      expect((await callTool('search_files', {})).status).toBe(200)
      await enable(false)
      expect((await callTool('search_files', {})).status).toBe(404)
    })

    it('refuses a token without the marker and the legacy upload token with 401', async () => {
      await enable(true)
      for (const token of [SCRIPT_TOKEN, 'legacy-mcp-alex']) {
        const answer = await callTool('search_files', {}, token)
        expect(answer.status).toBe(401)
        expect(answer.headers.get('www-authenticate')).toBe(
          // Both came with a bearer value, and it was refused.
          `Bearer error="invalid_token", resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`
        )
      }
      expect(session.read).not.toHaveBeenCalled()
    })

    it("searches the account's own files in the database, newest first", async () => {
      await enable(true)
      await seedLibrary()
      const all = await callTool('search_files', {})
      expect(all.status).toBe(200)
      expect(all.body.result.isError).toBeFalsy()
      expect(all.body.result.structuredContent.total).toBe(3)
      expect(names(all)).toEqual([
        'quarterly report.pdf',
        'scan.png',
        'alex-notes.txt',
      ])
      expect(all.body.result.structuredContent.files[0]).toEqual({
        id: 'alex-report',
        name: 'quarterly report.pdf',
        type: 'application/pdf',
        size_bytes: 524288,
        uploaded_at: '2026-11-03T10:00:00.000Z',
        visibility: 'private',
        url: `${ORIGIN}/mcp-alex/quarterly%20report.pdf`,
        folder: 'Reports',
        tags: ['Invoice'],
        views: 0,
        downloads: 0,
      })
    })

    it('filters by text, type, folder, tag, visibility and date against real rows', async () => {
      await enable(true)
      await seedLibrary()
      const search = async (args: Record<string, unknown>) =>
        names(await callTool('search_files', args))
      // The name, and the text read from an image.
      expect(await search({ query: 'quarterly' })).toEqual([
        'quarterly report.pdf',
        'scan.png',
      ])
      expect(await search({ type: 'image' })).toEqual(['scan.png'])
      expect(await search({ type: 'application/pdf' })).toEqual([
        'quarterly report.pdf',
      ])
      expect(await search({ type: 'video' })).toEqual([])
      expect(await search({ folder: 'Reports' })).toEqual([
        'quarterly report.pdf',
      ])
      expect(await search({ folder: 'none' })).toEqual([
        'scan.png',
        'alex-notes.txt',
      ])
      expect(await search({ tag: 'invoice' })).toEqual(['quarterly report.pdf'])
      expect(await search({ tag: 'none' })).toEqual([
        'scan.png',
        'alex-notes.txt',
      ])
      expect(await search({ visibility: 'private' })).toEqual([
        'quarterly report.pdf',
      ])
      expect(await search({ visibility: 'password' })).toEqual([])
      expect(
        await search({
          uploaded_after: '2026-11-02T00:00:00Z',
          uploaded_before: '2026-11-02T23:59:59Z',
        })
      ).toEqual(['scan.png'])
      expect(await search({ sort: 'oldest' })).toEqual([
        'alex-notes.txt',
        'scan.png',
        'quarterly report.pdf',
      ])
      expect(await search({ sort: 'name' })).toEqual([
        'alex-notes.txt',
        'quarterly report.pdf',
        'scan.png',
      ])
    })

    it('pages through real rows with a cursor', async () => {
      await enable(true)
      await seedLibrary()
      const first = await callTool('search_files', { limit: 2 })
      expect(names(first)).toEqual(['quarterly report.pdf', 'scan.png'])
      const { next_cursor } = first.body.result.structuredContent
      expect(next_cursor).toEqual(expect.any(String))
      const second = await callTool('search_files', {
        limit: 2,
        cursor: next_cursor,
      })
      expect(names(second)).toEqual(['alex-notes.txt'])
      expect(second.body.result.structuredContent).not.toHaveProperty(
        'next_cursor'
      )
    })

    it("gets one file by ID, share URL and path, and never another account's", async () => {
      await enable(true)
      await seedLibrary()
      for (const reference of [
        'alex-report',
        `${ORIGIN}/mcp-alex/quarterly%20report.pdf`,
        '/mcp-alex/quarterly report.pdf',
      ]) {
        const answer = await callTool('get_file', { file: reference })
        expect(answer.body.result.isError, reference).toBeFalsy()
        expect(answer.body.result.structuredContent.file).toMatchObject({
          id: 'alex-report',
          name: 'quarterly report.pdf',
          visibility: 'private',
          folder: 'Reports',
          tags: ['Invoice'],
          raw_url: `${ORIGIN}/mcp-alex/quarterly%20report.pdf/raw`,
          download_url: `${ORIGIN}/api/files/alex-report/download`,
        })
      }
      const scan = await callTool('get_file', { file: 'alex-scan' })
      expect(scan.body.result.structuredContent.file.image_text).toBe(
        'available'
      )
      expect(JSON.stringify(scan.body)).not.toContain('Quarterly totals')

      const theirs = await callTool('get_file', { file: 'sam-report' })
      const missing = await callTool('get_file', { file: 'no-such-file' })
      expect(theirs.body.result.isError).toBe(true)
      expect(theirs.body.result.content).toEqual([
        {
          type: 'text',
          text: 'No file of this account matches "sam-report". Use search_files to find it.',
        },
      ])
      expect(missing.body.result.content[0].text).toBe(
        theirs.body.result.content[0].text.replace('sam-report', 'no-such-file')
      )
      const byPath = await callTool('get_file', {
        file: '/mcp-sam/quarterly report.pdf',
      })
      expect(byPath.body.result.isError).toBe(true)
    })

    it('reads a file it cannot show as a download link the database holds', async () => {
      await enable(true)
      await seedLibrary()
      const answer = await callTool('read_file', { file: 'alex-report' })
      expect(answer.status).toBe(200)
      expect(answer.body.result.isError).toBeFalsy()
      // read_file answers in content blocks alone: its data is the first.
      expect(answer.body.result).not.toHaveProperty('structuredContent')
      expect(answer.body.result.content).toHaveLength(1)
      const data = JSON.parse(answer.body.result.content[0].text)
      expect(data).toMatchObject({
        id: 'alex-report',
        name: 'quarterly report.pdf',
        type: 'application/pdf',
        shown: 'nothing',
        note: 'Files of type application/pdf are not shown here. Use the download link.',
      })
      expect(isTransferUrl(data.download_url)).toBe(true)
      // The link is a row made for this token, and only its digest is stored.
      const row = await rowOf(data.download_url)
      expect(row).toMatchObject({
        userId: 'mcp-alex',
        credential: 'token:token-agent',
        kind: 'download',
        fileId: 'alex-report',
        claimedAt: null,
      })
      expect(data.download_url_expires_at).toBe(row.expiresAt.toISOString())
      expect(
        await transfer.findTransfer(secretOf(data.download_url), 'download')
      ).not.toBeNull()

      // Another account's file is refused, and no link is made for it.
      const theirs = await callTool('read_file', { file: 'sam-report' })
      expect(theirs.body.result.isError).toBe(true)
      expect(theirs.body.result.content[0].text).toBe(
        'No file of this account matches "sam-report". Use search_files to find it.'
      )
      expect(await prisma.agentTransfer.count()).toBe(1)
    })

    it('answers read_file without a link once twenty download links wait, and refuses one that is asked for', async () => {
      await enable(true)
      await seedLibrary()
      const cap = transfer.MAX_OUTSTANDING_TRANSFERS
      const principal = await principalOf()
      for (let made = 0; made < cap; made++)
        await transfer.createDownloadUrl(principal, ORIGIN, `file-${made}`)

      // A file that cannot be shown: the link is a courtesy, so it is skipped.
      const answer = await callTool('read_file', { file: 'alex-report' })
      expect(answer.body.result.isError).toBeFalsy()
      const data = JSON.parse(answer.body.result.content[0].text)
      expect(data).toMatchObject({
        id: 'alex-report',
        shown: 'nothing',
        note: `Files of type application/pdf are not shown here. This connection has ${cap} download links waiting, so none was made; call again with \`download_url: true\` in a few minutes.`,
      })
      expect(data).not.toHaveProperty('download_url')
      expect(await prisma.agentTransfer.count()).toBe(cap)

      // Asked for, the same link is a refusal the agent can read.
      events.length = 0
      const asked = await callTool('read_file', {
        file: 'alex-report',
        download_url: true,
      })
      expect(asked.body.result.isError).toBe(true)
      expect(asked.body.result.content).toEqual([
        {
          type: 'text',
          text: `This connection already has ${cap} download links waiting. Wait a few minutes for them to expire.`,
        },
      ])
      expect(await prisma.agentTransfer.count()).toBe(cap)
      await audit.auditSettled()
      expect(events.filter((event) => event.category === 'mcp')).toEqual([
        expect.objectContaining({
          action: 'mcp.read_file',
          outcome: 'failure',
          targetId: 'alex-report',
        }),
      ])

      // Once links expire, the courtesy link is back.
      await prisma.agentTransfer.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      })
      const later = await callTool('read_file', { file: 'alex-report' })
      expect(
        JSON.parse(later.body.result.content[0].text).download_url.startsWith(
          TRANSFER_PREFIX
        )
      ).toBe(true)
      expect(await prisma.agentTransfer.count()).toBe(1)
    })

    it('shows a pending expiry from the job table', async () => {
      await enable(true)
      await seedLibrary()
      const { scheduleFileExpiration } = await import('@/lib/files/expiry')
      const expiresAt = new Date(Date.now() + 86_400_000)
      // As the expiry route schedules it for the file's owner.
      await scheduleFileExpiration(
        { id: 'mcp-alex', permissions: ['files.update', 'files.share'] },
        'alex-notes',
        { expiresAt: expiresAt.toISOString(), action: 'SET_PRIVATE' }
      )
      const answer = await callTool('get_file', { file: 'alex-notes' })
      expect(answer.body.result.structuredContent.file).toMatchObject({
        expires_at: expiresAt.toISOString(),
        expiry_action: 'make_private',
      })
    })

    it('records each call in the audit log under the token that made it', async () => {
      await enable(true)
      await seedLibrary()
      events.length = 0
      await callTool('search_files', { query: 'quarterly' })
      await callTool('get_file', { file: 'alex-report' })
      await audit.auditSettled()
      const calls = events.filter((event) => event.category === 'mcp')
      expect(calls).toEqual([
        expect.objectContaining({
          action: 'mcp.search_files',
          outcome: 'success',
          actorId: 'mcp-alex',
          route: '/api/mcp',
          details: expect.objectContaining({ tokenId: 'token-agent' }),
        }),
        expect.objectContaining({
          action: 'mcp.get_file',
          outcome: 'success',
          actorId: 'mcp-alex',
          targetType: 'file',
          targetId: 'alex-report',
          details: expect.objectContaining({ tokenId: 'token-agent' }),
        }),
      ])
    })
  })

  describe('agent sign-in', () => {
    const REDIRECT = 'http://127.0.0.1:8976/callback'
    const RESOURCE = `${ORIGIN}/api/mcp`
    const MINUTE = 60_000
    const DAY = 24 * 60 * MINUTE
    const READ = ['files:read', 'files:content', 'urls:read']
    const administrator = (id: string) => ({
      id,
      permissions: ['administrator'],
    })

    let registerRoute: typeof import('@/app/api/oauth/register/route')
    let tokenRoute: typeof import('@/app/api/oauth/token/route')
    let revokeRoute: typeof import('@/app/api/oauth/revoke/route')
    let filesRoute: typeof import('@/app/api/files/route')
    let authorize: typeof import('@/lib/oauth/authorize')
    let cleanup: typeof import('@/lib/oauth/cleanup')
    let connections: typeof import('@/lib/oauth/connections')
    let security: typeof import('@/lib/auth/security/service')
    let credentials: typeof import('@/lib/users/credentials')
    let integrations: typeof import('@/lib/integrations/service')
    let locks: typeof import('@/lib/database/locks')
    let context: typeof import('@/lib/audit/context')

    beforeAll(async () => {
      registerRoute = await import('@/app/api/oauth/register/route')
      tokenRoute = await import('@/app/api/oauth/token/route')
      revokeRoute = await import('@/app/api/oauth/revoke/route')
      filesRoute = await import('@/app/api/files/route')
      authorize = await import('@/lib/oauth/authorize')
      cleanup = await import('@/lib/oauth/cleanup')
      connections = await import('@/lib/oauth/connections')
      security = await import('@/lib/auth/security/service')
      credentials = await import('@/lib/users/credentials')
      integrations = await import('@/lib/integrations/service')
      locks = await import('@/lib/database/locks')
      context = await import('@/lib/audit/context')
    })

    const enable = (enabled: boolean) => {
      const value = structuredClone(config.DEFAULT_CONFIG)
      value.settings.general.mcp.enabled = enabled
      return prisma.config.upsert({
        where: { key: 'flare_config' },
        create: { key: 'flare_config', value: value as Prisma.InputJsonValue },
        update: { value: value as Prisma.InputJsonValue },
      })
    }

    beforeEach(async () => {
      await enable(true)
      events.length = 0
    })

    type Pair = {
      access_token: string
      token_type: string
      expires_in: number
      refresh_token: string
      scope: string
    }

    async function register(
      body: Record<string, unknown> = {},
      address = '203.0.113.9'
    ) {
      const response = await registerRoute.POST(
        new Request(`${ORIGIN}/api/oauth/register`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-real-ip': address },
          body: JSON.stringify({
            client_name: 'Database suite client',
            redirect_uris: [REDIRECT],
            ...body,
          }),
        })
      )
      return { response, body: await response.json() }
    }
    const registered = async () => (await register()).body.client_id as string

    /** The person approves on the consent screen; the code comes back. */
    async function approve(
      clientId: string,
      {
        userId = 'mcp-alex',
        scopes = READ,
        verifier = 'v'.repeat(64),
      }: { userId?: string; scopes?: string[]; verifier?: string } = {}
    ) {
      const { createHash } = await import('node:crypto')
      const request = new Request(`${ORIGIN}/api/oauth/authorize`)
      const checked = await authorize.validateAuthorize(
        new URLSearchParams({
          response_type: 'code',
          client_id: clientId,
          redirect_uri: REDIRECT,
          code_challenge: createHash('sha256')
            .update(verifier)
            .digest('base64url'),
          code_challenge_method: 'S256',
          state: 'state-1',
          resource: RESOURCE,
        }),
        request
      )
      if (!('client' in checked))
        throw new Error('The authorize request was refused')
      // As a session of the version the account is on now.
      const { sessionVersion } = await prisma.user.findUniqueOrThrow({
        where: { id: userId },
      })
      const { redirect } = await authorize.decideConsent(
        { ...administrator(userId), sessionVersion },
        {
          request: authorize.signConsentRequest(checked, userId),
          decision: 'approve',
          scopes,
        },
        request
      )
      return new URL(redirect).searchParams.get('code')!
    }

    const form = (path: string, fields: Record<string, string>) =>
      new Request(`${ORIGIN}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields).toString(),
      })
    const redeem = (
      clientId: string,
      code: string,
      verifier = 'v'.repeat(64)
    ) =>
      tokenRoute.POST(
        form('/api/oauth/token', {
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: REDIRECT,
          code_verifier: verifier,
          resource: RESOURCE,
        })
      )
    const refresh = (
      clientId: string,
      refreshToken: string,
      extra: Record<string, string> = {}
    ) =>
      tokenRoute.POST(
        form('/api/oauth/token', {
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: refreshToken,
          ...extra,
        })
      )
    const revoke = (value: string) =>
      revokeRoute.POST(form('/api/oauth/revoke', { token: value }))

    /** A whole sign-in: register, approve, redeem. */
    async function connect(
      options: { userId?: string; scopes?: string[] } = {}
    ) {
      const clientId = await registered()
      const response = await redeem(clientId, await approve(clientId, options))
      expect(response.status).toBe(200)
      const pair: Pair = await response.json()
      const connection = await prisma.agentConnection.findFirstOrThrow({
        where: { clientId },
      })
      return { clientId, pair, connectionId: connection.id }
    }
    const refreshed = async (clientId: string, pair: Pair, extra = {}) => {
      const response = await refresh(clientId, pair.refresh_token, extra)
      expect(response.status).toBe(200)
      return (await response.json()) as Pair
    }
    const principalFor = (accessToken: string) =>
      auth.authenticateAgent(bearer(accessToken))
    const connectionRow = (id: string) =>
      prisma.agentConnection.findUniqueOrThrow({
        where: { id },
        include: { tokens: true },
      })
    const rotated = (pair: Pair, secondsAgo: number) =>
      prisma.agentToken.update({
        where: { refreshHash: tokens.hashApiToken(pair.refresh_token) },
        data: { rotatedAt: new Date(Date.now() - secondsAgo * 1000) },
      })
    const liveCount = (userId = 'mcp-alex') =>
      connections.countLiveConnections(prisma, userId)

    describe('registration', () => {
      it('stores the client, unused, and answers a public client', async () => {
        const { response, body } = await register({
          token_endpoint_auth_method: 'client_secret_post',
        })
        expect(response.status).toBe(201)
        expect(body.token_endpoint_auth_method).toBe('none')
        const row = await prisma.oAuthClient.findUniqueOrThrow({
          where: { id: body.client_id },
        })
        expect(row).toMatchObject({
          name: 'Database suite client',
          redirectUris: [REDIRECT],
          usedAt: null,
        })
      })

      it('counts registrations in the database: ten an hour per address and redirect host', async () => {
        for (let index = 0; index < 10; index++)
          expect((await register()).response.status).toBe(201)
        const eleventh = await register()
        expect(eleventh.response.status).toBe(429)
        expect(eleventh.body.error).toBe('temporarily_unavailable')
        expect(
          Number(eleventh.response.headers.get('retry-after'))
        ).toBeGreaterThan(0)
        expect(await prisma.oAuthClient.count()).toBe(10)
        // Another address, and another redirect host, have their own count.
        expect((await register({}, '198.51.100.7')).response.status).toBe(201)
        expect(
          (
            await register({
              redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
            })
          ).response.status
        ).toBe(201)
        // The table holds digests of the keys, never an address.
        const keys = await prisma.authRateLimit.findMany()
        expect(JSON.stringify(keys)).not.toContain('203.0.113.9')
      })

      it('never lets simultaneous registrations pass the limit together', async () => {
        const answers = await Promise.all(
          Array.from({ length: 25 }, () => register())
        )
        expect(
          answers.filter(({ response }) => response.status === 201)
        ).toHaveLength(10)
        expect(await prisma.oAuthClient.count()).toBe(10)
      })
    })

    describe('from consent to a working connection', () => {
      it('stores the code as a digest and marks the client used', async () => {
        const clientId = await registered()
        const code = await approve(clientId)
        const rows = await prisma.oAuthCode.findMany()
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          hash: tokens.hashApiToken(code),
          clientId,
          userId: 'mcp-alex',
          redirectUri: REDIRECT,
          resource: RESOURCE,
          scopes: READ,
          usedAt: null,
          connectionId: null,
        })
        expect(JSON.stringify(rows)).not.toContain(code)
        expect(rows[0].expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(
          60_000
        )
        expect(
          (
            await prisma.oAuthClient.findUniqueOrThrow({
              where: { id: clientId },
            })
          ).usedAt
        ).toBeInstanceOf(Date)
      })

      it('redeems the code for a connection whose access token works on /api/mcp', async () => {
        const { pair, connectionId, clientId } = await connect()
        expect(pair).toEqual({
          access_token: expect.stringMatching(/^fla_[A-Za-z0-9_-]{43}$/),
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: expect.stringMatching(/^flf_[A-Za-z0-9_-]{43}$/),
          scope: 'files:read files:content urls:read',
        })
        const row = await connectionRow(connectionId)
        expect(row).toMatchObject({
          userId: 'mcp-alex',
          clientId,
          clientName: 'Database suite client',
          redirectUri: REDIRECT,
          scopes: READ,
          revokedAt: null,
        })
        expect(row.tokens).toHaveLength(1)
        expect(row.tokens[0]).toMatchObject({
          accessHash: tokens.hashApiToken(pair.access_token),
          refreshHash: tokens.hashApiToken(pair.refresh_token),
          narrowed: false,
          rotatedAt: null,
          parentId: null,
        })
        // Nothing stored holds a secret.
        const stored = JSON.stringify([row, await prisma.oAuthCode.findMany()])
        expect(stored).not.toContain(pair.access_token)
        expect(stored).not.toContain(pair.refresh_token)

        const principal = await principalFor(pair.access_token)
        expect(principal).toMatchObject({
          name: 'mcp-alex',
          scopes: READ,
          credentialKey: `connection:${connectionId}`,
          user: {
            id: 'mcp-alex',
            credential: 'agent',
            agentConnection: { id: connectionId, scopes: READ },
          },
        })
        expect(session.read).not.toHaveBeenCalled()
        expect((await connectionRow(connectionId)).lastUsedAt).toBeInstanceOf(
          Date
        )
      })

      it('serves the tools the grant allows through the real endpoint, and no others', async () => {
        const { pair } = await connect()
        const response = await route.POST(
          new Request(`${ORIGIN}/api/mcp`, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${pair.access_token}`,
              'content-type': 'application/json',
              accept: 'application/json, text/event-stream',
              'mcp-protocol-version': '2025-11-25',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
            }),
          })
        )
        expect(response.status).toBe(200)
        const text = await response.text()
        const answer = JSON.parse(/^data: (.*)$/m.exec(text)?.[1] ?? text)
        // The Everyone role here reads files and links; the grant reads too.
        expect(
          answer.result.tools.map((tool: { name: string }) => tool.name)
        ).toEqual([
          'get_account',
          'search_files',
          'get_file',
          'read_file',
          'list_folders',
          'list_tags',
          'list_short_links',
        ])
      })

      it('is refused by the REST API: an access token works on the MCP endpoint only', async () => {
        const { pair } = await connect({
          scopes: ['files:read', 'files:upload', 'urls:read'],
        })
        for (const value of [pair.access_token, pair.refresh_token]) {
          const response = await filesRoute.GET(
            new Request(`${ORIGIN}/api/files`, {
              headers: { authorization: `Bearer ${value}` },
            })
          )
          expect(response.status).toBe(401)
          expect(await response.json()).toEqual({ error: 'Unauthorized' })
        }
        // The named token with the same reach is still served there.
        await prisma.apiToken.update({
          where: { id: 'token-script' },
          data: { scopes: ['files:read'] },
        })
        expect(
          (
            await filesRoute.GET(
              new Request(`${ORIGIN}/api/files`, {
                headers: { authorization: `Bearer ${SCRIPT_TOKEN}` },
              })
            )
          ).status
        ).toBe(200)
      })

      it('records the connection in the audit log with the account as actor and the client as its name', async () => {
        const { pair, connectionId } = await connect()
        await audit.auditSettled()
        const created = events.filter(
          (event) => event.action === 'agent_connection.create'
        )
        expect(created).toEqual([
          expect.objectContaining({
            category: 'authentication',
            outcome: 'success',
            actorId: 'mcp-alex',
            actorName: 'mcp-alex',
            targetType: 'agent_connection',
            targetId: connectionId,
            targetName: 'Database suite client',
            route: '/api/oauth/token',
          }),
        ])
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'oauth.token',
            outcome: 'success',
            actorId: 'mcp-alex',
            targetType: 'agent_connection',
            targetId: connectionId,
          })
        )
        // No token, code or digest of one is anywhere in the log.
        const logged = JSON.stringify(events)
        for (const secret of [
          pair.access_token,
          pair.refresh_token,
          tokens.hashApiToken(pair.access_token),
          tokens.hashApiToken(pair.refresh_token),
        ])
          expect(logged).not.toContain(secret)
        expect(logged).not.toMatch(/accessHash|refreshHash|codeChallenge/)
      })
    })

    describe('authorization codes', () => {
      it('gives exactly one of two simultaneous redemptions a connection, which the other then ends', async () => {
        const clientId = await registered()
        const code = await approve(clientId)
        const answers = await Promise.all([
          redeem(clientId, code),
          redeem(clientId, code),
        ])
        expect(answers.map(({ status }) => status).sort()).toEqual([200, 400])
        const loser = answers.find(({ status }) => status === 400)!
        expect((await loser.json()).error).toBe('invalid_grant')
        // One connection was made, not two, and the second presentation of
        // the code ended it: nobody can tell which request was the client's.
        const rows = await prisma.agentConnection.findMany({
          include: { tokens: true },
        })
        expect(rows).toHaveLength(1)
        expect(rows[0]).toMatchObject({
          revokedReason: 'code-reuse',
          tokens: [],
        })
        const winner: Pair = await answers
          .find(({ status }) => status === 200)!
          .json()
        expect(await principalFor(winner.access_token)).toBeNull()
      })

      it('gives exactly one of many simultaneous redemptions a connection', async () => {
        const clientId = await registered()
        const code = await approve(clientId)
        const answers = await Promise.all(
          Array.from({ length: 8 }, () => redeem(clientId, code))
        )
        expect(answers.filter(({ status }) => status === 200)).toHaveLength(1)
        expect(answers.filter(({ status }) => status === 400)).toHaveLength(7)
        expect(await prisma.agentConnection.count()).toBe(1)
        expect(await prisma.agentToken.count()).toBe(0)
      })

      it('ends the connection when the code comes back later, and records it as a denial', async () => {
        const clientId = await registered()
        const code = await approve(clientId)
        const pair: Pair = await (await redeem(clientId, code)).json()
        expect(await principalFor(pair.access_token)).not.toBeNull()
        events.length = 0
        const again = await redeem(clientId, code)
        expect(again.status).toBe(400)
        expect(await principalFor(pair.access_token)).toBeNull()
        expect((await refresh(clientId, pair.refresh_token)).status).toBe(400)
        const [row] = await prisma.agentConnection.findMany()
        expect(row.revokedReason).toBe('code-reuse')
        await audit.auditSettled()
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'oauth.token',
            outcome: 'denied',
            targetType: 'agent_connection',
            targetId: row.id,
            targetName: 'Database suite client',
          })
        )
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'agent_connection.updateMany',
            targetId: row.id,
            details: expect.objectContaining({
              after: expect.objectContaining({ revokedReason: 'code-reuse' }),
            }),
          })
        )
      })

      it('uses the code up on a wrong verifier, and makes nothing', async () => {
        const clientId = await registered()
        const code = await approve(clientId)
        expect((await redeem(clientId, code, 'w'.repeat(64))).status).toBe(400)
        expect((await redeem(clientId, code)).status).toBe(400)
        expect(await prisma.agentConnection.count()).toBe(0)
        expect(await prisma.agentToken.count()).toBe(0)
      })

      it('refuses a code after its minute', async () => {
        const clientId = await registered()
        const code = await approve(clientId)
        await prisma.oAuthCode.updateMany({
          data: { expiresAt: new Date(Date.now() - 1000) },
        })
        expect((await redeem(clientId, code)).status).toBe(400)
        expect(await prisma.agentConnection.count()).toBe(0)
      })

      it("refuses another client's code", async () => {
        const clientId = await registered()
        const other = await registered()
        const code = await approve(clientId)
        const response = await redeem(other, code)
        expect(response.status).toBe(400)
        expect((await response.json()).error).toBe('invalid_grant')
        expect(await prisma.agentConnection.count()).toBe(0)
      })

      it('holds an account to fifty live connections, however many codes were approved', async () => {
        const clientId = await registered()
        await prisma.oAuthClient.update({
          where: { id: clientId },
          data: { usedAt: new Date() },
        })
        for (let index = 0; index < 49; index++)
          await prisma.agentConnection.create({
            data: {
              userId: 'mcp-alex',
              clientId,
              clientName: 'Seeded',
              redirectUri: REDIRECT,
              scopes: ['files:read'],
              tokens: {
                create: {
                  accessHash: `access-${index}`,
                  accessExpiresAt: new Date(Date.now() + MINUTE),
                  refreshHash: `refresh-${index}`,
                  refreshExpiresAt: new Date(Date.now() + DAY),
                },
              },
            },
          })
        // Three codes approved while one place was left.
        const codes = [
          await approve(clientId),
          await approve(clientId),
          await approve(clientId),
        ]
        const answers = await Promise.all(
          codes.map((code) => redeem(clientId, code))
        )
        expect(answers.map(({ status }) => status).sort()).toEqual([
          200, 400, 400,
        ])
        expect(await liveCount()).toBe(50)
        // At the limit, the consent screen says so before making a code.
        await expect(approve(clientId)).rejects.toMatchObject({
          status: 400,
          message: expect.stringMatching(/already has 50 connected agents/),
        })
        // Another account is not held back by this one.
        expect(
          (
            await redeem(
              clientId,
              await approve(clientId, { userId: 'mcp-sam' })
            )
          ).status
        ).toBe(200)
      })
    })

    describe('refresh tokens', () => {
      it('rotates, and the new pair works while the old access token still does until it expires', async () => {
        const { clientId, pair, connectionId } = await connect()
        const next = await refreshed(clientId, pair)
        expect(next.refresh_token).not.toBe(pair.refresh_token)
        expect(next.scope).toBe('files:read files:content urls:read')
        expect(await principalFor(next.access_token)).not.toBeNull()
        expect(await principalFor(pair.access_token)).not.toBeNull()
        const row = await connectionRow(connectionId)
        expect(row.tokens).toHaveLength(2)
        const [first] = row.tokens.filter((token) => token.parentId === null)
        expect(first.rotatedAt).toBeInstanceOf(Date)
        expect(
          row.tokens.find((token) => token.parentId === first.id)
        ).toBeTruthy()
      })

      it('lets the predecessor work again within a minute, and both successors are valid', async () => {
        const { clientId, pair, connectionId } = await connect()
        const one = await refreshed(clientId, pair)
        await rotated(pair, 30)
        const two = await refreshed(clientId, pair)
        expect(two.refresh_token).not.toBe(one.refresh_token)
        for (const successor of [one, two]) {
          expect(await principalFor(successor.access_token)).not.toBeNull()
          await refreshed(clientId, successor)
        }
        expect((await connectionRow(connectionId)).revokedAt).toBeNull()
      })

      it('refuses a sixth successor, without ending the connection', async () => {
        const { clientId, pair, connectionId } = await connect()
        for (let index = 0; index < 5; index++) await refreshed(clientId, pair)
        const sixth = await refresh(clientId, pair.refresh_token)
        expect(sixth.status).toBe(400)
        expect((await sixth.json()).error).toBe('invalid_grant')
        const row = await connectionRow(connectionId)
        expect(row.revokedAt).toBeNull()
        expect(row.tokens).toHaveLength(6)
      })

      it('gives simultaneous refreshes of one token five successors between them, never more', async () => {
        const { clientId, pair, connectionId } = await connect()
        const answers = await Promise.all(
          Array.from({ length: 12 }, () =>
            refresh(clientId, pair.refresh_token)
          )
        )
        expect(answers.filter(({ status }) => status === 200)).toHaveLength(5)
        expect(answers.filter(({ status }) => status === 400)).toHaveLength(7)
        const row = await connectionRow(connectionId)
        expect(row.revokedAt).toBeNull()
        // The first pair and its five successors, each with its own secrets.
        expect(row.tokens).toHaveLength(6)
        const issued = await Promise.all(
          answers
            .filter(({ status }) => status === 200)
            .map((answer) => answer.json() as Promise<Pair>)
        )
        expect(new Set(issued.map((one) => one.refresh_token)).size).toBe(5)
        expect(new Set(issued.map((one) => one.access_token)).size).toBe(5)
        for (const one of issued)
          expect(await principalFor(one.access_token)).not.toBeNull()
      })

      it('gives each of two simultaneous refreshes of one token a pair that works', async () => {
        const { clientId, pair } = await connect()
        const answers = await Promise.all([
          refresh(clientId, pair.refresh_token),
          refresh(clientId, pair.refresh_token),
        ])
        expect(answers.map(({ status }) => status)).toEqual([200, 200])
        const [one, two]: Pair[] = await Promise.all(
          answers.map((answer) => answer.json())
        )
        expect(one.refresh_token).not.toBe(two.refresh_token)
        await refreshed(clientId, one)
        await refreshed(clientId, two)
      })

      it('issues a connection thirty pairs an hour, then answers 429 until the oldest is an hour old', async () => {
        const { clientId, pair, connectionId } = await connect()
        let newest = pair
        for (let index = 1; index < 30; index++)
          newest = await refreshed(clientId, newest)
        const refused = await refresh(clientId, newest.refresh_token)
        expect(refused.status).toBe(429)
        expect((await refused.json()).error).toBe('temporarily_unavailable')
        const retryAfter = Number(refused.headers.get('retry-after'))
        expect(retryAfter).toBeGreaterThan(3500)
        expect(retryAfter).toBeLessThanOrEqual(3600)
        // Nothing was issued, and the token it brought is still unused.
        let row = await connectionRow(connectionId)
        expect(row.revokedAt).toBeNull()
        expect(row.tokens).toHaveLength(30)
        const hash = tokens.hashApiToken(newest.refresh_token)
        expect(
          row.tokens.find((token) => token.refreshHash === hash)?.rotatedAt
        ).toBeNull()
        // The first pair turns an hour old: room for one, with the same token.
        await prisma.agentToken.update({
          where: { refreshHash: tokens.hashApiToken(pair.refresh_token) },
          data: { createdAt: new Date(Date.now() - 61 * 60_000) },
        })
        const next = await refreshed(clientId, newest)
        expect((await refresh(clientId, next.refresh_token)).status).toBe(429)
        row = await connectionRow(connectionId)
        expect(row.tokens).toHaveLength(31)
      })

      it('never passes thirty pairs an hour when tokens are used for the first time together', async () => {
        const { clientId, pair, connectionId } = await connect()
        // Five tokens nobody used yet: the successors the leeway gives one.
        const unused: Pair[] = []
        for (let index = 0; index < 5; index++)
          unused.push(await refreshed(clientId, pair))
        // One of them is refreshed on, down its chain, until two are left.
        for (let index = 6; index < 28; index++)
          unused[0] = await refreshed(clientId, unused[0])
        expect((await connectionRow(connectionId)).tokens).toHaveLength(28)
        const answers = await Promise.all(
          unused.map((one) => refresh(clientId, one.refresh_token))
        )
        expect(answers.filter(({ status }) => status === 200)).toHaveLength(2)
        expect(answers.filter(({ status }) => status === 429)).toHaveLength(3)
        const row = await connectionRow(connectionId)
        expect(row.revokedAt).toBeNull()
        expect(row.tokens).toHaveLength(30)
      })

      it('answers a retry at the limit whose first answer was lost, and never tells it to wait', async () => {
        const { clientId, pair, connectionId } = await connect()
        let held = pair
        for (let index = 2; index < 30; index++)
          held = await refreshed(clientId, held)
        // The hour's last pair is issued, and its answer never arrives.
        await refreshed(clientId, held)
        expect((await connectionRow(connectionId)).tokens).toHaveLength(30)
        // The client asks again with the token it still holds.
        const again = await refreshed(clientId, held)
        expect(await principalFor(again.access_token)).not.toBeNull()
        // What it got is held to the limit like any unused token.
        expect((await refresh(clientId, again.refresh_token)).status).toBe(429)
        // Simultaneous retries get what the leeway allows between them: five
        // successors in all, of which two exist. The rest are the leeway's
        // refusal, not a wait.
        const answers = await Promise.all(
          Array.from({ length: 6 }, () => refresh(clientId, held.refresh_token))
        )
        expect(answers.filter(({ status }) => status === 200)).toHaveLength(3)
        expect(answers.filter(({ status }) => status === 400)).toHaveLength(3)
        const row = await connectionRow(connectionId)
        expect(row.revokedAt).toBeNull()
        expect(row.tokens).toHaveLength(34)
      })

      it('treats a token used again after a minute as a replay: the connection and every pair end', async () => {
        const { clientId, pair, connectionId } = await connect()
        const one = await refreshed(clientId, pair)
        const two = await refreshed(clientId, one)
        await rotated(pair, 61)
        events.length = 0
        const replay = await refresh(clientId, pair.refresh_token)
        expect(replay.status).toBe(400)
        expect((await replay.json()).error).toBe('invalid_grant')
        const row = await connectionRow(connectionId)
        expect(row).toMatchObject({ revokedReason: 'replay', tokens: [] })
        expect(row.revokedAt).toBeInstanceOf(Date)
        for (const each of [pair, one, two]) {
          expect(await principalFor(each.access_token)).toBeNull()
          expect((await refresh(clientId, each.refresh_token)).status).toBe(400)
        }
        await audit.auditSettled()
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'oauth.token',
            category: 'authentication',
            outcome: 'denied',
            targetType: 'agent_connection',
            targetId: connectionId,
            targetName: 'Database suite client',
          })
        )
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'agent_connection.updateMany',
            category: 'authentication',
            targetId: connectionId,
            details: expect.objectContaining({
              after: expect.objectContaining({ revokedReason: 'replay' }),
            }),
          })
        )
        expect(JSON.stringify(events)).not.toContain(pair.refresh_token)
      })

      it('ends the connection once however many replays arrive together', async () => {
        const { clientId, pair, connectionId } = await connect()
        await refreshed(clientId, pair)
        await rotated(pair, 600)
        const answers = await Promise.all(
          Array.from({ length: 6 }, () => refresh(clientId, pair.refresh_token))
        )
        expect(answers.every(({ status }) => status === 400)).toBe(true)
        expect(await connectionRow(connectionId)).toMatchObject({
          revokedReason: 'replay',
          tokens: [],
        })
      })

      it('refuses the wrong client without using the token up', async () => {
        const { clientId, pair } = await connect()
        const other = await registered()
        const wrong = await refresh(other, pair.refresh_token)
        expect(wrong.status).toBe(400)
        expect((await wrong.json()).error).toBe('invalid_grant')
        await refreshed(clientId, pair)
      })

      it('narrows one pair with scope, which cannot be widened later, and leaves its sibling whole', async () => {
        const { clientId, pair, connectionId } = await connect()
        const narrow = await refreshed(clientId, pair, { scope: 'files:read' })
        const wide = await refreshed(clientId, pair)
        expect(narrow.scope).toBe('files:read')
        expect(wide.scope).toBe('files:read files:content urls:read')
        expect((await principalFor(narrow.access_token))!.scopes).toEqual([
          'files:read',
        ])
        expect((await principalFor(wide.access_token))!.scopes).toEqual(READ)
        const widened = await refresh(clientId, narrow.refresh_token, {
          scope: 'files:read files:content',
        })
        expect(widened.status).toBe(400)
        expect((await widened.json()).error).toBe('invalid_scope')
        // Refused before the token was used up: it still refreshes, narrow.
        const again = await refreshed(clientId, narrow)
        expect(again.scope).toBe('files:read')
        expect((await connectionRow(connectionId)).scopes).toEqual(READ)
      })

      it('applies an edit of the connection to the access tokens it already issued, at once', async () => {
        const { pair, connectionId } = await connect()
        expect((await principalFor(pair.access_token))!.scopes).toEqual(READ)
        await integrations.runIntegrationCommand(administrator('mcp-alex'), {
          action: 'update-agent',
          id: connectionId,
          scopes: ['files:read'],
        })
        const principal = await principalFor(pair.access_token)
        expect(principal!.scopes).toEqual(['files:read'])
        expect(principal!.user.agentConnection!.scopes).toEqual(['files:read'])
      })

      it('refuses a refresh token that expired, and one nobody issued', async () => {
        const { clientId, pair, connectionId } = await connect()
        await prisma.agentToken.updateMany({
          data: { refreshExpiresAt: new Date(Date.now() - 1000) },
        })
        expect((await refresh(clientId, pair.refresh_token)).status).toBe(400)
        expect((await refresh(clientId, `flf_${'x'.repeat(43)}`)).status).toBe(
          400
        )
        expect((await connectionRow(connectionId)).revokedAt).toBeNull()
      })
    })

    describe('revocation by the client (RFC 7009)', () => {
      it.each([
        ['its refresh token', (pair: Pair) => pair.refresh_token],
        ['its access token', (pair: Pair) => pair.access_token],
      ])(
        'ends the connection by %s, which stops authenticating at once',
        async (_what, pick) => {
          const { clientId, pair, connectionId } = await connect()
          const next = await refreshed(clientId, pair)
          const response = await revoke(pick(pair))
          expect(response.status).toBe(200)
          expect(await connectionRow(connectionId)).toMatchObject({
            revokedReason: 'revoked',
            tokens: [],
          })
          for (const each of [pair, next]) {
            expect(await principalFor(each.access_token)).toBeNull()
            expect((await refresh(clientId, each.refresh_token)).status).toBe(
              400
            )
          }
        }
      )

      it('answers 200 for tokens it does not know, and ends nothing', async () => {
        const { connectionId } = await connect()
        for (const value of [
          `flf_${'x'.repeat(43)}`,
          `fla_${'x'.repeat(43)}`,
          TOKEN,
          'legacy-mcp-alex',
        ])
          expect((await revoke(value)).status).toBe(200)
        expect((await connectionRow(connectionId)).revokedAt).toBeNull()
        // A named token is not this endpoint's to revoke.
        expect(await auth.authenticateAgent(bearer(TOKEN))).not.toBeNull()
      })
    })

    describe('disconnecting', () => {
      it('lists the connection on the integrations screen until it is disconnected', async () => {
        const { connectionId, pair } = await connect()
        await connect({ userId: 'mcp-sam' })
        const screen = await integrations.listIntegrations(
          administrator('mcp-alex')
        )
        expect(screen.connections).toEqual([
          {
            id: connectionId,
            clientName: 'Database suite client',
            returnsTo: REDIRECT,
            scopes: READ,
            createdAt: expect.any(Date),
            lastUsedAt: null,
          },
        ])
        events.length = 0
        await context.auditContext.run(
          { requestId: 'r', actorId: 'mcp-alex', actorName: 'mcp-alex' },
          () =>
            integrations.runIntegrationCommand(administrator('mcp-alex'), {
              action: 'disconnect-agent',
              id: connectionId,
            })
        )
        expect(await principalFor(pair.access_token)).toBeNull()
        expect(
          (await integrations.listIntegrations(administrator('mcp-alex')))
            .connections
        ).toEqual([])
        expect(await connectionRow(connectionId)).toMatchObject({
          revokedReason: 'disconnected',
          tokens: [],
        })
        // Sam's own connection is still there.
        expect(
          (await integrations.listIntegrations(administrator('mcp-sam')))
            .connections
        ).toHaveLength(1)
        expect(events).toEqual([
          expect.objectContaining({
            action: 'agent_connection.updateMany',
            category: 'authentication',
            actorId: 'mcp-alex',
            targetType: 'agent_connection',
            targetId: connectionId,
            targetName: 'Database suite client',
            details: expect.objectContaining({
              before: expect.objectContaining({ revokedAt: null }),
              after: expect.objectContaining({ revokedReason: 'disconnected' }),
            }),
          }),
        ])
      })

      it("refuses to disconnect or edit another account's connection", async () => {
        const { connectionId, pair } = await connect()
        for (const command of [
          { action: 'disconnect-agent', id: connectionId },
          { action: 'update-agent', id: connectionId, scopes: ['files:read'] },
        ])
          await expect(
            integrations.runIntegrationCommand(
              administrator('mcp-sam'),
              command
            )
          ).rejects.toMatchObject({
            status: 400,
            message: 'Agent not found or already disconnected.',
          })
        expect((await principalFor(pair.access_token))!.scopes).toEqual(READ)
      })

      it('takes the transfer URLs of a connection with it, and leaves the rest', async () => {
        const { connectionId, pair } = await connect()
        const principal = (await principalFor(pair.access_token))!
        const file = await prisma.file.create({
          data: {
            id: 'transfer-file',
            userId: 'mcp-alex',
            name: 'notes.txt',
            urlPath: '/mcp-alex/notes.txt',
            mimeType: 'text/plain',
            size: 0.1,
            path: 'uploads/mcp-alex/notes/notes.txt',
          },
        })
        const mine = await transfer.createDownloadUrl(
          principal,
          ORIGIN,
          file.id
        )
        const tokens_ = await transfer.createDownloadUrl(
          await principalOf(),
          ORIGIN,
          file.id
        )
        expect((await rowOf(mine.url)).credential).toBe(
          `connection:${connectionId}`
        )
        expect(
          await auth.credentialPrincipal(`connection:${connectionId}`)
        ).toMatchObject({ scopes: READ, user: { id: 'mcp-alex' } })
        await integrations.runIntegrationCommand(administrator('mcp-alex'), {
          action: 'disconnect-agent',
          id: connectionId,
        })
        expect(
          await auth.credentialPrincipal(`connection:${connectionId}`)
        ).toBeNull()
        expect(
          await prisma.agentTransfer.count({
            where: { credential: `connection:${connectionId}` },
          })
        ).toBe(0)
        // The named token's link is untouched.
        expect(await rowOf(tokens_.url)).toBeTruthy()
      })

      it('stops an upload from publishing once its connection is ended, as the transaction sees it', async () => {
        const { connectionId } = await connect({
          scopes: ['files:read', 'files:upload'],
        })
        const check = (scopes: string[]) =>
          prisma.$transaction((tx) =>
            connections.connectionHolds(tx, connectionId, scopes)
          )
        expect(await check(['files:upload'])).toBe(true)
        expect(await check(['files:upload', 'files:read'])).toBe(true)
        expect(await check(['files:delete'])).toBe(false)
        // Edited down while a file was arriving.
        await integrations.runIntegrationCommand(administrator('mcp-alex'), {
          action: 'update-agent',
          id: connectionId,
          scopes: ['files:read'],
        })
        expect(await check(['files:upload'])).toBe(false)
        expect(await check(['files:read'])).toBe(true)
        // Disconnected while a file was arriving.
        await integrations.runIntegrationCommand(administrator('mcp-alex'), {
          action: 'disconnect-agent',
          id: connectionId,
        })
        expect(await check(['files:read'])).toBe(false)
        expect(await check([])).toBe(false)
        expect(
          await prisma.$transaction((tx) =>
            connections.connectionHolds(tx, 'no-such-connection', [])
          )
        ).toBe(false)
      })
    })

    describe('signing out everywhere and credential changes', () => {
      const signOutEverywhere = (userId: string) =>
        prisma.$transaction((tx) => security.revokeSecuritySessions(tx, userId))

      it("ends every connection of the account with its sessions, and nobody else's", async () => {
        const first = await connect()
        const second = await connect({ scopes: ['files:read'] })
        const sams = await connect({ userId: 'mcp-sam' })
        // A sign-in in progress: approved, not yet redeemed.
        const pending = await approve(first.clientId)
        const before = await prisma.user.findUniqueOrThrow({
          where: { id: 'mcp-alex' },
        })
        events.length = 0
        const started = Date.now()
        await signOutEverywhere('mcp-alex')

        const after = await prisma.user.findUniqueOrThrow({
          where: { id: 'mcp-alex' },
        })
        expect(after.sessionVersion).toBe(before.sessionVersion + 1)
        for (const { pair, connectionId, clientId } of [first, second]) {
          const row = await connectionRow(connectionId)
          expect(row).toMatchObject({
            revokedReason: 'sessions-revoked',
            tokens: [],
          })
          // Written as Prisma writes times, whatever the session's time zone.
          expect(Math.abs(row.revokedAt!.getTime() - started)).toBeLessThan(
            30_000
          )
          expect(await principalFor(pair.access_token)).toBeNull()
          expect((await refresh(clientId, pair.refresh_token)).status).toBe(400)
        }
        // The sign-in in progress cannot finish afterwards.
        expect((await redeem(first.clientId, pending)).status).toBe(400)
        expect(
          await prisma.oAuthCode.count({ where: { userId: 'mcp-alex' } })
        ).toBe(0)
        expect(await liveCount()).toBe(0)

        // Another account keeps its agent.
        expect(await principalFor(sams.pair.access_token)).not.toBeNull()
        expect((await connectionRow(sams.connectionId)).revokedAt).toBeNull()
        // Named tokens are not sessions: theirs still works.
        expect(await auth.authenticateAgent(bearer(TOKEN))).not.toBeNull()

        await audit.auditSettled()
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'agent_connection.revokeAll',
            category: 'authentication',
            outcome: 'success',
            targetType: 'user',
            targetId: 'mcp-alex',
            details: expect.objectContaining({
              count: 2,
              reason: 'sessions-revoked',
            }),
          })
        )
      })

      it('records nothing about agents for an account that had none', async () => {
        await signOutEverywhere('mcp-alex')
        await audit.auditSettled()
        expect(
          events.filter((event) => event.action.startsWith('agent_connection'))
        ).toEqual([])
      })

      it('ends them in the same transaction: one that rolls back ends nothing', async () => {
        const { pair, connectionId, clientId } = await connect()
        const pending = await approve(clientId)
        events.length = 0
        await expect(
          prisma.$transaction(async (tx) => {
            await security.revokeSecuritySessions(tx, 'mcp-alex')
            // Inside, both are already gone.
            expect(
              await tx.agentConnection.count({
                where: { userId: 'mcp-alex', revokedAt: null },
              })
            ).toBe(0)
            expect(await tx.oAuthCode.count()).toBe(0)
            throw new Error('the sign-out failed after all')
          })
        ).rejects.toThrow('the sign-out failed after all')
        expect(await connectionRow(connectionId)).toMatchObject({
          revokedAt: null,
          revokedReason: null,
        })
        expect(await principalFor(pair.access_token)).not.toBeNull()
        expect((await redeem(clientId, pending)).status).toBe(200)
        // And no event claims a revocation that did not happen.
        await audit.auditSettled()
        expect(
          events.filter(
            (event) => event.action === 'agent_connection.revokeAll'
          )
        ).toEqual([])
      })

      it.each([
        ['a new password', { password: 'a-new-bcrypt-hash' }],
        [
          'a new sign-in address',
          { email: { address: 'alex-new@example.test', verified: false } },
        ],
      ])(
        'ends them with %s, in the update that saves it',
        async (_what, change) => {
          const { pair, connectionId } = await connect()
          const sams = await connect({ userId: 'mcp-sam' })
          await prisma.$transaction(async (tx) => {
            await locks.lockUserRow(tx, 'mcp-alex')
            await tx.user.update({
              where: { id: 'mcp-alex' },
              data: await credentials.changeCredentials(tx, 'mcp-alex', change),
            })
          })
          expect(await connectionRow(connectionId)).toMatchObject({
            revokedReason: 'sessions-revoked',
            tokens: [],
          })
          expect(await principalFor(pair.access_token)).toBeNull()
          expect(await principalFor(sams.pair.access_token)).not.toBeNull()
        }
      )

      it('leaves no live connection behind when a sign-in finishes at the same moment', async () => {
        // Whichever goes first, the other sees it: the code is gone before
        // it is redeemed, or the connection it made is ended.
        for (let round = 0; round < 6; round++) {
          const clientId = await registered()
          const code = await approve(clientId)
          const [redeemed] = await Promise.all(
            round % 2
              ? [redeem(clientId, code), signOutEverywhere('mcp-alex')]
              : [
                  new Promise<Response>((resolve) =>
                    setImmediate(() => resolve(redeem(clientId, code)))
                  ),
                  signOutEverywhere('mcp-alex'),
                ]
          )
          expect([200, 400]).toContain(redeemed.status)
          expect(await liveCount(), `round ${round}`).toBe(0)
          if (redeemed.status === 200) {
            const pair: Pair = await redeemed.json()
            expect(await principalFor(pair.access_token)).toBeNull()
          }
          await prisma.authRateLimit.deleteMany()
        }
      })

      it('goes with the account when it is deleted', async () => {
        const { pair, clientId } = await connect()
        await approve(clientId)
        await prisma.user.delete({ where: { id: 'mcp-alex' } })
        expect(await prisma.agentConnection.count()).toBe(0)
        expect(await prisma.agentToken.count()).toBe(0)
        expect(await prisma.oAuthCode.count()).toBe(0)
        expect(await principalFor(pair.access_token)).toBeNull()
        // The registration stays: it belongs to the client, not the account.
        expect(await prisma.oAuthClient.count()).toBe(1)
      })
    })

    describe("what ends an account's agents", () => {
      const PASSWORD = 'correct test password'
      const ADDRESS = 'alex@example.test'
      let sessions: typeof import('@/lib/auth/sessions')
      let totp: typeof import('@/lib/auth/security/crypto')
      let passkeys: typeof import('@/lib/auth/security/passkeys')
      let requiredPasskeys: typeof import('@/lib/auth/security/required-passkeys')
      let accounts: typeof import('@/lib/users/update-account')
      let emailAccount: typeof import('@/lib/email/account')
      let emailTokens: typeof import('@/lib/email/tokens')
      let emailConfig: typeof import('@/lib/email/config')
      let emailSettings: import('@/lib/email/schema').EmailConfig
      let signOutRoute: typeof import('@/app/api/users/[id]/sessions/route')
      let passwordHash: string

      beforeAll(async () => {
        sessions = await import('@/lib/auth/sessions')
        totp = await import('@/lib/auth/security/crypto')
        passkeys = await import('@/lib/auth/security/passkeys')
        requiredPasskeys = await import('@/lib/auth/security/required-passkeys')
        accounts = await import('@/lib/users/update-account')
        emailAccount = await import('@/lib/email/account')
        emailTokens = await import('@/lib/email/tokens')
        emailConfig = await import('@/lib/email/config')
        signOutRoute = await import('@/app/api/users/[id]/sessions/route')
        const { DEFAULT_EMAIL_CONFIG } = await import('@/lib/email/schema')
        emailSettings = {
          ...structuredClone(DEFAULT_EMAIL_CONFIG),
          enabled: true,
          publicUrl: ORIGIN,
          fromAddress: 'flare@example.test',
        }
        emailSettings.recovery.enabled = true
        emailSettings.changes.enabled = true
        passwordHash = await (await import('bcryptjs')).hash(PASSWORD, 4)
      })

      beforeEach(async () => {
        // Accounts that sign in with a password and a confirmed address, and
        // an administrator beside them.
        const verified = (address: string) => ({
          email: address,
          password: passwordHash,
          emailVerified: new Date(),
          emailVerifiedFor: address,
          emailVerificationSource: 'email',
        })
        await prisma.user.update({
          where: { id: 'mcp-alex' },
          data: verified(ADDRESS),
        })
        await prisma.user.update({
          where: { id: 'mcp-sam' },
          data: verified('sam@example.test'),
        })
        await prisma.role.create({
          data: {
            name: 'Administrators',
            position: 100,
            permissions: ['administrator'],
            users: { connect: { id: 'mcp-sam' } },
          },
        })
      })

      /** A session of the account as it stands, signed in a moment ago. */
      async function sessionOf(
        method = 'passkey'
      ): Promise<import('next-auth').Session> {
        const user = await prisma.user.findUniqueOrThrow({
          where: { id: 'mcp-alex' },
        })
        return {
          expires: new Date(Date.now() + 3_600_000).toISOString(),
          user: {
            id: user.id,
            name: user.name ?? '',
            email: user.email ?? '',
            image: null,
            roles: [],
            permissions: [],
            sessionVersion: user.sessionVersion,
            authMethod: method,
            authTime: Date.now(),
          },
        }
      }
      /** The same, with a browser session behind it, as the sessions list needs. */
      async function trackedSession() {
        const session = await sessionOf('credentials')
        const record = await sessions.createBrowserSession(
          'mcp-alex',
          session.user.sessionVersion!,
          'credentials',
          { ipAddress: '192.0.2.10', userAgent: 'Suite browser' }
        )
        session.user.sessionId = record.id
        return session
      }
      const addPasskey = (id = 'a-passkey') =>
        prisma.passkey.create({
          data: {
            id,
            userId: 'mcp-alex',
            name: id,
            publicKey: new Uint8Array([1]),
            counter: 0,
            transports: [],
          },
        })
      async function turnAuthenticatorOn() {
        const setup = await security.setupTotp(await sessionOf(), {})
        await security.enableTotp(
          await sessionOf(),
          totp.createTotp(setup.secret).generate(),
          setup.challengeId
        )
      }
      async function requirePasskeys() {
        await addPasskey()
        await prisma.user.update({
          where: { id: 'mcp-alex' },
          data: { passkeyRequired: true },
        })
      }
      /** Runs an emailed-link action with account email turned on. */
      async function withEmail<T>(run: () => Promise<T>): Promise<T> {
        const spies = [
          vi
            .spyOn(emailConfig, 'getEmailConfig')
            .mockResolvedValue(emailSettings),
          vi
            .spyOn(emailConfig, 'getEmailConfigForUpdate')
            .mockResolvedValue(emailSettings),
        ]
        try {
          return await run()
        } finally {
          for (const spy of spies) spy.mockRestore()
        }
      }
      const emailedLink = async (purpose: 'reset' | 'change', email: string) =>
        (
          await prisma.$transaction((tx) =>
            emailTokens.issueEmailToken(tx, {
              userId: 'mcp-alex',
              email,
              purpose,
              expiresAt: new Date(Date.now() + 10 * MINUTE),
            })
          )
        ).token
      const editAccount = async (
        edit: import('@/lib/users/update-account').AccountEdit,
        kind: 'self' | 'administrator'
      ) => {
        const seen = await prisma.user.findUniqueOrThrow({
          where: { id: 'mcp-alex' },
        })
        return prisma.$transaction((tx) =>
          accounts.updateAccount(
            tx,
            seen,
            edit,
            { kind, emailEnabled: false },
            { id: true }
          )
        )
      }

      type Action = {
        name: string
        /** What has to be so before the agents sign in. */
        arrange?: () => Promise<unknown>
        act: () => Promise<unknown>
      }

      // Each caller of the one place that moves an account's session version
      // on, driven as the app drives it.
      const ending: Action[] = [
        {
          name: 'signing out everywhere',
          act: async () =>
            sessions.revokeBrowserSessions(await trackedSession()),
        },
        {
          name: 'an administrator signing the account out',
          act: async () => {
            session.read.mockResolvedValueOnce({
              user: { id: 'mcp-sam', permissions: ['administrator'] },
            } as never)
            const response = await signOutRoute.DELETE(
              new Request(`${ORIGIN}/api/users/mcp-alex/sessions`, {
                method: 'DELETE',
              }),
              { params: Promise.resolve({ id: 'mcp-alex' }) }
            )
            expect(response.status).toBe(204)
          },
        },
        {
          name: 'changing the password in the profile',
          act: () => editAccount({ password: 'a-new-bcrypt-hash' }, 'self'),
        },
        {
          name: 'an administrator setting a new password',
          act: () =>
            editAccount({ password: 'another-bcrypt-hash' }, 'administrator'),
        },
        {
          name: 'resetting the password from an emailed link',
          act: async () => {
            const token = await emailedLink('reset', ADDRESS)
            await withEmail(() =>
              emailAccount.resetPassword(
                token,
                'a new password for alex',
                emailSettings
              )
            )
          },
        },
        {
          name: 'an administrator setting a new sign-in address',
          act: () =>
            editAccount({ email: 'alex-moved@example.test' }, 'administrator'),
        },
        {
          name: 'confirming a new sign-in address from an emailed link',
          arrange: () =>
            prisma.user.update({
              where: { id: 'mcp-alex' },
              data: { pendingEmail: 'alex-new@example.test' },
            }),
          act: async () => {
            const token = await emailedLink('change', 'alex-new@example.test')
            await withEmail(() =>
              emailAccount.confirmEmailToken(token, emailSettings)
            )
            expect(
              (
                await prisma.user.findUniqueOrThrow({
                  where: { id: 'mcp-alex' },
                })
              ).email
            ).toBe('alex-new@example.test')
          },
        },
        { name: 'turning the authenticator on', act: turnAuthenticatorOn },
        {
          name: 'replacing the authenticator recovery codes',
          arrange: turnAuthenticatorOn,
          act: async () => security.changeTotp(await sessionOf(), {}, false),
        },
        {
          name: 'turning the authenticator off',
          arrange: turnAuthenticatorOn,
          act: async () => security.changeTotp(await sessionOf(), {}, true),
        },
        {
          name: 'adding a passkey',
          act: async () => {
            const { challengeId } = await passkeys.registrationOptions(
              await sessionOf(),
              {},
              'Laptop'
            )
            webauthn.verify.mockResolvedValueOnce({
              verified: true,
              registrationInfo: {
                credential: {
                  id: 'new-passkey',
                  publicKey: new Uint8Array([1, 2, 3]),
                  counter: 0,
                  transports: ['internal'],
                },
              },
            })
            await passkeys.registerPasskey(
              await sessionOf(),
              challengeId,
              {} as never
            )
            expect(await prisma.passkey.count()).toBe(1)
          },
        },
        {
          name: 'removing a passkey',
          arrange: addPasskey,
          act: async () =>
            passkeys.changePasskey(await sessionOf(), 'a-passkey', {}),
        },
        {
          name: 'requiring passkeys to sign in',
          arrange: addPasskey,
          act: async () =>
            requiredPasskeys.setPasskeyRequired(await sessionOf(), true),
        },
        {
          name: 'no longer requiring passkeys',
          arrange: requirePasskeys,
          act: async () =>
            requiredPasskeys.setPasskeyRequired(await sessionOf(), false),
        },
        {
          name: 'replacing passkey recovery codes',
          arrange: requirePasskeys,
          act: async () =>
            requiredPasskeys.rotatePasskeyRecoveryCodes(await sessionOf()),
        },
      ]

      it.each(ending)(
        '$name ends them, and the sign-ins in progress',
        async ({ arrange, act }) => {
          await arrange?.()
          const mine = await connect()
          const second = await connect({ scopes: ['files:read'] })
          const sams = await connect({ userId: 'mcp-sam' })
          const pending = await approve(mine.clientId)
          const before = await prisma.user.findUniqueOrThrow({
            where: { id: 'mcp-alex' },
          })
          events.length = 0

          await act()

          for (const agent of [mine, second]) {
            expect(await principalFor(agent.pair.access_token)).toBeNull()
            expect(await connectionRow(agent.connectionId)).toMatchObject({
              revokedReason: 'sessions-revoked',
              tokens: [],
            })
            expect(
              (await refresh(agent.clientId, agent.pair.refresh_token)).status
            ).toBe(400)
          }
          expect((await redeem(mine.clientId, pending)).status).toBe(400)
          // With the sessions: the same change moved the session version on.
          expect(
            (
              await prisma.user.findUniqueOrThrow({
                where: { id: 'mcp-alex' },
              })
            ).sessionVersion
          ).toBe(before.sessionVersion + 1)
          // Another account's agent is no business of this one's.
          expect(await principalFor(sams.pair.access_token)).not.toBeNull()
          // And the log says how many ended, and why.
          await audit.auditSettled()
          expect(events).toContainEqual(
            expect.objectContaining({
              action: 'agent_connection.revokeAll',
              category: 'authentication',
              targetType: 'user',
              targetId: 'mcp-alex',
              details: expect.objectContaining({
                count: 2,
                reason: 'sessions-revoked',
              }),
            })
          )
        }
      )

      const keeping: Action[] = [
        {
          name: 'signing out one session',
          act: async () => {
            const session = await trackedSession()
            const other = await sessions.createBrowserSession(
              'mcp-alex',
              session.user.sessionVersion!,
              'credentials',
              { ipAddress: '192.0.2.11', userAgent: 'Another browser' }
            )
            await sessions.revokeBrowserSessions(session, other.id)
          },
        },
        {
          name: 'renaming a passkey',
          arrange: addPasskey,
          act: async () =>
            passkeys.changePasskey(await sessionOf(), 'a-passkey', {}, 'Phone'),
        },
        {
          name: 'changing the display name',
          act: () => editAccount({ name: 'Alex the Second' }, 'self'),
        },
        {
          name: 'revoking a named API token',
          act: () =>
            integrations.runIntegrationCommand(administrator('mcp-alex'), {
              action: 'revoke-token',
              id: 'token-other',
            }),
        },
        {
          name: 'confirming the address the account already has',
          arrange: () =>
            prisma.user.update({
              where: { id: 'mcp-alex' },
              data: { emailVerified: null, emailVerifiedFor: null },
            }),
          act: async () => {
            const { token } = await prisma.$transaction((tx) =>
              emailTokens.issueEmailToken(tx, {
                userId: 'mcp-alex',
                email: ADDRESS,
                purpose: 'verify',
                expiresAt: new Date(Date.now() + 10 * MINUTE),
              })
            )
            await withEmail(() =>
              emailAccount.confirmEmailToken(token, emailSettings)
            )
          },
        },
      ]

      it.each(keeping)('$name ends none', async ({ arrange, act }) => {
        await arrange?.()
        const mine = await connect()
        const pending = await approve(mine.clientId)
        const before = await prisma.user.findUniqueOrThrow({
          where: { id: 'mcp-alex' },
        })
        events.length = 0

        await act()

        expect(await principalFor(mine.pair.access_token)).not.toBeNull()
        expect((await connectionRow(mine.connectionId)).revokedAt).toBeNull()
        expect((await redeem(mine.clientId, pending)).status).toBe(200)
        expect(
          (await prisma.user.findUniqueOrThrow({ where: { id: 'mcp-alex' } }))
            .sessionVersion
        ).toBe(before.sessionVersion)
        await audit.auditSettled()
        expect(
          events.filter(
            (event) => event.action === 'agent_connection.revokeAll'
          )
        ).toEqual([])
      })
    })

    /** A door the test opens when it wants the other side to go on. */
    function door() {
      let open!: () => void
      const opened = new Promise<void>((resolve) => (open = resolve))
      return { open, opened }
    }
    /** Resolves once this many database sessions are waiting for a lock. */
    async function untilWaiting(count = 1) {
      for (let attempt = 0; attempt < 500; attempt++) {
        const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
          SELECT count(*)::int AS "waiting" FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock'
        `
        if (waiting >= count) return
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      throw new Error('Nothing came to wait for a lock')
    }
    /** The order two promises settled in. */
    function settling() {
      const order: string[] = []
      const track = <T>(name: string, promise: Promise<T>) => {
        const tracked = promise.then(
          (value) => {
            order.push(name)
            return value
          },
          (error: unknown) => {
            order.push(name)
            throw error
          }
        )
        // Looked at later; never an unhandled rejection meanwhile.
        tracked.catch(() => {})
        return tracked
      }
      return { order, track }
    }

    /** The answer, or a failure when it has not come within three seconds. */
    const promptly = <T>(work: Promise<T>) =>
      Promise.race([
        work,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('It waited for a row')), 3000)
        ),
      ])
    /**
     * Takes rows in a transaction that stays open, as another request in
     * the middle of its work would. The answer lets go of them.
     */
    async function holding(
      take: (tx: Prisma.TransactionClient) => Promise<unknown>
    ) {
      const release = door()
      const held = door()
      const done = prisma.$transaction(
        async (tx) => {
          await take(tx)
          held.open()
          await release.opened
        },
        { timeout: 10_000 }
      )
      await held.opened
      const letGo = async () => {
        release.open()
        await done
      }
      holders.push(letGo)
      return letGo
    }
    // A test that fails part way must not leave its rows held.
    const holders: Array<() => Promise<void>> = []
    afterEach(async () => {
      for (const letGo of holders.splice(0)) await letGo().catch(() => {})
    })
    /** One row, held in the mode a statement names. */
    const row =
      (table: string, key: string, value: string, mode = 'FOR UPDATE') =>
      (tx: Prisma.TransactionClient) =>
        tx.$queryRawUnsafe(
          `SELECT 1 FROM "${table}" WHERE "${key}" = $1 ${mode}`,
          value
        )

    describe('two things at once, in a set order', () => {
      let authorizeRoute: typeof import('@/app/api/oauth/authorize/route')
      let transferRoute: typeof import('@/app/api/mcp/transfer/[ticket]/route')
      let uploads: typeof import('@/lib/mcp/tools/uploads')
      let storageModule: typeof import('@/lib/storage')
      let webhooks: typeof import('@/lib/integrations/webhooks')

      beforeAll(async () => {
        authorizeRoute = await import('@/app/api/oauth/authorize/route')
        transferRoute = await import('@/app/api/mcp/transfer/[ticket]/route')
        uploads = await import('@/lib/mcp/tools/uploads')
        storageModule = await import('@/lib/storage')
        webhooks = await import('@/lib/integrations/webhooks')
      })

      beforeEach(async () => {
        // Both accounts may upload.
        await prisma.role.create({
          data: {
            name: 'Uploaders',
            position: 10,
            permissions: ['files.upload', 'pastes.create'],
            users: { connect: [{ id: 'mcp-alex' }, { id: 'mcp-sam' }] },
          },
        })
      })
      afterEach(() => vi.restoreAllMocks())

      describe('a consent decision and a sign-out everywhere', () => {
        const signOutEverywhere = () =>
          prisma.$transaction((tx) =>
            security.revokeSecuritySessions(tx, 'mcp-alex')
          )
        /** The request as the consent screen holds it, for a registered client. */
        async function consentRequest(clientId: string) {
          const { createHash } = await import('node:crypto')
          const checked = await authorize.validateAuthorize(
            new URLSearchParams({
              response_type: 'code',
              client_id: clientId,
              redirect_uri: REDIRECT,
              code_challenge: createHash('sha256')
                .update('v'.repeat(64))
                .digest('base64url'),
              code_challenge_method: 'S256',
              state: 'state-1',
            }),
            new Request(`${ORIGIN}/api/oauth/authorize`)
          )
          if (!('client' in checked)) throw new Error('refused')
          return authorize.signConsentRequest(checked, 'mcp-alex')
        }
        /** A browser session of the account, as it is on its current version. */
        async function signIn() {
          const { sessionVersion } = await prisma.user.findUniqueOrThrow({
            where: { id: 'mcp-alex' },
          })
          session.read.mockResolvedValue({
            user: {
              id: 'mcp-alex',
              permissions: ['administrator'],
              sessionVersion,
            },
          } as never)
        }
        afterEach(() => session.read.mockResolvedValue(null))

        /**
         * The decision as the consent screen posts it. With `held`, its body
         * does not arrive until the door opens, and `reading` resolves once
         * the route has authenticated and is waiting for it.
         */
        function decide(request: string, held?: Promise<void>) {
          const body = JSON.stringify({
            request,
            decision: 'approve',
            scopes: ['files:read'],
          })
          const asked = door()
          const answer = authorizeRoute.POST(
            new Request(`${ORIGIN}/api/oauth/authorize`, {
              method: 'POST',
              headers: { 'content-type': 'application/json', origin: ORIGIN },
              body: held
                ? new ReadableStream(
                    {
                      async pull(controller) {
                        asked.open()
                        await held
                        controller.enqueue(new TextEncoder().encode(body))
                        controller.close()
                      },
                    },
                    // Nothing is fetched ahead: the first pull is the route
                    // asking for its body, which it does after signing in.
                    { highWaterMark: 0 }
                  )
                : body,
              // @ts-expect-error Node needs this to send a stream.
              duplex: 'half',
            })
          )
          return { answer, reading: asked.opened }
        }

        it('creates nothing when the sign-out commits after the decision was authenticated and before it is written', async () => {
          const clientId = await registered()
          const request = await consentRequest(clientId)
          await signIn()
          const body = door()
          const { answer, reading } = decide(request, body.opened)
          // Authenticated against version 1, and now waiting for its body.
          await reading
          expect(session.read).toHaveBeenCalled()
          await signOutEverywhere()
          body.open()

          const response = await answer
          expect(response.status).toBe(401)
          expect(await response.json()).toEqual({
            error: 'Sign in again to continue.',
          })
          // No code exists, so there is nothing a client could redeem.
          expect(await prisma.oAuthCode.count()).toBe(0)
          expect(await prisma.agentConnection.count()).toBe(0)
          // The registration was not even marked as used.
          expect(
            (
              await prisma.oAuthClient.findUniqueOrThrow({
                where: { id: clientId },
              })
            ).usedAt
          ).toBeNull()
        })

        it('waits for a sign-out that holds the account, then creates nothing', async () => {
          const clientId = await registered()
          const request = await consentRequest(clientId)
          await signIn()
          // The sign-out has done its work and not yet committed.
          const commit = door()
          const done = door()
          const signingOut = prisma.$transaction(async (tx) => {
            await security.revokeSecuritySessions(tx, 'mcp-alex')
            done.open()
            await commit.opened
          })
          await done.opened
          const { answer } = decide(request)
          // The decision is at the account's row lock, behind the sign-out.
          await untilWaiting()
          expect(await prisma.oAuthCode.count()).toBe(0)
          commit.open()
          await signingOut

          const response = await answer
          // Locking alone would have let it through: the version decides.
          expect(response.status).toBe(401)
          expect(await prisma.oAuthCode.count()).toBe(0)
        })

        it('loses its code to a sign-out that comes after it', async () => {
          const clientId = await registered()
          const request = await consentRequest(clientId)
          await signIn()
          const response = await decide(request).answer
          expect(response.status).toBe(200)
          const code = new URL(
            (await response.json()).redirect
          ).searchParams.get('code')!
          expect(await prisma.oAuthCode.count()).toBe(1)
          expect(
            (await prisma.oAuthCode.findFirstOrThrow()).sessionVersion
          ).toBe(1)

          await signOutEverywhere()
          expect(await prisma.oAuthCode.count()).toBe(0)
          expect((await redeem(clientId, code)).status).toBe(400)
          expect(await prisma.agentConnection.count()).toBe(0)
        })

        it('makes a sign-out wait for a decision that holds the account, and then take its code', async () => {
          const clientId = await registered()
          const { sessionVersion } = await prisma.user.findUniqueOrThrow({
            where: { id: 'mcp-alex' },
          })
          // A decision that has written its code and not yet committed: the
          // same statements, in a transaction the test holds open.
          const commit = door()
          const written = door()
          const { order, track } = settling()
          const deciding = track(
            'decision',
            prisma.$transaction(async (tx) => {
              await locks.lockUserRow(tx, 'mcp-alex')
              await tx.oAuthClient.update({
                where: { id: clientId },
                data: { usedAt: new Date() },
              })
              await tx.oAuthCode.create({
                data: {
                  hash: tokens.hashApiToken('a-code-written-under-the-lock'),
                  clientId,
                  userId: 'mcp-alex',
                  redirectUri: REDIRECT,
                  codeChallenge: 'c'.repeat(43),
                  resource: RESOURCE,
                  scopes: ['files:read'],
                  sessionVersion,
                  expiresAt: new Date(Date.now() + MINUTE),
                },
              })
              written.open()
              await commit.opened
            })
          )
          await written.opened
          const signingOut = track('sign-out', signOutEverywhere())
          await untilWaiting()
          commit.open()
          await Promise.all([deciding, signingOut])
          expect(order).toEqual(['decision', 'sign-out'])
          // The sign-out saw the code the decision committed, and took it.
          expect(await prisma.oAuthCode.count()).toBe(0)
        })

        it('refuses a code whose session version the account has left, should one ever outlive a sign-out', async () => {
          const clientId = await registered()
          const code = await approve(clientId)
          // The version moves on without the code being deleted, which no
          // path in the app does: redemption does not rely on that.
          await prisma.user.update({
            where: { id: 'mcp-alex' },
            data: { sessionVersion: { increment: 1 } },
          })
          expect(await prisma.oAuthCode.count()).toBe(1)
          const response = await redeem(clientId, code)
          expect(response.status).toBe(400)
          expect((await response.json()).error).toBe('invalid_grant')
          expect(await prisma.agentConnection.count()).toBe(0)
          expect(
            (await prisma.oAuthCode.findFirstOrThrow()).usedAt
          ).toBeInstanceOf(Date)
        })
      })

      describe('an upload that is publishing and the end of its credential', () => {
        /** Storage that keeps bytes in memory, and can hold a file back while it arrives. */
        function useStorage(arriving?: Promise<void>) {
          const objects = new Map<string, Buffer>()
          const started = door()
          vi.spyOn(storageModule, 'getStorageProvider').mockResolvedValue({
            kind: 'local',
            target: { provider: 'local' },
            async uploadStream(
              stream: AsyncIterable<Uint8Array>,
              path: string
            ) {
              const chunks: Buffer[] = []
              for await (const chunk of stream) chunks.push(Buffer.from(chunk))
              started.open()
              await arriving
              objects.set(path, Buffer.concat(chunks))
              return { size: objects.get(path)!.length }
            },
            async getFileStream(
              path: string,
              range?: { start: number; end: number }
            ) {
              const { Readable } = await import('node:stream')
              const bytes = objects.get(path) ?? Buffer.alloc(0)
              return Readable.from([
                range ? bytes.subarray(range.start, range.end + 1) : bytes,
              ])
            },
            async deleteFile(path: string) {
              objects.delete(path)
            },
          } as never)
          return { objects, started: started.opened }
        }
        /**
         * Holds a publication at the very end of its transaction: every
         * authorization read is done and the file row is written, and
         * nothing is committed until the door opens.
         */
        function pausePublication() {
          const hold = door()
          const reached = door()
          const real = webhooks.enqueueFileReady
          vi.spyOn(webhooks, 'enqueueFileReady').mockImplementation(
            async (...parameters: Parameters<typeof real>) => {
              await real(...parameters)
              reached.open()
              await hold.opened
            }
          )
          return { reached: reached.opened, release: hold.open }
        }
        const files = () =>
          prisma.file.findMany({ where: { userId: 'mcp-alex' } })
        /** The promise, with a rejection nobody has looked at yet left alone. */
        const quiet = <T>(promise: Promise<T>) => {
          promise.catch(() => {})
          return promise
        }
        const URL_REFUSED =
          'This upload URL may no longer be used: its connection lost upload access, or the MCP server was turned off.'
        const CALL_REFUSED =
          'This connection was disconnected, or lost upload access, while the file was being uploaded. Nothing was published.'
        /** An upload URL answering that it may no longer be used. */
        async function expectUrlRefused(answer: unknown) {
          const response = answer as Response
          expect(response.status).toBe(403)
          expect(await response.json()).toEqual({ error: URL_REFUSED })
        }

        /** upload_file, as the MCP server calls it for this principal. */
        async function inlineUpload(accessToken: string) {
          const principal = (await auth.authenticateAgent(bearer(accessToken)))!
          const tool = uploads.uploadsTools.find(
            ({ name }) => name === 'upload_file'
          )!
          return tool.run(
            tool.input.parse({ filename: 'notes.txt', text: 'hello' }) as never,
            {
              principal,
              request: new Request(`${ORIGIN}/api/mcp`, { method: 'POST' }),
              origin: ORIGIN,
              allows: () => true,
              requireEffect: () => {},
            }
          )
        }
        /** An upload URL of this credential, and the request curl makes to it. */
        async function uploadUrl(accessToken: string) {
          const principal = (await auth.authenticateAgent(bearer(accessToken)))!
          const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
            options: {},
          })
          const secret = secretOf(url)
          const send = async () => {
            const form = new FormData()
            form.set(
              'file',
              new Blob(['hello'], { type: 'text/plain' }),
              'notes.txt'
            )
            const encoded = new Response(form)
            return transferRoute.POST(
              new Request(url, {
                method: 'POST',
                headers: {
                  'content-type': encoded.headers.get('content-type')!,
                },
                body: new Uint8Array(await encoded.arrayBuffer()),
              }),
              { params: Promise.resolve({ ticket: secret }) }
            )
          }
          return { url, send, row: () => rowOf(url).catch(() => null) }
        }
        const uploader = () =>
          connect({ scopes: ['files:read', 'files:upload'] })
        const alex = () => administrator('mcp-alex')

        type Agent = Awaited<ReturnType<typeof uploader>>
        /** Each way a connection ends or loses uploading, and what it leaves. */
        const endings: Array<{
          name: string
          end: (agent: Agent) => Promise<unknown>
          after: (agent: Agent) => Promise<void>
        }> = [
          {
            name: 'disconnecting it',
            end: ({ connectionId }) =>
              integrations.runIntegrationCommand(alex(), {
                action: 'disconnect-agent',
                id: connectionId,
              }),
            after: async ({ connectionId }) => {
              expect(await connectionRow(connectionId)).toMatchObject({
                revokedReason: 'disconnected',
              })
            },
          },
          {
            name: 'its client revoking a token',
            end: ({ pair }) => revoke(pair.refresh_token),
            after: async ({ connectionId }) => {
              expect(await connectionRow(connectionId)).toMatchObject({
                revokedReason: 'revoked',
              })
            },
          },
          {
            name: 'taking files:upload away from it',
            end: ({ connectionId }) =>
              integrations.runIntegrationCommand(alex(), {
                action: 'update-agent',
                id: connectionId,
                scopes: ['files:read'],
              }),
            after: async ({ connectionId }) => {
              expect((await connectionRow(connectionId)).scopes).toEqual([
                'files:read',
              ])
            },
          },
          {
            name: 'signing the account out everywhere',
            end: () =>
              prisma.$transaction((tx) =>
                security.revokeSecuritySessions(tx, 'mcp-alex')
              ),
            after: async ({ connectionId }) => {
              expect(await connectionRow(connectionId)).toMatchObject({
                revokedReason: 'sessions-revoked',
              })
            },
          },
        ]

        describe.each([
          ['upload_file', 'inline'],
          ['an upload URL', 'transfer'],
        ] as const)('through %s', (_what, path) => {
          const start = async (
            agent: Agent
          ): Promise<() => Promise<unknown>> =>
            path === 'inline'
              ? () => inlineUpload(agent.pair.access_token)
              : (await uploadUrl(agent.pair.access_token)).send
          /** Whether the upload was answered as published. */
          const published = (answer: unknown) =>
            path === 'inline'
              ? Boolean(
                  (answer as { structured?: { file?: unknown } }).structured
                    ?.file
                )
              : (answer as Response).status === 200
          /** The upload is told it published nothing, and why. */
          const expectRefused = async (uploading: Promise<unknown>) =>
            path === 'inline'
              ? expect(uploading).rejects.toThrow(CALL_REFUSED)
              : expectUrlRefused(await uploading)

          it.each(endings)(
            'makes $name wait until the file is published, when the upload was checked first',
            async ({ end, after }) => {
              const agent = await uploader()
              const send = await start(agent)
              useStorage()
              const publication = pausePublication()
              const { order, track } = settling()

              const uploading = track('upload', send())
              // Checked, written, and holding its locks; not yet committed.
              await publication.reached
              expect(await files()).toEqual([])
              const ending = track('ending', end(agent))
              // The ending is behind the row the publication holds.
              await untilWaiting()
              expect(
                (await connectionRow(agent.connectionId)).revokedAt
              ).toBeNull()
              expect(order).toEqual([])
              publication.release()

              const answer = await uploading
              await ending
              expect(published(answer)).toBe(true)
              // The file first, then the ending: never the other way round.
              expect(order).toEqual(['upload', 'ending'])
              expect(await files()).toHaveLength(1)
              await after(agent)
            }
          )

          it.each(endings)(
            'publishes nothing after $name has committed, though the upload had started',
            async ({ end, after }) => {
              const agent = await uploader()
              const send = await start(agent)
              // The bytes are still arriving when the ending commits.
              const arriving = door()
              const storage = useStorage(arriving.opened)

              const uploading = quiet(send())
              await storage.started
              await end(agent)
              await after(agent)
              arriving.open()

              await expectRefused(uploading)
              expect(await files()).toEqual([])
              // And the bytes that had arrived are not kept.
              expect(storage.objects.size).toBe(0)
            }
          )

          it.each([
            {
              name: 'a disconnect',
              // Holds the connection's row.
              end: (
                tx: Parameters<typeof connections.revokeConnection>[0],
                id: string
              ) => connections.revokeConnection(tx, { id }, 'disconnected'),
            },
            {
              name: 'a sign-out everywhere',
              // Holds the account's row, and its connections' rows.
              end: (tx: Parameters<typeof connections.revokeConnection>[0]) =>
                security.revokeSecuritySessions(tx, 'mcp-alex'),
            },
          ])(
            'waits for $name that has not committed yet, then publishes nothing',
            async ({ end }) => {
              const agent = await uploader()
              const send = await start(agent)
              const arriving = door()
              const storage = useStorage(arriving.opened)
              const uploading = quiet(send())
              await storage.started
              // The ending has done its work and not yet committed.
              const commit = door()
              const done = door()
              const ending = prisma.$transaction(async (tx) => {
                await end(tx, agent.connectionId)
                done.open()
                await commit.opened
              })
              await done.opened
              arriving.open()
              // The upload's last check is behind the ending's lock.
              await untilWaiting()
              expect(await files()).toEqual([])
              commit.open()
              await ending

              await expectRefused(uploading)
              expect(await files()).toEqual([])
              expect(storage.objects.size).toBe(0)
            }
          )
        })

        describe('through an upload URL', () => {
          it('publishes nothing with a URL that a disconnect deleted while the file was arriving', async () => {
            const agent = await uploader()
            const { send, row } = await uploadUrl(agent.pair.access_token)
            const arriving = door()
            const storage = useStorage(arriving.opened)
            const uploading = send()
            await storage.started
            expect((await row())!.claimedAt).toBeInstanceOf(Date)
            await integrations.runIntegrationCommand(alex(), {
              action: 'disconnect-agent',
              id: agent.connectionId,
            })
            // The URL went with its connection.
            expect(await row()).toBeNull()
            arriving.open()
            await expectUrlRefused(await uploading)
            expect(await files()).toEqual([])
            expect(storage.objects.size).toBe(0)
          })

          it('publishes nothing with a URL that is gone, even while its connection is live', async () => {
            const agent = await uploader()
            const { send, row } = await uploadUrl(agent.pair.access_token)
            const arriving = door()
            const storage = useStorage(arriving.opened)
            const uploading = send()
            await storage.started
            await prisma.agentTransfer.deleteMany()
            arriving.open()
            await expectUrlRefused(await uploading)
            expect(await files()).toEqual([])
            expect(await row()).toBeNull()
            // The connection itself was never ended.
            expect(
              (await connectionRow(agent.connectionId)).revokedAt
            ).toBeNull()
          })

          it('keeps a URL for the upload using it past its own time, so a slow file still publishes', async () => {
            const agent = await uploader()
            const { send, row } = await uploadUrl(agent.pair.access_token)
            const arriving = door()
            const storage = useStorage(arriving.opened)
            const uploading = send()
            await storage.started
            // An hour on: long past the fifteen minutes the URL had to start.
            const later = new Date(Date.now() + 60 * MINUTE)
            expect(await transfer.deleteExpiredTransfers(later)).toBe(0)
            expect(await row()).not.toBeNull()
            arriving.open()
            expect((await uploading).status).toBe(200)
            expect(await files()).toHaveLength(1)
            expect(await row()).toBeNull()
          })

          it('sweeps a URL whose upload never finished, a day on', async () => {
            const agent = await uploader()
            const { url, row } = await uploadUrl(agent.pair.access_token)
            const { id } = await rowOf(url)
            expect(await transfer.claimUpload(id)).toBe(true)
            const day = 24 * 60 * MINUTE
            expect(
              await transfer.deleteExpiredTransfers(
                new Date(Date.now() + day - MINUTE)
              )
            ).toBe(0)
            expect(
              await transfer.deleteExpiredTransfers(
                new Date(Date.now() + day + MINUTE)
              )
            ).toBe(1)
            expect(await row()).toBeNull()
          })

          it('gives a failed upload its URL back with the time it had', async () => {
            const agent = await uploader()
            const { url } = await uploadUrl(agent.pair.access_token)
            const before = await rowOf(url)
            await transfer.claimUpload(before.id)
            const held = await rowOf(url)
            expect(held.expiresAt.getTime() - Date.now()).toBeGreaterThan(
              23 * 60 * MINUTE
            )
            await transfer.releaseUpload(before.id)
            const after = await rowOf(url)
            expect(after.claimedAt).toBeNull()
            // Fifteen minutes from when it was made, give or take the clocks.
            expect(
              Math.abs(after.expiresAt.getTime() - before.expiresAt.getTime())
            ).toBeLessThan(5_000)
            expect(await transfer.claimUpload(before.id)).toBe(true)
          })
        })

        describe('a named token', () => {
          const revokeToken = () =>
            integrations.runIntegrationCommand(alex(), {
              action: 'revoke-token',
              id: 'token-agent',
            })
          beforeEach(async () => {
            await prisma.apiToken.update({
              where: { id: 'token-agent' },
              data: { scopes: ['mcp', 'files:read', 'files:upload'] },
            })
          })

          it.each([
            ['upload_file', () => () => inlineUpload(TOKEN), true],
            ['an upload URL', async () => (await uploadUrl(TOKEN)).send, false],
          ] as const)(
            'makes revoking it wait until the file is published, through %s',
            async (_what, prepare, inline) => {
              const send: () => Promise<unknown> = await prepare()
              useStorage()
              const publication = pausePublication()
              const { order, track } = settling()
              const uploading = track('upload', send())
              await publication.reached
              expect(await files()).toEqual([])
              const revoking = track('revocation', revokeToken())
              // Behind the token's row, which the publication holds.
              await untilWaiting()
              expect(
                (
                  await prisma.apiToken.findUniqueOrThrow({
                    where: { id: 'token-agent' },
                  })
                ).revokedAt
              ).toBeNull()
              publication.release()
              const answer = await uploading
              await revoking
              expect(order).toEqual(['upload', 'revocation'])
              if (!inline) expect((answer as Response).status).toBe(200)
              expect(await files()).toHaveLength(1)
              expect(
                (
                  await prisma.apiToken.findUniqueOrThrow({
                    where: { id: 'token-agent' },
                  })
                ).revokedAt
              ).toBeInstanceOf(Date)
            }
          )

          it.each([
            ['upload_file', () => () => inlineUpload(TOKEN), true],
            ['an upload URL', async () => (await uploadUrl(TOKEN)).send, false],
          ] as const)(
            'publishes nothing after it was revoked, though the upload had started, through %s',
            async (_what, prepare, inline) => {
              const send: () => Promise<unknown> = await prepare()
              const arriving = door()
              const storage = useStorage(arriving.opened)
              const uploading = quiet(send())
              await storage.started
              await revokeToken()
              arriving.open()
              // The upload reads the token again itself, and says so.
              const refused = 'Upload token has expired or been revoked.'
              if (inline) await expect(uploading).rejects.toThrow(refused)
              else {
                const response = (await uploading) as Response
                expect(response.status).toBe(403)
                expect(await response.json()).toEqual({ error: refused })
              }
              expect(await files()).toEqual([])
              expect(storage.objects.size).toBe(0)
            }
          )
        })
      })
    })

    describe('ending one connection beside others that hold its transfer URLs', () => {
      const disconnect = (id: string) =>
        integrations.runIntegrationCommand(administrator('mcp-alex'), {
          action: 'disconnect-agent',
          id,
        })
      /** An agent that may upload, and two upload URLs made for it. */
      async function agentWithUrls() {
        await prisma.role.create({
          data: {
            name: 'Uploaders',
            position: 10,
            permissions: ['files.upload'],
            users: { connect: [{ id: 'mcp-alex' }] },
          },
        })
        const agent = await connect({ scopes: ['files:read', 'files:upload'] })
        const principal = (await auth.authenticateAgent(
          bearer(agent.pair.access_token)
        ))!
        const urls = [
          await transfer.createUploadUrl(principal, ORIGIN, { options: {} }),
          await transfer.createUploadUrl(principal, ORIGIN, { options: {} }),
        ]
        return {
          agent,
          rows: await Promise.all(urls.map(({ url }) => rowOf(url))),
          urls,
        }
      }

      it('passes over a URL that somebody holds instead of waiting, and that URL opens nothing', async () => {
        const { agent, rows, urls } = await agentWithUrls()
        const release = await holding(row('AgentTransfer', 'id', rows[0].id))
        expect(await promptly(disconnect(agent.connectionId))).toEqual({
          ok: true,
        })
        expect(await connectionRow(agent.connectionId)).toMatchObject({
          revokedReason: 'disconnected',
          tokens: [],
        })
        // The one nobody held went with the connection; the other is left.
        expect(
          (await prisma.agentTransfer.findMany()).map(({ id }) => id)
        ).toEqual([rows[0].id])
        await release()

        // It is still there and not expired, and it takes no upload.
        const { POST } = await import('@/app/api/mcp/transfer/[ticket]/route')
        const form = new FormData()
        form.set('file', new Blob(['hello'], { type: 'text/plain' }), 'a.txt')
        const response = await POST(
          new Request(urls[0].url, { method: 'POST', body: form }),
          { params: Promise.resolve({ ticket: secretOf(urls[0].url) }) }
        )
        expect(response.status).toBe(404)
        expect(await prisma.file.count()).toBe(0)
        expect((await rowOf(urls[0].url)).claimedAt).toBeNull()
        // The sweep takes it when its time is up.
        expect(
          await transfer.deleteExpiredTransfers(
            new Date(Date.now() + 16 * MINUTE)
          )
        ).toBe(1)
      })

      it('gives back nothing, quietly, for an upload whose URL went with its connection', async () => {
        const { agent, rows } = await agentWithUrls()
        expect(await transfer.claimUpload(rows[0].id)).toBe(true)
        await disconnect(agent.connectionId)
        expect(await prisma.agentTransfer.count()).toBe(0)
        // What the upload route does when the upload then fails.
        await expect(
          transfer.releaseUpload(rows[0].id)
        ).resolves.toBeUndefined()
        expect(await prisma.agentTransfer.count()).toBe(0)
      })

      it('does not stop the deletion of its account, which holds those URLs while it waits for the connection', async () => {
        const users = await import('@/lib/users/delete-account')
        // An administrator who can sign in, to delete the other account.
        await prisma.user.update({
          where: { id: 'mcp-sam' },
          data: { email: 'sam@mcp.example.test', password: 'a-password-hash' },
        })
        await prisma.role.create({
          data: {
            name: 'Owners',
            position: 100,
            permissions: ['administrator'],
            users: { connect: [{ id: 'mcp-sam' }] },
          },
        })
        const { agent } = await agentWithUrls()
        const { order, track } = settling()
        // The ending has the connection's row, as every ending takes it
        // first, and has not gone further yet.
        const taken = door()
        const further = door()
        const ending = track(
          'ending',
          prisma.$transaction(async (tx) => {
            await connections.lockConnection(tx, agent.connectionId)
            taken.open()
            await further.opened
            return connections.revokeConnection(
              tx,
              { id: agent.connectionId },
              'revoked'
            )
          })
        )
        await taken.opened
        const deleting = track(
          'deletion',
          users.deleteAccount('mcp-sam', 'mcp-alex', 'users.delete')
        )
        // The deletion is at the connection's row, behind the ending.
        await untilWaiting()
        further.open()

        // Waiting for a URL the deletion holds would have stopped them both.
        expect(await promptly(ending)).toBe(true)
        await deleting
        expect(order).toEqual(['ending', 'deletion'])
        expect(
          await prisma.user.findUnique({ where: { id: 'mcp-alex' } })
        ).toBeNull()
        expect(await prisma.agentConnection.count()).toBe(0)
        expect(await prisma.agentTransfer.count()).toBe(0)
      })
    })

    describe('the account must verify its email', () => {
      it('refuses the access token while it must, and serves it again once it need not', async () => {
        const { pair } = await connect()
        const emailConfig = await import('@/lib/email/config')
        const schema = await import('@/lib/email/schema')
        await prisma.user.update({
          where: { id: 'mcp-alex' },
          data: { email: 'alex@example.test', password: 'hash' },
        })
        const required = structuredClone(schema.DEFAULT_EMAIL_CONFIG)
        required.enabled = true
        required.verification.mode = 'all_users'
        required.verification.appliedMode = 'all_users'
        required.verification.requiredSince = new Date(0).toISOString()
        required.verification.graceEndsAt = null
        const spy = vi
          .spyOn(emailConfig, 'getEmailConfig')
          .mockResolvedValue(required)
        try {
          expect(await principalFor(pair.access_token)).toBeNull()
        } finally {
          spy.mockRestore()
        }
        expect(await principalFor(pair.access_token)).not.toBeNull()
      })
    })

    describe('cleanup', () => {
      const client = (
        id: string,
        data: Partial<Prisma.OAuthClientCreateManyInput> = {}
      ) => ({ id, name: id, redirectUris: [REDIRECT], ...data })

      it('removes expired codes, used or not, and keeps the ones still waiting', async () => {
        const clientId = await registered()
        const waiting = await approve(clientId)
        await approve(clientId)
        await approve(clientId)
        const rows = await prisma.oAuthCode.findMany({
          orderBy: { createdAt: 'asc' },
        })
        await prisma.oAuthCode.update({
          where: { hash: rows[1].hash },
          data: { expiresAt: new Date(Date.now() - 1000) },
        })
        await prisma.oAuthCode.update({
          where: { hash: rows[2].hash },
          data: {
            expiresAt: new Date(Date.now() - 1000),
            usedAt: new Date(Date.now() - 2000),
          },
        })
        expect((await cleanup.cleanUpSignIn()).codes).toBe(2)
        expect(await prisma.oAuthCode.findMany()).toEqual([
          expect.objectContaining({ hash: tokens.hashApiToken(waiting) }),
        ])
      })

      it('removes registrations nobody approved within a day, and keeps approved ones however old', async () => {
        const old = new Date(Date.now() - 25 * 60 * MINUTE)
        const ancient = new Date(Date.now() - 400 * DAY)
        await prisma.oAuthClient.createMany({
          data: [
            client('flc_fresh-unused'),
            client('flc_old-unused', { createdAt: old }),
            client('flc_old-used', { createdAt: ancient, usedAt: ancient }),
            client('flc_almost-a-day', {
              createdAt: new Date(Date.now() - 23 * 60 * MINUTE),
            }),
          ],
        })
        expect((await cleanup.cleanUpSignIn()).clients).toBe(1)
        expect(
          (await prisma.oAuthClient.findMany({ orderBy: { id: 'asc' } })).map(
            (row) => row.id
          )
        ).toEqual(['flc_almost-a-day', 'flc_fresh-unused', 'flc_old-used'])
      })

      it('keeps five hundred unapproved registrations and removes the oldest beyond that', async () => {
        const base = Date.now() - 60 * MINUTE
        await prisma.oAuthClient.createMany({
          data: [
            ...Array.from({ length: 507 }, (_, index) =>
              client(`flc_unused-${String(index).padStart(3, '0')}`, {
                // The lowest numbers are the oldest.
                createdAt: new Date(base + index * 1000),
              })
            ),
            // Approved registrations do not count, old as they are.
            ...Array.from({ length: 20 }, (_, index) =>
              client(`flc_used-${index}`, {
                createdAt: new Date(base - DAY),
                usedAt: new Date(base),
              })
            ),
          ],
        })
        expect((await cleanup.cleanUpSignIn()).clients).toBe(7)
        const unused = await prisma.oAuthClient.findMany({
          where: { usedAt: null },
          orderBy: { id: 'asc' },
          select: { id: true },
        })
        expect(unused).toHaveLength(500)
        expect(unused[0].id).toBe('flc_unused-007')
        expect(unused.at(-1)!.id).toBe('flc_unused-506')
        expect(
          await prisma.oAuthClient.count({ where: { usedAt: { not: null } } })
        ).toBe(20)
        // A second run finds nothing more to do.
        expect((await cleanup.cleanUpSignIn()).clients).toBe(0)
      })

      it('removes token pairs whose refresh token expired, and connections left without one', async () => {
        const kept = await connect()
        const idle = await connect({ scopes: ['files:read'] })
        const rotatedOnce = await connect({ scopes: ['urls:read'] })
        const next = await refreshed(rotatedOnce.clientId, rotatedOnce.pair)
        // Ninety days without a refresh.
        await prisma.agentToken.updateMany({
          where: { connectionId: idle.connectionId },
          data: { refreshExpiresAt: new Date(Date.now() - 1000) },
        })
        // The old pair of a connection still in use.
        await prisma.agentToken.update({
          where: {
            refreshHash: tokens.hashApiToken(rotatedOnce.pair.refresh_token),
          },
          data: { refreshExpiresAt: new Date(Date.now() - 1000) },
        })
        events.length = 0
        const removed = await context.auditContext.run(
          { actorId: null, actorName: 'System' },
          () => cleanup.cleanUpSignIn()
        )
        expect(removed).toMatchObject({ pairs: 2, connections: 1 })
        expect(
          (
            await prisma.agentConnection.findMany({
              orderBy: { createdAt: 'asc' },
            })
          ).map((row) => row.id)
        ).toEqual([kept.connectionId, rotatedOnce.connectionId])
        expect(await principalFor(kept.pair.access_token)).not.toBeNull()
        expect(await principalFor(next.access_token)).not.toBeNull()
        expect(await principalFor(idle.pair.access_token)).toBeNull()
        // The log says which connection maintenance removed.
        expect(events).toEqual([
          expect.objectContaining({
            action: 'agent_connection.deleteMany',
            actorName: 'System',
            targetId: idle.connectionId,
          }),
        ])
      })

      it('removes connections that ended, and nothing of a live one', async () => {
        const live = await connect()
        const gone = await connect()
        await integrations.runIntegrationCommand(administrator('mcp-alex'), {
          action: 'disconnect-agent',
          id: gone.connectionId,
        })
        expect(await prisma.agentConnection.count()).toBe(2)
        expect((await cleanup.cleanUpSignIn()).connections).toBe(1)
        expect(
          (await prisma.agentConnection.findMany()).map((row) => row.id)
        ).toEqual([live.connectionId])
        expect(await principalFor(live.pair.access_token)).not.toBeNull()
        // A registration that was approved outlives its connections.
        expect(
          await prisma.oAuthClient.findUnique({ where: { id: gone.clientId } })
        ).not.toBeNull()
      })

      it('measures against the time it is given', async () => {
        const { connectionId } = await connect()
        const soon = new Date(Date.now() + 89 * DAY)
        expect(await cleanup.cleanUpSignIn(soon)).toMatchObject({
          pairs: 0,
          connections: 0,
        })
        const later = new Date(Date.now() + 91 * DAY)
        expect(await cleanup.cleanUpSignIn(later)).toMatchObject({
          pairs: 1,
          connections: 1,
        })
        expect(
          await prisma.agentConnection.findUnique({
            where: { id: connectionId },
          })
        ).toBeNull()
      })

      describe('beside transactions that hold rows', () => {
        const signOutEverywhere = () =>
          prisma.$transaction((tx) =>
            security.revokeSecuritySessions(tx, 'mcp-alex')
          )
        const disconnect = (id: string) =>
          integrations.runIntegrationCommand(administrator('mcp-alex'), {
            action: 'disconnect-agent',
            id,
          })
        const past = () => new Date(Date.now() - MINUTE)
        const connectionIds = async () =>
          (
            await prisma.agentConnection.findMany({ orderBy: { id: 'asc' } })
          ).map(({ id }) => id)

        it('passes over an ended connection that somebody holds, removes the others without waiting, and takes it on its next run', async () => {
          const agents = [await connect(), await connect(), await connect()]
          for (const { connectionId } of agents) await disconnect(connectionId)
          const [, held] = agents
          const release = await holding((tx) =>
            connections.lockConnection(tx, held.connectionId)
          )
          expect(await promptly(cleanup.cleanUpSignIn())).toMatchObject({
            connections: 2,
          })
          expect(await connectionIds()).toEqual([held.connectionId])
          // Still nothing to wait for the second time.
          expect(await promptly(cleanup.cleanUpSignIn())).toMatchObject({
            connections: 0,
          })
          await release()
          expect(await cleanup.cleanUpSignIn()).toMatchObject({
            connections: 1,
          })
          expect(await connectionIds()).toEqual([])
        })

        it('passes over a connection held the way an upload that is publishing holds it', async () => {
          const { connectionId } = await connect()
          await prisma.agentToken.deleteMany({ where: { connectionId } })
          const release = await holding((tx) =>
            connections.holdConnection(tx, connectionId)
          )
          expect(await promptly(cleanup.cleanUpSignIn())).toMatchObject({
            connections: 0,
          })
          await release()
          expect(await cleanup.cleanUpSignIn()).toMatchObject({
            connections: 1,
          })
        })

        it('passes over an expired code that somebody holds', async () => {
          const clientId = await registered()
          await approve(clientId)
          await approve(clientId)
          await prisma.oAuthCode.updateMany({ data: { expiresAt: past() } })
          const [held, free] = await prisma.oAuthCode.findMany({
            orderBy: { hash: 'asc' },
          })
          const release = await holding(row('OAuthCode', 'hash', held.hash))
          expect((await promptly(cleanup.cleanUpSignIn())).codes).toBe(1)
          expect(await prisma.oAuthCode.findMany()).toEqual([
            expect.objectContaining({ hash: held.hash }),
          ])
          expect(free.hash).not.toBe(held.hash)
          await release()
          expect((await cleanup.cleanUpSignIn()).codes).toBe(1)
        })

        it('passes over an expired token pair that somebody holds, and keeps its connection for now', async () => {
          const held = await connect()
          const free = await connect()
          await prisma.agentToken.updateMany({
            data: { refreshExpiresAt: past() },
          })
          const pair = await prisma.agentToken.findFirstOrThrow({
            where: { connectionId: held.connectionId },
          })
          const release = await holding(row('AgentToken', 'id', pair.id))
          expect(await promptly(cleanup.cleanUpSignIn())).toMatchObject({
            pairs: 1,
            // Only the one whose last pair went.
            connections: 1,
          })
          expect(await connectionIds()).toEqual([held.connectionId])
          expect(
            await prisma.agentConnection.findUnique({
              where: { id: free.connectionId },
            })
          ).toBeNull()
          await release()
          expect(await cleanup.cleanUpSignIn()).toMatchObject({
            pairs: 1,
            connections: 1,
          })
        })

        it.each([
          ['held for a change', 'FOR UPDATE'],
          // As a row is held while something that points at it is written.
          ['held against deletion only', 'FOR KEY SHARE'],
        ])(
          'passes over an old unapproved registration that is %s',
          async (_how, mode) => {
            const old = new Date(Date.now() - 25 * 60 * MINUTE)
            await prisma.oAuthClient.createMany({
              data: [
                client('flc_old-free', { createdAt: old }),
                client('flc_old-held', { createdAt: old }),
              ],
            })
            const release = await holding(
              row('OAuthClient', 'id', 'flc_old-held', mode)
            )
            expect((await promptly(cleanup.cleanUpSignIn())).clients).toBe(1)
            expect(await prisma.oAuthClient.findMany()).toEqual([
              expect.objectContaining({ id: 'flc_old-held' }),
            ])
            await release()
            expect((await cleanup.cleanUpSignIn()).clients).toBe(1)
          }
        )

        it('keeps a registration that is approved while the sweep passes it over', async () => {
          const old = new Date(Date.now() - 25 * 60 * MINUTE)
          await prisma.oAuthClient.create({
            data: client('flc_old-approved-now', { createdAt: old }),
          })
          // The approval has written, and not yet committed.
          const release = await holding((tx) =>
            tx.oAuthClient.updateMany({
              where: { id: 'flc_old-approved-now', usedAt: null },
              data: { usedAt: new Date() },
            })
          )
          expect((await promptly(cleanup.cleanUpSignIn())).clients).toBe(0)
          await release()
          // Approved now: no later run takes it either.
          expect((await cleanup.cleanUpSignIn()).clients).toBe(0)
          expect(await prisma.oAuthClient.count()).toBe(1)
        })

        it('passes over a registration beyond the five hundred that somebody holds, and holds none of the five hundred', async () => {
          const base = Date.now() - 60 * MINUTE
          await prisma.oAuthClient.createMany({
            data: Array.from({ length: 503 }, (_, index) =>
              client(`flc_unused-${String(index).padStart(3, '0')}`, {
                createdAt: new Date(base + index * 1000),
              })
            ),
          })
          // One of the three oldest, and one of the five hundred that stay.
          const release = await holding(async (tx) => {
            await row('OAuthClient', 'id', 'flc_unused-001')(tx)
            await row('OAuthClient', 'id', 'flc_unused-300')(tx)
          })
          expect((await promptly(cleanup.cleanUpSignIn())).clients).toBe(2)
          const left = (
            await prisma.oAuthClient.findMany({ orderBy: { id: 'asc' } })
          ).map(({ id }) => id)
          expect(left).toHaveLength(501)
          expect(left.slice(0, 2)).toEqual(['flc_unused-001', 'flc_unused-003'])
          await release()
          expect((await cleanup.cleanUpSignIn()).clients).toBe(1)
          expect(await prisma.oAuthClient.count()).toBe(500)
        })

        it('passes over an expired transfer URL that somebody holds', async () => {
          const principal = (await auth.authenticateAgent(bearer(TOKEN)))!
          const urls = [
            await transfer.createUploadUrl(principal, ORIGIN, { options: {} }),
            await transfer.createUploadUrl(principal, ORIGIN, { options: {} }),
          ]
          await prisma.agentTransfer.updateMany({ data: { expiresAt: past() } })
          const held = await rowOf(urls[0].url)
          const release = await holding(row('AgentTransfer', 'id', held.id))
          expect(await promptly(transfer.deleteExpiredTransfers())).toBe(1)
          expect(await prisma.agentTransfer.findMany()).toEqual([
            expect.objectContaining({ id: held.id }),
          ])
          await release()
          expect(await transfer.deleteExpiredTransfers()).toBe(1)
        })

        it('does not wait for a sign-out everywhere that is waiting itself, and neither fails', async () => {
          const agents = [
            await connect(),
            await connect(),
            await connect(),
            await connect(),
          ]
          for (const { connectionId } of agents.slice(0, 3))
            await disconnect(connectionId)
          const ids = await connectionIds()
          // Somebody holds the last of the account's connections, so the
          // sign-out takes the ones before it and then waits.
          const release = await holding((tx) =>
            connections.lockConnection(tx, ids.at(-1)!)
          )
          const { order, track } = settling()
          const signingOut = track('sign-out', signOutEverywhere())
          await untilWaiting()
          // The sweep finds every ended connection held, and waits for none.
          const swept = await promptly(track('sweep', cleanup.cleanUpSignIn()))
          expect(swept.connections).toBe(0)
          expect(order).toEqual(['sweep'])
          await release()
          await signingOut
          expect(await liveCount()).toBe(0)
          expect((await cleanup.cleanUpSignIn()).connections).toBe(4)
        })

        it('never fails beside a sign-out everywhere, however the two fall together', async () => {
          const clientId = await registered()
          await prisma.oAuthClient.update({
            where: { id: clientId },
            data: { usedAt: new Date() },
          })
          const principal = (await auth.authenticateAgent(bearer(TOKEN)))!
          const hour = 60 * MINUTE
          for (let round = 0; round < 100; round++) {
            const name = (kind: string, index: number) =>
              `sweep-${round}-${kind}-${index}`
            // Six ended connections and six live ones, each live one with an
            // expired pair and a current one.
            await prisma.agentConnection.createMany({
              data: Array.from({ length: 12 }, (_, index) => ({
                id: name('c', index),
                userId: 'mcp-alex',
                clientId,
                clientName: 'Sweep test',
                redirectUri: REDIRECT,
                scopes: ['files:read'],
                ...(index % 2 === 0 && {
                  revokedAt: past(),
                  revokedReason: 'disconnected',
                }),
              })),
            })
            await prisma.agentToken.createMany({
              data: Array.from({ length: 12 }, (_, index) => index)
                .filter((index) => index % 2 === 1)
                .flatMap((index) =>
                  [past(), new Date(Date.now() + hour)].map(
                    (refreshExpiresAt, pair) => ({
                      connectionId: name('c', index),
                      accessHash: name(`a${pair}`, index),
                      accessExpiresAt: refreshExpiresAt,
                      refreshHash: name(`r${pair}`, index),
                      refreshExpiresAt,
                      scopes: ['files:read'],
                    })
                  )
                ),
            })
            // Transfer URLs of every connection and of a named token, half
            // of them expired, and codes that were never redeemed.
            await prisma.agentTransfer.createMany({
              data: Array.from({ length: 26 }, (_, index) => ({
                secretHash: name('t', index),
                userId: 'mcp-alex',
                credential:
                  index < 24
                    ? connections.connectionKey(name('c', index % 12))
                    : principal.credentialKey,
                kind: 'download',
                expiresAt:
                  index % 2 === 0 ? past() : new Date(Date.now() + hour),
              })),
            })
            await prisma.oAuthCode.createMany({
              data: Array.from({ length: 4 }, (_, index) => ({
                hash: name('code', index),
                clientId,
                userId: 'mcp-alex',
                redirectUri: REDIRECT,
                codeChallenge: 'c'.repeat(43),
                resource: RESOURCE,
                scopes: ['files:read'],
                sessionVersion: 1,
                expiresAt:
                  index % 2 === 0 ? past() : new Date(Date.now() + MINUTE),
              })),
            })

            // Two sweeps, as two processes run them, beside the sign-out.
            const outcomes = await Promise.allSettled([
              signOutEverywhere(),
              cleanup.cleanUpSignIn(),
              transfer.deleteExpiredTransfers(),
              cleanup.cleanUpSignIn(),
              transfer.deleteExpiredTransfers(),
            ])
            expect(
              outcomes.map((outcome) =>
                outcome.status === 'rejected' ? String(outcome.reason) : 'done'
              ),
              `round ${round}`
            ).toEqual(['done', 'done', 'done', 'done', 'done'])

            // Whatever order they fell in, the sign-out ended everything.
            expect(await liveCount()).toBe(0)
            expect(await prisma.agentToken.count()).toBe(0)
            expect(await prisma.oAuthCode.count()).toBe(0)
            expect(
              await prisma.agentTransfer.count({
                where: { credential: { startsWith: 'connection:' } },
              })
            ).toBe(0)
            // And one more run leaves nothing of it behind.
            await cleanup.cleanUpSignIn()
            await transfer.deleteExpiredTransfers()
            expect(await prisma.agentConnection.count()).toBe(0)
            expect(
              await prisma.agentTransfer.findMany({
                where: { expiresAt: { lte: new Date() } },
              })
            ).toEqual([])
            await prisma.agentTransfer.deleteMany()
          }
        }, 120_000)
      })

      describe('measured in UTC, whatever time zone the database session is in', () => {
        const setZone = async (zone: string | null) => {
          // The suite's own database, whose name was checked when it started.
          const [{ name }] = await prisma.$queryRaw<{ name: string }[]>`
            SELECT current_database() AS "name"
          `
          await prisma.$executeRawUnsafe(
            zone
              ? `ALTER DATABASE "${name}" SET timezone TO '${zone}'`
              : `ALTER DATABASE "${name}" RESET timezone`
          )
          // New sessions take the setting; the open ones are let go.
          await prisma.$disconnect()
        }
        afterEach(() => setZone(null))

        it.each(['Asia/Tokyo', 'America/Los_Angeles'])(
          'keeps what has not expired and removes what has, in %s',
          async (zone) => {
            await setZone(zone)
            expect(
              await prisma.$queryRaw`SELECT current_setting('TimeZone') AS "zone"`
            ).toEqual([{ zone }])

            const clientId = await registered()
            const live = await connect()
            const waiting = await approve(clientId)
            const principal = (await auth.authenticateAgent(bearer(TOKEN)))!
            const { url } = await transfer.createUploadUrl(principal, ORIGIN, {
              options: {},
            })
            await prisma.oAuthClient.create({
              data: client('flc_registered-an-hour-ago', {
                createdAt: new Date(Date.now() - 60 * MINUTE),
              }),
            })
            // Hours either side of now, further than any zone is from UTC.
            expect(await cleanup.cleanUpSignIn()).toEqual({
              codes: 0,
              clients: 0,
              pairs: 0,
              connections: 0,
            })
            expect(await transfer.deleteExpiredTransfers()).toBe(0)
            expect(await principalFor(live.pair.access_token)).not.toBeNull()
            expect((await redeem(clientId, waiting)).status).toBe(200)
            expect(await rowOf(url)).toBeTruthy()

            // A minute past each one's time, which is hours away from it in
            // the session's own clock.
            await prisma.oAuthCode.updateMany({
              data: { expiresAt: new Date(Date.now() - MINUTE) },
            })
            await prisma.agentToken.updateMany({
              where: { connectionId: live.connectionId },
              data: { refreshExpiresAt: new Date(Date.now() - MINUTE) },
            })
            await prisma.agentTransfer.updateMany({
              data: { expiresAt: new Date(Date.now() - MINUTE) },
            })
            await prisma.oAuthClient.update({
              where: { id: 'flc_registered-an-hour-ago' },
              data: { createdAt: new Date(Date.now() - DAY - MINUTE) },
            })
            expect(await cleanup.cleanUpSignIn()).toEqual({
              // The one that connected the agent, and the one redeemed above.
              codes: 2,
              clients: 1,
              pairs: 1,
              connections: 1,
            })
            expect(await transfer.deleteExpiredTransfers()).toBe(1)
          }
        )

        it('writes the time a sign-out everywhere ended a connection as Prisma reads it', async () => {
          await setZone('Asia/Tokyo')
          const { connectionId } = await connect()
          const started = Date.now()
          await prisma.$transaction((tx) =>
            security.revokeSecuritySessions(tx, 'mcp-alex')
          )
          const { revokedAt } = await connectionRow(connectionId)
          expect(Math.abs(revokedAt!.getTime() - started)).toBeLessThan(30_000)
        })
      })
    })

    describe('while the MCP server is off', () => {
      it('answers 404 at every endpoint, and a connection stops working until it is on again', async () => {
        const { clientId, pair } = await connect()
        await enable(false)
        expect((await register()).response.status).toBe(404)
        expect((await refresh(clientId, pair.refresh_token)).status).toBe(404)
        expect((await revoke(pair.access_token)).status).toBe(404)
        expect(
          (
            await route.POST(
              new Request(`${ORIGIN}/api/mcp`, {
                method: 'POST',
                headers: { authorization: `Bearer ${pair.access_token}` },
                body: '{}',
              })
            )
          ).status
        ).toBe(404)
        expect(
          (await integrations.listIntegrations(administrator('mcp-alex')))
            .connections
        ).toEqual([])
        // Nothing was deleted: turning it on again brings the connection back.
        await enable(true)
        expect(await principalFor(pair.access_token)).not.toBeNull()
        await refreshed(clientId, pair)
      })
    })
  })
})
