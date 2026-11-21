import type { Prisma } from '@prisma/client'
import {
  afterAll,
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

const databaseUrl = process.env.FLARE_MCP_DATABASE_URL
const suite = databaseUrl ? describe : describe.skip

// Real queries; a full parallel run can take one past the 5 s default.
vi.setConfig({ testTimeout: 30_000 })

const ORIGIN = 'https://files.example.com'
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
    if (
      !['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/flare_mcp_test'
    )
      throw new Error('Use the disposable local flare_mcp_test database')
    vi.stubEnv('DATABASE_URL', url.toString())
    vi.stubEnv('NEXTAUTH_URL', ORIGIN)
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
    // Users take their tokens, files, folders, tags and transfers with them.
    await prisma.user.deleteMany()
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
      expect(made.url).toMatch(
        new RegExp(`^${ORIGIN}/api/mcp/transfer/[A-Za-z0-9_-]{43}$`)
      )
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
      `This connection already has ${cap} upload URLs waiting. Use them, or wait a few minutes for them to expire.`

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
          'Bearer realm="Flare MCP"'
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
      expect(data.download_url).toMatch(
        new RegExp(`^${ORIGIN}/api/mcp/transfer/[A-Za-z0-9_-]{43}$`)
      )
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
        JSON.parse(later.body.result.content[0].text).download_url
      ).toMatch(new RegExp(`^${ORIGIN}/api/mcp/transfer/`))
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
})
