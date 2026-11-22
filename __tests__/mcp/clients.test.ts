import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { API_SCOPE_CATALOG } from '@/lib/integrations/bearer-routes'
import { MCP_SCOPES } from '@/lib/mcp/catalog'
import {
  AGENT_CLIENTS,
  AGENT_PRESETS,
  type AgentSetup,
  DEFAULT_AGENT_PRESET,
  type TokenClient,
  agentClient,
  reachableFromCloud,
} from '@/lib/mcp/clients'

const URL_ = 'https://files.example.com/api/mcp'
const TOKEN = 'flr_Abc-123_xyz'
// Everything a shell or a JSON string could trip over.
const HOSTILE = `flr_a"b$(touch pwned)\`id\`'c\\d!e f`

const setup = (id: string, url = URL_, token = TOKEN): AgentSetup => {
  const client = agentClient(id)
  if (client.method !== 'token') throw new Error(`${id} has no token setup`)
  return client.setup(url, token)
}
const snippet = (id: string, name: string, url = URL_, token = TOKEN) => {
  const found = setup(id, url, token).snippets.find(
    (candidate) => candidate.id === name
  )
  if (!found) throw new Error(`${id} has no ${name} snippet`)
  return found.code
}
const link = (id: string, token = TOKEN) => setup(id, URL_, token).links[0]

const tokenClients = AGENT_CLIENTS.filter(
  (client): client is Extract<typeof client, { method: 'token' }> =>
    client.method === 'token'
) as readonly TokenClient[]

/**
 * The arguments a POSIX shell hands the program a snippet runs, with the
 * program replaced by one that prints them; `export` lines print the variable.
 */
function shellArguments(code: string): string[] {
  const script = `
    for program in claude codex code gemini; do
      eval "$program() { for argument in \\"\\$@\\"; do printf '%s\\\\0' \\"\\$argument\\"; done; }"
    done
    ${code}
    if [ -n "\${FLARE_TOKEN+set}" ]; then printf '%s\\0' "$FLARE_TOKEN"; fi
  `
  const output = execFileSync('sh', ['-c', script], {
    cwd: '/',
    // Nothing of this process's environment but the path to `sh`.
    env: { NODE_ENV: 'test', PATH: process.env.PATH ?? '' },
  })
  return output.toString('utf8').split('\0').slice(0, -1)
}

