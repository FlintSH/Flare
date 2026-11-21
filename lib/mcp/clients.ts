/**
 * How each MCP client is told about this server, and the permission presets
 * offered with it. Connect an agent in the profile and the handbook both read
 * this table, so a client's syntax is written once.
 *
 * Import nothing here except types: the dialog bundles this module for the
 * browser, and the handbook loads it where no other module can be resolved.
 */
import type { ApiScope } from '@/lib/integrations/bearer-routes'

/** The name clients list the server under. */
export const MCP_SERVER_NAME = 'flare'
/** The environment variable read by the snippets that keep the token out of a file. */
export const MCP_TOKEN_VARIABLE = 'FLARE_TOKEN'

export type AgentSnippet = {
  id: string
  /** Where it goes: a terminal, or the file it belongs in. */
  title: string
  /**
   * When to use it or what it needs, for a snippet no step explains. Like a
   * step's text, it marks code with backticks, as Markdown does.
   */
  note?: string
  language: 'shell' | 'json' | 'toml' | 'text'
  code: string
}

/** A one-click install. It hands the token to an app on the same computer. */
export type AgentLink = {
  id: string
  label: string
  href: string
  /** Where the link sends the token, shown beside it. */
  note: string
}

export type AgentStep = {
  /** One or two sentences. Backticks mark code, as in Markdown. */
  text: string
  /** The id of the snippet or the link this step uses. */
  snippet?: string
  link?: string
}

export type AgentSetup = {
  /** The quickest way, in order. */
  steps: AgentStep[]
  /** Everything to copy: what the steps use first, then other ways to do the same. */
  snippets: AgentSnippet[]
  links: AgentLink[]
}

type ClientName = {
  id: string
  /** The short name, as the client picker shows it. */
  label: string
}

/** A client that sends a named token in the `Authorization` header. */
export type TokenClient = ClientName & {
  method: 'token'
  /**
   * The steps for this server and this token. It throws without a token, so
   * no install link can exist before one does.
   */
  setup: (url: string, token: string) => AgentSetup
}

/**
 * A client that connects from its vendor's servers and signs in through the
 * browser. Flare cannot connect these until browser sign-in ships, so there
 * are no steps yet, only what to tell the person.
 */
export type SignInClient = ClientName & {
  method: 'sign-in'
  unavailable: string
}

export type AgentClient = TokenClient | SignInClient

const ORDINARY = /^[\w@%+=:,./-]+$/

/** A value in single quotes, where a shell reads nothing specially. */
function quoted(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** A value as one shell word: bare when every character is ordinary. */
function word(value: string): string {
  return ORDINARY.test(value) ? value : quoted(value)
}

const authorization = (token: string) => `Authorization: Bearer ${token}`

/**
 * The header as one shell argument. Double quotes, as each vendor's docs
 * write it and as Windows shells also accept, while the token has nothing a
 * shell would expand inside them; single quotes otherwise.
 */
function headerArgument(token: string): string {
  const header = authorization(token)
  return /^[\w@%+=:,./ -]+$/.test(header) ? `"${header}"` : quoted(header)
}

/** One line, for a command argument or a link. */
const compact = (value: unknown) => JSON.stringify(value)
/** Indented, for a file someone will read. */
const pretty = (value: unknown) => JSON.stringify(value, null, 2)

/** Base64 of the UTF-8 bytes; `btoa` alone refuses anything past Latin-1. */
function base64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text))
    binary += String.fromCharCode(byte)
  return btoa(binary)
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase()
  } catch {
    return null
  }
}

const isLoopback = (host: string) =>
  host === 'localhost' ||
  host.endsWith('.localhost') ||
  host === '::1' ||
  /^127(\.\d+){3}$/.test(host)

/** IPv4 ranges that never route on the internet: private, link local and carrier-grade NAT. */
const PRIVATE_IPV4 =
  /^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/

/**
 * Whether a vendor's servers can reach this address: HTTPS, on a host that
 * is neither this computer nor inside a private network. Claude and ChatGPT
 * on the web connect that way; local clients need neither.
 */
export function reachableFromCloud(url: string): boolean {
  const host = hostOf(url)
  if (!host || !url.toLowerCase().startsWith('https:')) return false
  if (isLoopback(host) || PRIVATE_IPV4.test(host)) return false
  // IPv6 unique local and link local addresses.
  if (host.includes(':')) return !/^(f[cd]|fe[89ab])/.test(host)
  // A name without a dot, and these suffixes, resolve only inside a network.
  return host.includes('.') && !/\.(local|internal|lan|home\.arpa)$/.test(host)
}

