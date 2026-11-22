import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import { API_SCOPE_CATALOG } from '@/lib/integrations/bearer-routes'
import { MCP_SCOPES } from '@/lib/mcp/catalog'
import {
  AGENT_CLIENTS,
  AGENT_PRESETS,
  type AgentClient,
  type AgentSetup,
  DEFAULT_AGENT_PRESET,
  type TokenClient,
  agentClient,
  agentScopeChoices,
  destinationLabel,
  offeredPresets,
  outOfReach,
  reachableFromCloud,
  returnDestination,
  shownClientName,
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

// Read as the general type, so a step's optional parts can be asked for.
const clients: readonly AgentClient[] = AGENT_CLIENTS
const signIn = (id: string, url = URL_): AgentSetup =>
  agentClient(id).signIn(url)
const signInSnippet = (id: string, name: string, url = URL_) => {
  const found = signIn(id, url).snippets.find(
    (candidate) => candidate.id === name
  )
  if (!found) throw new Error(`${id} has no ${name} sign-in snippet`)
  return found.code
}
const signInSteps = (id: string) => signIn(id).steps.map(({ text }) => text)
/** How every sign-in ends. */
const CONSENT = 'Flare opens in your browser, where you choose what it may do.'

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
        ...links.flatMap(({ note }) => (note ? [note] : [])),
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

  it('has no token steps for the clients that only sign in', () => {
    expect(agentClient('claude')).not.toHaveProperty('setup')
    expect(agentClient('chatgpt')).not.toHaveProperty('setup')
    // Every install link that holds a token says where the token goes.
    for (const client of tokenClients)
      for (const { note } of client.setup(URL_, TOKEN).links)
        expect(note).toMatch(/^The link contains the token/)
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

describe('signing in', () => {
  it('pins the Claude Code command and steps', () => {
    expect(signInSnippet('claude-code', 'command')).toBe(
      'claude mcp add --transport http flare https://files.example.com/api/mcp'
    )
    expect(signInSteps('claude-code')).toEqual([
      'Run this in a terminal, in the project you want to use Flare from. Add `--scope user` to use it in every project.',
      `In Claude Code, run \`/mcp\`, choose flare and authenticate. ${CONSENT}`,
    ])
  })

  it('pins the Codex commands and steps', () => {
    expect(signInSnippet('codex', 'command')).toBe(
      'codex mcp add flare --url https://files.example.com/api/mcp'
    )
    expect(signInSnippet('codex', 'login')).toBe('codex mcp login flare')
    expect(signIn('codex').steps).toEqual([
      {
        text: `Run this in a terminal. Codex starts the sign-in itself. ${CONSENT}`,
        snippet: 'command',
      },
      {
        text: 'If Codex did not start the sign-in, run this.',
        snippet: 'login',
      },
    ])
  })

  it('pins the Cursor install link, file and steps', () => {
    const server = { url: URL_ }
    const [{ href, label, note }] = signIn('cursor').links
    expect(label).toBe('Add to Cursor')
    expect(note).toBeUndefined()
    expect(href).toBe(
      `cursor://anysphere.cursor-deeplink/mcp/install?name=flare&config=${encodeURIComponent(
        Buffer.from('{"url":"https://files.example.com/api/mcp"}').toString(
          'base64'
        )
      )}`
    )
    const parsed = new URL(href)
    expect(parsed.searchParams.get('name')).toBe('flare')
    expect(
      JSON.parse(
        Buffer.from(parsed.searchParams.get('config')!, 'base64').toString()
      )
    ).toEqual(server)
    expect(signInSnippet('cursor', 'file')).toBe(
      JSON.stringify({ mcpServers: { flare: server } }, null, 2)
    )
    expect(JSON.parse(signInSnippet('cursor', 'file'))).toEqual({
      mcpServers: { flare: { url: URL_ } },
    })
    expect(signIn('cursor').steps).toEqual([
      {
        text: 'Use this link on the computer that runs Cursor, then confirm the install in Cursor.',
        link: 'install',
      },
      { text: `Cursor then offers to sign in. ${CONSENT}` },
    ])
  })

  it('pins the VS Code command, install link and steps', () => {
    const named =
      '{"name":"flare","type":"http","url":"https://files.example.com/api/mcp"}'
    expect(signInSnippet('vscode', 'command')).toBe(`code --add-mcp '${named}'`)
    const [{ href, label, note }] = signIn('vscode').links
    expect(label).toBe('Add to VS Code')
    expect(note).toBeUndefined()
    expect(href).toBe(`vscode:mcp/install?${encodeURIComponent(named)}`)
    expect(
      JSON.parse(decodeURIComponent(href.slice('vscode:mcp/install?'.length)))
    ).toEqual({ name: 'flare', type: 'http', url: URL_ })
    expect(signIn('vscode').steps).toEqual([
      {
        text: 'Use this link on the computer that runs VS Code, then confirm the install in VS Code.',
        link: 'install',
      },
      {
        text: `VS Code asks to sign in the first time it uses the server. ${CONSENT}`,
      },
    ])
  })

  it('pins the Gemini CLI command and steps', () => {
    expect(signInSnippet('gemini-cli', 'command')).toBe(
      'gemini mcp add --transport http flare https://files.example.com/api/mcp'
    )
    expect(signInSteps('gemini-cli')).toEqual([
      'Run this in a terminal.',
      `Gemini CLI starts the sign-in the first time it uses the server. ${CONSENT}`,
    ])
  })

  it('pins the click path for Claude and the general one for ChatGPT', () => {
    expect(signIn('claude').steps).toEqual([
      {
        text: 'In Claude, open Customize, then Connectors. Choose "+ Add", then "Add custom connector".',
      },
      { text: 'Name it Flare and paste this URL.', snippet: 'url' },
      { text: `Add the connector, then sign in. ${CONSENT}` },
    ])
    expect(signIn('chatgpt').steps).toEqual([
      {
        text: "In ChatGPT's connector settings, add a custom MCP server (connector) with this URL and OAuth as its authentication.",
        snippet: 'url',
      },
      { text: `Sign in when ChatGPT asks. ${CONSENT}` },
    ])
    for (const id of ['claude', 'chatgpt']) {
      expect(signInSnippet(id, 'url')).toBe(URL_)
      expect(signIn(id).snippets).toHaveLength(1)
      expect(signIn(id).links).toEqual([])
    }
  })

  it('pins the URL and what to expect for other clients', () => {
    expect(signInSnippet('other', 'url')).toBe(URL_)
    expect(signInSteps('other')).toEqual([
      'Add a remote MCP server with this URL. The transport is Streamable HTTP.',
      `The client signs in with OAuth. ${CONSENT} If the client cannot do that, use a token instead.`,
    ])
  })

  it('gives every client steps whose snippets and links exist', () => {
    for (const client of clients) {
      const { steps, snippets, links } = client.signIn(URL_)
      expect(steps.length).toBeGreaterThan(1)
      const snippetIds = snippets.map(({ id }) => id)
      const linkIds = links.map(({ id }) => id)
      expect(new Set(snippetIds).size).toBe(snippetIds.length)
      for (const step of steps) {
        if (step.snippet) expect(snippetIds).toContain(step.snippet)
        if (step.link) expect(linkIds).toContain(step.link)
      }
      // The first step always has something to copy or open.
      expect(
        Boolean(steps[0].snippet || steps[0].link || steps[1].snippet)
      ).toBe(true)
      for (const id of linkIds)
        expect(steps.some((step) => step.link === id)).toBe(true)
      for (const { language, code } of snippets)
        if (language === 'json') expect(() => JSON.parse(code)).not.toThrow()
      // Every client ends in the browser, on Flare's own screen. Said once.
      expect(steps.filter(({ text }) => text.includes(CONSENT))).toHaveLength(1)
      expect(() => client.signIn('')).toThrow(
        'Setup steps need the server URL.'
      )
    }
  })

  it('holds no secret and no token wording', () => {
    for (const client of clients) {
      const { steps, snippets, links } = client.signIn(URL_)
      const everything = [
        ...steps.map(({ text }) => text),
        ...snippets.flatMap(({ code, note, title }) => [code, note, title]),
        ...links.flatMap(({ href, label, note }) => [
          decodeURIComponent(href),
          label,
          note,
        ]),
      ].join('\n')
      expect(everything).not.toMatch(/Bearer|Authorization|header|FLARE_TOKEN/)
      expect(everything).not.toMatch(/[\u2013\u2014]/)
      // Backticks come in pairs.
      for (const { text } of steps) expect(text.split('`').length % 2).toBe(1)
      // Only "use a token instead" for a client that may not manage OAuth.
      expect(/token/.test(everything)).toBe(client.id === 'other')
    }
  })

  it('hands a shell the address as one intact argument', () => {
    const odd = "https://files.example.com/api/mcp?a=1&b=$(id)'`x`"
    expect(shellArguments(signInSnippet('claude-code', 'command'))).toEqual([
      'mcp',
      'add',
      '--transport',
      'http',
      'flare',
      URL_,
    ])
    expect(
      shellArguments(signInSnippet('claude-code', 'command', odd))
    ).toEqual(['mcp', 'add', '--transport', 'http', 'flare', odd])
    expect(shellArguments(signInSnippet('codex', 'command', odd))).toEqual([
      'mcp',
      'add',
      'flare',
      '--url',
      odd,
    ])
    expect(shellArguments(signInSnippet('codex', 'login'))).toEqual([
      'mcp',
      'login',
      'flare',
    ])
    expect(shellArguments(signInSnippet('gemini-cli', 'command', odd))).toEqual(
      ['mcp', 'add', '--transport', 'http', 'flare', odd]
    )
    const [flag, config] = shellArguments(
      signInSnippet('vscode', 'command', odd)
    )
    expect(flag).toBe('--add-mcp')
    expect(JSON.parse(config)).toEqual({
      name: 'flare',
      type: 'http',
      url: odd,
    })
  })

  it('keeps an odd address inside its string in files and links', () => {
    const odd = 'https://files.example.com/api/mcp?q="é✓"&x=\\'
    expect(
      JSON.parse(signInSnippet('cursor', 'file', odd)).mcpServers.flare.url
    ).toBe(odd)
    const cursor = new URL(signIn('cursor', odd).links[0].href)
    expect(
      JSON.parse(
        Buffer.from(cursor.searchParams.get('config')!, 'base64').toString()
      )
    ).toEqual({ url: odd })
    const vscode = signIn('vscode', odd).links[0].href
    expect(
      JSON.parse(decodeURIComponent(vscode.slice(vscode.indexOf('?') + 1))).url
    ).toBe(odd)
  })

  it('says plainly when a cloud client cannot reach the address', () => {
    const local = 'http://localhost:3000/api/mcp'
    expect(outOfReach(agentClient('claude'), local)).toBe(
      "Claude on desktop and the web connects from Anthropic's servers, so it needs a public HTTPS address. This instance's address is not one. A local client such as Claude Code works with it."
    )
    expect(outOfReach(agentClient('chatgpt'), local)).toBe(
      "ChatGPT connects from OpenAI's servers, so it needs a public HTTPS address. This instance's address is not one. A local client such as Codex works with it."
    )
    expect(outOfReach(agentClient('claude'), URL_)).toBeNull()
    expect(outOfReach(agentClient('chatgpt'), URL_)).toBeNull()
    // Clients on the person's computer reach whatever the browser reaches.
    for (const client of tokenClients) {
      expect(outOfReach(client, local)).toBeNull()
      expect(outOfReach(client, 'http://192.168.1.20/api/mcp')).toBeNull()
    }
  })
})

describe('a client name on screen', () => {
  it.each([
    ['Claude Code', 'Claude Code'],
    ['  Claude\n\tCode  ', 'Claude Code'],
    ['Claude   Code', 'Claude Code'],
    // Right-to-left overrides and zero-width characters draw nothing.
    ['‮edoC edualC‬', 'edoC edualC'],
    ['Clau​de⁦ Code⁩', 'Claude Code'],
    ['<b onclick="x()">Hi</b>', '<b onclick="x()">Hi</b>'],
    ['', 'Unnamed agent'],
    [' ​\n', 'Unnamed agent'],
  ])('%j is shown as %j', (name, shown) => {
    expect(shownClientName(name)).toBe(shown)
  })
})

describe('where a sign-in returns to', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', 'claude.ai', 'claude.ai'],
    ['https://chatgpt.com/connector_platform_oauth_redirect', 'chatgpt.com'],
    ['https://example.com:8443/cb', 'example.com:8443'],
    // A lookalike name (a Cyrillic "a") shows as what it is.
    ['https://cl\u0430ude.ai/cb', 'xn--clude-5ve.ai'],
    ['http://localhost:54321/callback', 'this device', 'Local app'],
    ['http://127.0.0.1:8080/', 'this device', 'Local app'],
    ['http://[::1]:9/cb', 'this device', 'Local app'],
    [
      'cursor://anysphere.cursor-mcp/oauth/callback',
      'an app on this device (cursor://)',
      'Local app (cursor://)',
    ],
    [
      'vscode://dynamicauthprovider/files.example.com/authorize',
      'an app on this device (vscode://)',
      'Local app (vscode://)',
    ],
    [
      'com.example.app:/oauth',
      'an app on this device (com.example.app://)',
      'Local app (com.example.app://)',
    ],
  ])('%s: %s', (uri, here, listed = here) => {
    const destination = returnDestination(uri)!
    expect(destinationLabel(destination, true)).toBe(here)
    expect(destinationLabel(destination, false)).toBe(listed)
  })

  it('tells a website, this device and an app apart', () => {
    expect(returnDestination('https://claude.ai/cb')).toEqual({
      kind: 'site',
      host: 'claude.ai',
    })
    expect(returnDestination('http://localhost:1/cb')).toEqual({
      kind: 'device',
    })
    expect(returnDestination('cursor://x/cb')).toEqual({
      kind: 'app',
      scheme: 'cursor://',
    })
    // A name that only starts like this computer's is a website.
    expect(returnDestination('https://localhost.example.com/cb')).toEqual({
      kind: 'site',
      host: 'localhost.example.com',
    })
    expect(returnDestination('not a url')).toBeNull()
    expect(returnDestination('')).toBeNull()
  })

  it('has no destination for an address the browser would run or show itself', () => {
    for (const uri of [
      'javascript:alert(1)',
      'JavaScript://x/%0aalert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'blob:https://files.example.com/1',
      'file:///etc/passwd',
      'about:blank',
    ])
      expect(returnDestination(uri), uri).toBeNull()
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

  it('offers a role only the presets it can tell apart', () => {
    expect(offeredPresets(groupScopes).map(({ id }) => id)).toEqual([
      'read',
      'upload',
      'all',
    ])
    // Without uploading, Read and upload is Read only under another name.
    const noUpload = groupScopes.filter((scope) => scope !== 'files:upload')
    expect(offeredPresets(noUpload).map(({ id }) => id)).toEqual([
      'read',
      'all',
    ])
    expect(offeredPresets(['files:upload'])).toEqual([
      expect.objectContaining({ id: 'upload', scopes: ['files:upload'] }),
    ])
    expect(offeredPresets([])).toEqual([])
  })
})

describe('what a permission picker starts on', () => {
  const available = API_SCOPE_CATALOG.map(({ scope }) => scope).filter(
    (scope) => scope !== 'mcp'
  )
  const [read, upload] = AGENT_PRESETS.map(({ scopes }) => [...scopes])
  const inOrder = (scopes: readonly string[]) =>
    available.filter((scope) => scopes.includes(scope))
  const ids = (choices: { presets: { id: string }[] }) =>
    choices.presets.map(({ id }) => id)

  it('starts a new connection on Read and upload', () => {
    const choices = agentScopeChoices(available)
    expect(choices.offered).toEqual(available)
    expect(ids(choices)).toEqual(['read', 'upload', 'all'])
    expect(choices.choice).toBe('upload')
    expect(choices.scopes).toEqual(inOrder(upload))
    // A client that asks for everything changes nothing.
    expect(agentScopeChoices(available, { ceiling: available })).toEqual(
      choices
    )
    // Neither does one that names only scopes Flare does not have.
    expect(agentScopeChoices(available, { ceiling: [] })).toEqual(choices)
  })

  it('never offers more than the client asked for', () => {
    const readOnly = agentScopeChoices(available, { ceiling: read })
    expect(readOnly.offered).toEqual(inOrder(read))
    expect(ids(readOnly)).toEqual(['read'])
    expect(readOnly.choice).toBe('read')
    expect(readOnly.scopes).toEqual(inOrder(read))

    // No preset fits inside two scopes, so both are simply ticked.
    const narrow = agentScopeChoices(available, {
      ceiling: ['files:upload', 'files:read', 'made:up'],
    })
    expect(narrow.offered).toEqual(['files:upload', 'files:read'])
    expect(narrow.presets).toEqual([])
    expect(narrow.choice).toBe('custom')
    expect(narrow.scopes).toEqual(['files:upload', 'files:read'])

    // A ceiling between two presets offers the smaller one.
    const between = agentScopeChoices(available, {
      ceiling: [...upload, 'files:delete'],
    })
    expect(ids(between)).toEqual(['read', 'upload'])
    expect(between.choice).toBe('upload')
    expect(between.offered).toContain('files:delete')
  })

  it('never offers what the role cannot use', () => {
    const role = ['files:read', 'files:content', 'urls:read']
    const choices = agentScopeChoices(role, { ceiling: available })
    expect(choices.offered).toEqual(role)
    expect(ids(choices)).toEqual(['read'])
    expect(choices.choice).toBe('read')
    // Nothing the client asked for is something this role can use.
    expect(agentScopeChoices(role, { ceiling: ['files:delete'] })).toEqual({
      offered: [],
      presets: [],
      choice: 'custom',
      scopes: [],
    })
    expect(agentScopeChoices([])).toEqual({
      offered: [],
      presets: [],
      choice: 'custom',
      scopes: [],
    })
  })

  it('starts an edit on what the connection holds', () => {
    expect(agentScopeChoices(available, { held: read })).toMatchObject({
      choice: 'read',
      scopes: inOrder(read),
    })
    expect(
      agentScopeChoices(available, { held: [...upload].reverse() })
    ).toMatchObject({ choice: 'upload', scopes: inOrder(upload) })
    expect(
      agentScopeChoices(available, { held: ['files:read', 'files:delete'] })
    ).toMatchObject({
      choice: 'custom',
      scopes: ['files:read', 'files:delete'],
    })
    // A scope the role lost is not carried into the edit.
    expect(
      agentScopeChoices(['files:read'], { held: ['files:read', 'urls:write'] })
    ).toMatchObject({ choice: 'read', scopes: ['files:read'] })
    expect(agentScopeChoices(available, { held: [] })).toMatchObject({
      choice: 'custom',
      scopes: [],
    })
  })
})