describe('MCP client setup', () => {
  it('lists the clients in the order the picker shows them', () => {
    expect(AGENT_CLIENTS.map(({ id, label, method }) => [id, label, method]))
      .toMatchInlineSnapshot(`
        [
          [
            "claude-code",
            "Claude Code",
            "token",
          ],
          [
            "claude",
            "Claude",
            "sign-in",
          ],
          [
            "chatgpt",
            "ChatGPT",
            "sign-in",
          ],
          [
            "cursor",
            "Cursor",
            "token",
          ],
          [
            "vscode",
            "VS Code",
            "token",
          ],
          [
            "codex",
            "Codex",
            "token",
          ],
          [
            "gemini-cli",
            "Gemini CLI",
            "token",
          ],
          [
            "other",
            "Other",
            "token",
          ],
        ]
      `)
    expect(() => agentClient('emacs')).toThrow('Unknown MCP client: emacs')
  })

  it('pins the Claude Code command and project file', () => {
    expect(snippet('claude-code', 'command')).toBe(
      'claude mcp add --transport http flare https://files.example.com/api/mcp --header "Authorization: Bearer flr_Abc-123_xyz"'
    )
    expect(snippet('claude-code', 'check')).toBe('claude mcp list')
    // The file names the variable, never the token.
    expect(JSON.parse(snippet('claude-code', 'file'))).toEqual({
      mcpServers: {
        flare: {
          type: 'http',
          url: URL_,
          headers: { Authorization: 'Bearer ${FLARE_TOKEN}' },
        },
      },
    })
    expect(snippet('claude-code', 'file')).not.toContain(TOKEN)
    expect(snippet('claude-code', 'variable')).toBe(
      'export FLARE_TOKEN=flr_Abc-123_xyz'
    )
  })

  it('pins the Codex command, variable and config file', () => {
    expect(snippet('codex', 'command')).toBe(
      'codex mcp add flare --url https://files.example.com/api/mcp --bearer-token-env-var FLARE_TOKEN'
    )
    expect(snippet('codex', 'variable')).toBe(
      'export FLARE_TOKEN=flr_Abc-123_xyz'
    )
    expect(snippet('codex', 'file')).toBe(
      '[mcp_servers.flare]\nurl = "https://files.example.com/api/mcp"\nbearer_token_env_var = "FLARE_TOKEN"'
    )
  })

  it('pins the Cursor install link and file', () => {
    const server = {
      url: URL_,
      headers: { Authorization: 'Bearer flr_Abc-123_xyz' },
    }
    const { href, label, note } = link('cursor')
    expect(label).toBe('Add to Cursor')
    expect(note).toBe(
      'The link contains the token and hands it to Cursor. Do not share it.'
    )
    expect(href).toBe(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=flare&config=${encodeURIComponent(
        Buffer.from(JSON.stringify(server)).toString('base64')
      )}`
    )
    const parsed = new URL(href)
    expect(parsed.searchParams.get('name')).toBe('flare')
    expect(
      JSON.parse(
        Buffer.from(parsed.searchParams.get('config')!, 'base64').toString()
      )
    ).toEqual(server)
    expect(JSON.parse(snippet('cursor', 'file'))).toEqual({
      mcpServers: { flare: server },
    })
  })

  it('pins the VS Code command, install link and file', () => {
    const server = {
      type: 'http',
      url: URL_,
      headers: { Authorization: 'Bearer flr_Abc-123_xyz' },
    }
    const named =
      '{"name":"flare","type":"http","url":"https://files.example.com/api/mcp","headers":{"Authorization":"Bearer flr_Abc-123_xyz"}}'
    expect(snippet('vscode', 'command')).toBe(`code --add-mcp '${named}'`)
    const { href, label } = link('vscode')
    expect(label).toBe('Add to VS Code')
    expect(href).toBe(`vscode:mcp/install?${encodeURIComponent(named)}`)
    expect(
      JSON.parse(decodeURIComponent(href.slice('vscode:mcp/install?'.length)))
    ).toEqual({ name: 'flare', ...server })
    expect(JSON.parse(snippet('vscode', 'file'))).toEqual({
      servers: { flare: server },
    })
  })

  it('pins the Gemini CLI command and settings file', () => {
    expect(snippet('gemini-cli', 'command')).toBe(
      'gemini mcp add --transport http --header "Authorization: Bearer flr_Abc-123_xyz" flare https://files.example.com/api/mcp'
    )
    expect(JSON.parse(snippet('gemini-cli', 'file'))).toEqual({
      mcpServers: {
        flare: {
          httpUrl: URL_,
          headers: { Authorization: 'Bearer flr_Abc-123_xyz' },
        },
      },
    })
  })

  it('pins the values and the local bridge for other clients', () => {
    expect(snippet('other', 'url')).toBe(URL_)
    expect(snippet('other', 'header')).toBe(
      'Authorization: Bearer flr_Abc-123_xyz'
    )
    expect(setup('other').steps[0].text).toContain('Streamable HTTP')
    expect(JSON.parse(snippet('other', 'bridge'))).toEqual({
      command: 'npx',
      args: [
        '-y',
        'mcp-remote',
        URL_,
        '--header',
        'Authorization: Bearer flr_Abc-123_xyz',
      ],
    })
    // mcp-remote takes plain HTTP only from this computer unless told to.
    const bridge = (url: string) =>
      JSON.parse(snippet('other', 'bridge', url)).args.slice(5)
    expect(bridge('http://localhost:3000/api/mcp')).toEqual([])
    expect(bridge('http://127.0.0.1:3000/api/mcp')).toEqual([])
    expect(bridge('http://192.168.1.20:3000/api/mcp')).toEqual(['--allow-http'])
  })

  it('gives every step something that exists, and other ways after it', () => {
    for (const client of tokenClients) {
      const { steps, snippets, links } = client.setup(URL_, TOKEN)
      expect(steps.length).toBeGreaterThan(0)
      const snippetIds = snippets.map(({ id }) => id)
      const linkIds = links.map(({ id }) => id)
      expect(new Set(snippetIds).size).toBe(snippetIds.length)
      for (const step of steps) {
        if (step.snippet) expect(snippetIds).toContain(step.snippet)
        if (step.link) expect(linkIds).toContain(step.link)
        expect(Boolean(step.snippet) || Boolean(step.link)).toBe(true)
      }
      // Each link is the subject of a step: none sits unexplained.
      for (const id of linkIds)
        expect(steps.some((step) => step.link === id)).toBe(true)
      for (const { language, code } of snippets)
        if (language === 'json') expect(() => JSON.parse(code)).not.toThrow()
    }
  })

  it('marks code in its sentences the way Markdown does', () => {
    const sentences = tokenClients.flatMap((client) => {
      const { steps, snippets, links } = client.setup(URL_, TOKEN)
      return [
        ...steps.map(({ text }) => text),
        ...snippets.flatMap(({ note }) => (note ? [note] : [])),
        ...links.map(({ note }) => note),
      ]
    })
    // Backticks come in pairs, and no sentence carries the token or a dash.
    for (const sentence of sentences) {
      expect(sentence.split('`').length % 2).toBe(1)
      expect(sentence).not.toContain(TOKEN)
      expect(sentence).not.toMatch(/[\u2013\u2014]/)
    }
    expect(setup('claude-code').steps.map(({ text }) => text)).toEqual([
      'Run this in a terminal, in the project you want to use Flare from. Add `--scope user` to use it in every project.',
      'Check that flare is listed as connected.',
    ])
    expect(setup('codex').steps.map(({ text }) => text)).toEqual([
      'Run this in a terminal.',
      'Codex reads the token from `FLARE_TOKEN`. Set it in the shell that starts Codex, or in your shell profile to keep it.',
    ])
    expect(setup('cursor').steps[0].text).toBe(
      'Use this link on the computer that runs Cursor, then confirm the install in Cursor.'
    )
    expect(setup('vscode').steps[0].text).toBe(
      'Use this link on the computer that runs VS Code, then confirm the install in VS Code.'
    )
  })

  it('builds nothing before a token exists', () => {
    for (const client of tokenClients) {
      expect(() => client.setup(URL_, '')).toThrow(
        'Setup steps need the server URL and a token.'
      )
      expect(() => client.setup('', TOKEN)).toThrow()
    }
  })

  it('has no steps and no token for the clients that sign in', () => {
    const claude = agentClient('claude')
    const chatgpt = agentClient('chatgpt')
    expect(claude).not.toHaveProperty('setup')
    expect(chatgpt).not.toHaveProperty('setup')
    expect(claude.method === 'sign-in' && claude.unavailable).toBe(
      "Claude on desktop and the web cannot connect yet. It connects from Anthropic's servers and signs in through your browser instead of using a token. Browser sign-in arrives in a later release and needs a public HTTPS address. Claude Code works today."
    )
    expect(chatgpt.method === 'sign-in' && chatgpt.unavailable).toBe(
      "ChatGPT cannot connect yet. It connects from OpenAI's servers and signs in through your browser instead of using a token. Browser sign-in arrives in a later release and needs a public HTTPS address. Codex works today."
    )
  })

  it('hands a shell the token as one intact argument', () => {
    const header = `Authorization: Bearer ${HOSTILE}`
    expect(shellArguments(snippet('claude-code', 'command', URL_, HOSTILE)))
      // The stand-in program prints its arguments, not its own name.
      .toEqual([
        'mcp',
        'add',
        '--transport',
        'http',
        'flare',
        URL_,
        '--header',
        header,
      ])
    expect(
      shellArguments(snippet('gemini-cli', 'command', URL_, HOSTILE))
    ).toEqual([
      'mcp',
      'add',
      '--transport',
      'http',
      '--header',
      header,
      'flare',
      URL_,
    ])
    expect(
      shellArguments(snippet('claude-code', 'variable', URL_, HOSTILE))
    ).toEqual([HOSTILE])
    expect(shellArguments(snippet('codex', 'variable', URL_, HOSTILE))).toEqual(
      [HOSTILE]
    )
    const [flag, config] = shellArguments(
      snippet('vscode', 'command', URL_, HOSTILE)
    )
    expect(flag).toBe('--add-mcp')
    expect(JSON.parse(config).headers.Authorization).toBe(`Bearer ${HOSTILE}`)
    // An ordinary token keeps the double quotes the vendors' docs show.
    expect(shellArguments(snippet('claude-code', 'command'))).toEqual([
      'mcp',
      'add',
      '--transport',
      'http',
      'flare',
      URL_,
      '--header',
      'Authorization: Bearer flr_Abc-123_xyz',
    ])
  })

  it('quotes an address a shell would split', () => {
    const odd = 'https://files.example.com/api/mcp?a=1&b=$(id)'
    expect(shellArguments(snippet('claude-code', 'command', odd))[5]).toBe(odd)
    expect(shellArguments(snippet('codex', 'command', odd))).toEqual([
      'mcp',
      'add',
      'flare',
      '--url',
      odd,
      '--bearer-token-env-var',
      'FLARE_TOKEN',
    ])
    expect(shellArguments(snippet('gemini-cli', 'command', odd)).at(-1)).toBe(
      odd
    )
  })

  it('keeps a hostile token inside its string in files and links', () => {
    const bearer = `Bearer ${HOSTILE}`
    expect(
      JSON.parse(snippet('cursor', 'file', URL_, HOSTILE)).mcpServers.flare
        .headers.Authorization
    ).toBe(bearer)
    const cursor = new URL(link('cursor', HOSTILE).href)
    expect(
      JSON.parse(
        Buffer.from(cursor.searchParams.get('config')!, 'base64').toString()
      ).headers.Authorization
    ).toBe(bearer)
    // Past Latin-1, where btoa alone would throw.
    const wide = new URL(link('cursor', 'flr_é✓').href)
    expect(
      JSON.parse(
        Buffer.from(wide.searchParams.get('config')!, 'base64').toString()
      ).headers.Authorization
    ).toBe('Bearer flr_é✓')
    const vscode = link('vscode', HOSTILE).href
    expect(
      JSON.parse(decodeURIComponent(vscode.slice(vscode.indexOf('?') + 1)))
        .headers.Authorization
    ).toBe(bearer)
    expect(snippet('codex', 'file', 'https://x.test/a"b\\c')).toContain(
      'url = "https://x.test/a\\"b\\\\c"'
    )
  })
})