function ready(url: string, token: string) {
  if (!url || !token)
    throw new Error('Setup steps need the server URL and a token.')
}

const TERMINAL = 'Terminal'
const variableSnippet = (token: string, note?: string): AgentSnippet => ({
  id: 'variable',
  title: TERMINAL,
  ...(note && { note }),
  language: 'shell',
  code: `export ${MCP_TOKEN_VARIABLE}=${word(token)}`,
})
const installNote = (app: string) =>
  `The link contains the token and hands it to ${app}. Do not share it.`

const signIn = (name: string, vendor: string, instead: string) =>
  `${name} cannot connect yet. It connects from ${vendor}'s servers and signs in through your browser instead of using a token. Browser sign-in arrives in a later release and needs a public HTTPS address. ${instead} works today.`

/** The clients, in the order the picker lists them. */
export const AGENT_CLIENTS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    method: 'token',
    setup(url, token) {
      ready(url, token)
      return {
        steps: [
          {
            text: 'Run this in a terminal, in the project you want to use Flare from. Add `--scope user` to use it in every project.',
            snippet: 'command',
          },
          {
            text: `Check that ${MCP_SERVER_NAME} is listed as connected.`,
            snippet: 'check',
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${word(url)} --header ${headerArgument(token)}`,
          },
          {
            id: 'check',
            title: TERMINAL,
            language: 'shell',
            code: 'claude mcp list',
          },
          {
            id: 'file',
            title: '.mcp.json',
            note: `To share with a project. It reads the token from \`${MCP_TOKEN_VARIABLE}\`, so the file holds no secret.`,
            language: 'json',
            code: pretty({
              mcpServers: {
                [MCP_SERVER_NAME]: {
                  type: 'http',
                  url,
                  headers: {
                    Authorization: `Bearer \${${MCP_TOKEN_VARIABLE}}`,
                  },
                },
              },
            }),
          },
          variableSnippet(
            token,
            `Sets \`${MCP_TOKEN_VARIABLE}\` for \`.mcp.json\`. Run it in the shell that starts Claude Code.`
          ),
        ],
        links: [],
      }
    },
  },
  {
    id: 'claude',
    label: 'Claude',
    method: 'sign-in',
    unavailable: signIn(
      'Claude on desktop and the web',
      'Anthropic',
      'Claude Code'
    ),
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    method: 'sign-in',
    unavailable: signIn('ChatGPT', 'OpenAI', 'Codex'),
  },
  {
    id: 'cursor',
    label: 'Cursor',
    method: 'token',
    setup(url, token) {
      ready(url, token)
      const server = { url, headers: { Authorization: `Bearer ${token}` } }
      return {
        steps: [
          {
            text: 'Use this link on the computer that runs Cursor, then confirm the install in Cursor.',
            link: 'install',
          },
        ],
        snippets: [
          {
            id: 'file',
            title: '.cursor/mcp.json',
            note: 'In a project, or `~/.cursor/mcp.json` for every project.',
            language: 'json',
            code: pretty({ mcpServers: { [MCP_SERVER_NAME]: server } }),
          },
        ],
        links: [
          {
            id: 'install',
            label: 'Add to Cursor',
            href: `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(base64(compact(server)))}`,
            note: installNote('Cursor'),
          },
        ],
      }
    },
  },
  {
    id: 'vscode',
    label: 'VS Code',
    method: 'token',
    setup(url, token) {
      ready(url, token)
      const server = {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      }
      const named = compact({ name: MCP_SERVER_NAME, ...server })
      return {
        steps: [
          {
            text: 'Use this link on the computer that runs VS Code, then confirm the install in VS Code.',
            link: 'install',
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `code --add-mcp ${quoted(named)}`,
          },
          {
            id: 'file',
            title: '.vscode/mcp.json',
            note: 'In a workspace.',
            language: 'json',
            code: pretty({ servers: { [MCP_SERVER_NAME]: server } }),
          },
        ],
        links: [
          {
            id: 'install',
            label: 'Add to VS Code',
            href: `vscode:mcp/install?${encodeURIComponent(named)}`,
            note: installNote('VS Code'),
          },
        ],
      }
    },
  },
  {
    id: 'codex',
    label: 'Codex',
    method: 'token',
    setup(url, token) {
      ready(url, token)
      return {
        steps: [
          { text: 'Run this in a terminal.', snippet: 'command' },
          {
            text: `Codex reads the token from \`${MCP_TOKEN_VARIABLE}\`. Set it in the shell that starts Codex, or in your shell profile to keep it.`,
            snippet: 'variable',
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `codex mcp add ${MCP_SERVER_NAME} --url ${word(url)} --bearer-token-env-var ${MCP_TOKEN_VARIABLE}`,
          },
          variableSnippet(token),
          {
            id: 'file',
            title: '~/.codex/config.toml',
            note: 'In place of the first command.',
            language: 'toml',
            // A JSON string is also a TOML basic string.
            code: `[mcp_servers.${MCP_SERVER_NAME}]\nurl = ${JSON.stringify(url)}\nbearer_token_env_var = "${MCP_TOKEN_VARIABLE}"`,
          },
        ],
        links: [],
      }
    },
  },
  {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    method: 'token',
    setup(url, token) {
      ready(url, token)
      return {
        steps: [{ text: 'Run this in a terminal.', snippet: 'command' }],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `gemini mcp add --transport http --header ${headerArgument(token)} ${MCP_SERVER_NAME} ${word(url)}`,
          },
          {
            id: 'file',
            title: '~/.gemini/settings.json',
            language: 'json',
            code: pretty({
              mcpServers: {
                [MCP_SERVER_NAME]: {
                  httpUrl: url,
                  headers: { Authorization: `Bearer ${token}` },
                },
              },
            }),
          },
        ],
        links: [],
      }
    },
  },
  {
    id: 'other',
    label: 'Other',
    method: 'token',
    setup(url, token) {
      ready(url, token)
      const host = hostOf(url)
      // mcp-remote refuses plain HTTP beyond this computer unless told to.
      const plainHttp =
        url.toLowerCase().startsWith('http:') && !!host && !isLoopback(host)
      return {
        steps: [
          {
            text: 'Add a remote MCP server with this URL. The transport is Streamable HTTP.',
            snippet: 'url',
          },
          { text: 'Send this header with every request.', snippet: 'header' },
        ],
        snippets: [
          { id: 'url', title: 'Server URL', language: 'text', code: url },
          {
            id: 'header',
            title: 'Header',
            language: 'text',
            code: authorization(token),
          },
          {
            id: 'bridge',
            title: 'mcp-remote',
            note: 'For a client that only starts local servers: add this as the server.',
            language: 'json',
            code: pretty({
              command: 'npx',
              args: [
                '-y',
                'mcp-remote',
                url,
                '--header',
                authorization(token),
                ...(plainHttp ? ['--allow-http'] : []),
              ],
            }),
          },
        ],
        links: [],
      }
    },
  },
] as const satisfies readonly AgentClient[]