describe('whether cloud clients can reach an address', () => {
  it.each([
    ['https://files.example.com/api/mcp', true],
    ['https://files.example.com:8443/api/mcp', true],
    ['https://[2001:db8::1]/api/mcp', true],
    ['http://files.example.com/api/mcp', false],
    ['https://localhost:3000/api/mcp', false],
    ['https://app.localhost/api/mcp', false],
    ['https://127.0.0.1/api/mcp', false],
    ['https://[::1]/api/mcp', false],
    ['https://10.0.0.5/api/mcp', false],
    ['https://172.16.4.1/api/mcp', false],
    ['https://172.32.4.1/api/mcp', true],
    ['https://192.168.1.20/api/mcp', false],
    ['https://169.254.10.10/api/mcp', false],
    ['https://100.101.102.103/api/mcp', false],
    ['https://100.63.0.1/api/mcp', true],
    ['https://[fd12:3456::1]/api/mcp', false],
    ['https://[fe80::1]/api/mcp', false],
    ['https://flare/api/mcp', false],
    ['https://nas.local/api/mcp', false],
    ['https://flare.internal/api/mcp', false],
    ['not a url', false],
    ['', false],
  ])('%s: %s', (url, expected) => {
    expect(reachableFromCloud(url)).toBe(expected)
  })
})

describe('permission presets', () => {
  const groupScopes = API_SCOPE_CATALOG.filter(
    ({ group }) => group === 'files' || group === 'links'
  ).map(({ scope }) => scope)

  it('offers read only, read and upload, and everything', () => {
    expect(AGENT_PRESETS.map(({ id, label }) => [id, label])).toEqual([
      ['read', 'Read only'],
      ['upload', 'Read and upload'],
      ['all', 'Everything in my account'],
    ])
    expect(DEFAULT_AGENT_PRESET).toBe('upload')
    const [read, upload, all] = AGENT_PRESETS.map(({ scopes }) => [...scopes])
    expect(read).toEqual(['files:read', 'files:content', 'urls:read'])
    expect(upload).toEqual([...read, 'files:upload'])
    // Every Files and Short links scope, in the catalog's order.
    expect(all).toEqual(groupScopes)
  })

  it('holds only scopes MCP honors, and never the marker', () => {
    for (const { scopes } of AGENT_PRESETS)
      for (const scope of scopes) {
        expect(MCP_SCOPES).toContain(scope)
        expect(scope).not.toBe('mcp')
      }
  })
})