export type AgentClientId = (typeof AGENT_CLIENTS)[number]['id']

export function agentClient(id: string): AgentClient {
  const client: AgentClient | undefined = AGENT_CLIENTS.find(
    (candidate) => candidate.id === id
  )
  if (!client) throw new Error(`Unknown MCP client: ${id}`)
  return client
}

/**
 * The permission presets, most limited first. Each lists catalog scopes; the
 * dialog offers only the ones the account's role can use. `urls:write` is
 * left out of the default because it includes deleting links.
 */
export const AGENT_PRESETS = [
  {
    id: 'read',
    label: 'Read only',
    description: 'Find and read files, and list short links.',
    scopes: ['files:read', 'files:content', 'urls:read'],
  },
  {
    id: 'upload',
    label: 'Read and upload',
    description: 'Read only, plus uploading files and pastes.',
    scopes: ['files:read', 'files:content', 'urls:read', 'files:upload'],
  },
  {
    id: 'all',
    label: 'Everything in my account',
    description: 'All file and short link actions, deleting included.',
    scopes: [
      'files:upload',
      'files:read',
      'files:content',
      'files:organize',
      'files:share',
      'files:delete',
      'urls:read',
      'urls:write',
    ],
  },
] as const satisfies readonly {
  id: string
  label: string
  description: string
  scopes: readonly ApiScope[]
}[]

export type AgentPresetId = (typeof AGENT_PRESETS)[number]['id']
export const DEFAULT_AGENT_PRESET: AgentPresetId = 'upload'
