/**
 * How each MCP client is told about this server, and the permission presets
 * offered with it. Connect an agent in the profile and the handbook both read
 * this table, so a client's syntax is written once. Every client signs in
 * through the browser; most can take a named token instead.
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

/** A one-click install, handed to an app on the same computer. */
export type AgentLink = {
  id: string
  label: string
  href: string
  /** Where a link that holds the token sends it, shown beside it. */
  note?: string
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
  /**
   * The steps to connect by signing in through the browser. Nothing in them
   * is secret, so they can be shown, copied and shared.
   */
  signIn: (url: string) => AgentSetup
}

/**
 * A client that can send a named token in the `Authorization` header instead
 * of signing in.
 */
export type TokenClient = ClientName & {
  method: 'token'
  /**
   * The steps for this server and this token. It throws without a token, so
   * no install link that holds one can exist before it does.
   */
  setup: (url: string, token: string) => AgentSetup
}

/**
 * A client that only signs in. It connects from its vendor's servers, so it
 * can reach nothing but a public HTTPS address.
 */
export type SignInClient = ClientName & {
  method: 'sign-in'
  /** The client in a sentence, where the picker's short name is not enough. */
  name: string
  vendor: string
  /** A client of the same vendor that runs on the person's computer. */
  local: string
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

function addressed(url: string) {
  if (!url) throw new Error('Setup steps need the server URL.')
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

const RUN = 'Run this in a terminal.'
const RUN_IN_PROJECT =
  'Run this in a terminal, in the project you want to use Flare from. Add `--scope user` to use it in every project.'
const installStep = (app: string) =>
  `Use this link on the computer that runs ${app}, then confirm the install in ${app}.`
const REMOTE_SERVER =
  'Add a remote MCP server with this URL. The transport is Streamable HTTP.'
const CURSOR_FILE_NOTE =
  'In a project, or `~/.cursor/mcp.json` for every project.'
const cursorInstall = (server: unknown) =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_SERVER_NAME}&config=${encodeURIComponent(base64(compact(server)))}`
/** `named` is the server as one line of JSON, with its name. */
const vscodeInstall = (named: string) =>
  `vscode:mcp/install?${encodeURIComponent(named)}`
/** How every sign-in ends, whichever client started it. */
const CONSENT = 'Flare opens in your browser, where you choose what it may do.'
const urlSnippet = (url: string): AgentSnippet => ({
  id: 'url',
  title: 'Server URL',
  language: 'text',
  code: url,
})

/** The clients, in the order the picker lists them. */
export const AGENT_CLIENTS = [
  {
    id: 'claude-code',
    label: 'Claude Code',
    method: 'token',
    signIn(url) {
      addressed(url)
      return {
        steps: [
          { text: RUN_IN_PROJECT, snippet: 'command' },
          {
            text: `In Claude Code, run \`/mcp\`, choose ${MCP_SERVER_NAME} and authenticate. ${CONSENT}`,
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `claude mcp add --transport http ${MCP_SERVER_NAME} ${word(url)}`,
          },
        ],
        links: [],
      }
    },
    setup(url, token) {
      ready(url, token)
      return {
        steps: [
          { text: RUN_IN_PROJECT, snippet: 'command' },
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
    name: 'Claude on desktop and the web',
    vendor: 'Anthropic',
    local: 'Claude Code',
    signIn(url) {
      addressed(url)
      return {
        steps: [
          {
            text: 'In Claude, open Customize, then Connectors. Choose "+ Add", then "Add custom connector".',
          },
          { text: 'Name it Flare and paste this URL.', snippet: 'url' },
          { text: `Add the connector, then sign in. ${CONSENT}` },
        ],
        snippets: [urlSnippet(url)],
        links: [],
      }
    },
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT',
    method: 'sign-in',
    name: 'ChatGPT',
    vendor: 'OpenAI',
    local: 'Codex',
    signIn(url) {
      addressed(url)
      return {
        steps: [
          {
            text: "In ChatGPT's connector settings, add a custom MCP server (connector) with this URL and OAuth as its authentication.",
            snippet: 'url',
          },
          { text: `Sign in when ChatGPT asks. ${CONSENT}` },
        ],
        snippets: [urlSnippet(url)],
        links: [],
      }
    },
  },
  {
    id: 'cursor',
    label: 'Cursor',
    method: 'token',
    signIn(url) {
      addressed(url)
      const server = { url }
      return {
        steps: [
          { text: installStep('Cursor'), link: 'install' },
          { text: `Cursor then offers to sign in. ${CONSENT}` },
        ],
        snippets: [
          {
            id: 'file',
            title: '.cursor/mcp.json',
            note: CURSOR_FILE_NOTE,
            language: 'json',
            code: pretty({ mcpServers: { [MCP_SERVER_NAME]: server } }),
          },
        ],
        links: [
          {
            id: 'install',
            label: 'Add to Cursor',
            href: cursorInstall(server),
          },
        ],
      }
    },
    setup(url, token) {
      ready(url, token)
      const server = { url, headers: { Authorization: `Bearer ${token}` } }
      return {
        steps: [{ text: installStep('Cursor'), link: 'install' }],
        snippets: [
          {
            id: 'file',
            title: '.cursor/mcp.json',
            note: CURSOR_FILE_NOTE,
            language: 'json',
            code: pretty({ mcpServers: { [MCP_SERVER_NAME]: server } }),
          },
        ],
        links: [
          {
            id: 'install',
            label: 'Add to Cursor',
            href: cursorInstall(server),
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
    signIn(url) {
      addressed(url)
      const named = compact({ name: MCP_SERVER_NAME, type: 'http', url })
      return {
        steps: [
          { text: installStep('VS Code'), link: 'install' },
          {
            text: `VS Code asks to sign in the first time it uses the server. ${CONSENT}`,
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `code --add-mcp ${quoted(named)}`,
          },
        ],
        links: [
          {
            id: 'install',
            label: 'Add to VS Code',
            href: vscodeInstall(named),
          },
        ],
      }
    },
    setup(url, token) {
      ready(url, token)
      const server = {
        type: 'http',
        url,
        headers: { Authorization: `Bearer ${token}` },
      }
      const named = compact({ name: MCP_SERVER_NAME, ...server })
      return {
        steps: [{ text: installStep('VS Code'), link: 'install' }],
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
            href: vscodeInstall(named),
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
    signIn(url) {
      addressed(url)
      return {
        steps: [
          {
            // Codex 0.169 starts the sign-in as soon as it has added a
            // server that offers one; older versions wait to be told.
            text: `${RUN} Codex starts the sign-in itself. ${CONSENT}`,
            snippet: 'command',
          },
          {
            text: 'If Codex did not start the sign-in, run this.',
            snippet: 'login',
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `codex mcp add ${MCP_SERVER_NAME} --url ${word(url)}`,
          },
          {
            id: 'login',
            title: TERMINAL,
            language: 'shell',
            code: `codex mcp login ${MCP_SERVER_NAME}`,
          },
        ],
        links: [],
      }
    },
    setup(url, token) {
      ready(url, token)
      return {
        steps: [
          { text: RUN, snippet: 'command' },
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
    signIn(url) {
      addressed(url)
      return {
        steps: [
          { text: RUN, snippet: 'command' },
          {
            text: `Gemini CLI starts the sign-in the first time it uses the server. ${CONSENT}`,
          },
        ],
        snippets: [
          {
            id: 'command',
            title: TERMINAL,
            language: 'shell',
            code: `gemini mcp add --transport http ${MCP_SERVER_NAME} ${word(url)}`,
          },
        ],
        links: [],
      }
    },
    setup(url, token) {
      ready(url, token)
      return {
        steps: [{ text: RUN, snippet: 'command' }],
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
    signIn(url) {
      addressed(url)
      return {
        steps: [
          { text: REMOTE_SERVER, snippet: 'url' },
          {
            text: `The client signs in with OAuth. ${CONSENT} If the client cannot do that, use a token instead.`,
          },
        ],
        snippets: [urlSnippet(url)],
        links: [],
      }
    },
    setup(url, token) {
      ready(url, token)
      const host = hostOf(url)
      // mcp-remote refuses plain HTTP beyond this computer unless told to.
      const plainHttp =
        url.toLowerCase().startsWith('http:') && !!host && !isLoopback(host)
      return {
        steps: [
          { text: REMOTE_SERVER, snippet: 'url' },
          { text: 'Send this header with every request.', snippet: 'header' },
        ],
        snippets: [
          urlSnippet(url),
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
    description:
      'All file, short link and account setting actions, deleting included.',
    scopes: [
      'files:upload',
      'files:read',
      'files:content',
      'files:organize',
      'files:share',
      'files:delete',
      'urls:read',
      'urls:write',
      'account:write',
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

export type OfferedPreset = {
  id: AgentPresetId
  label: string
  description: string
  scopes: string[]
}

/**
 * The presets an account can tell apart: each keeps only the scopes its role
 * can use, in the order given, and one that adds nothing to the one before
 * it is left out.
 */
export function offeredPresets(available: readonly string[]): OfferedPreset[] {
  const presets: OfferedPreset[] = []
  for (const preset of AGENT_PRESETS) {
    const held: readonly string[] = preset.scopes
    const scopes = available.filter((scope) => held.includes(scope))
    if (scopes.length && scopes.length !== presets.at(-1)?.scopes.length)
      presets.push({ ...preset, scopes })
  }
  return presets
}

export type ScopeChoices = {
  /** The scopes that can be granted, in the order given. */
  offered: string[]
  /** The presets on offer, most limited first. Custom is always one more. */
  presets: OfferedPreset[]
  /** What the picker starts on, and the scopes that selects. */
  choice: AgentPresetId | 'custom'
  scopes: string[]
}

/**
 * What a permission picker offers and starts on.
 *
 * `available` is what the account's role can use. `ceiling` is the most a
 * sign-in asked for, where empty means it left the choice to the person: a
 * scope beyond it is not offered, and neither is a preset that reaches past
 * it, since its name would promise more than it grants. `held` is what a
 * connection has now, when its permissions are being edited.
 *
 * A new connection starts on Read and upload, on the smallest preset when
 * that one is not offered, and on everything asked for when no preset fits.
 */
export function agentScopeChoices(
  available: readonly string[],
  {
    ceiling = [],
    held,
  }: { ceiling?: readonly string[]; held?: readonly string[] } = {}
): ScopeChoices {
  const offered = ceiling.length
    ? available.filter((scope) => ceiling.includes(scope))
    : [...available]
  const presets = offeredPresets(available).filter(({ scopes }) =>
    scopes.every((scope) => offered.includes(scope))
  )
  if (held) {
    const scopes = offered.filter((scope) => held.includes(scope))
    const match = presets.find(
      (preset) =>
        preset.scopes.length === scopes.length &&
        preset.scopes.every((scope) => scopes.includes(scope))
    )
    return { offered, presets, choice: match?.id ?? 'custom', scopes }
  }
  const preset =
    presets.find(({ id }) => id === DEFAULT_AGENT_PRESET) ?? presets[0]
  return preset
    ? { offered, presets, choice: preset.id, scopes: preset.scopes }
    : { offered, presets, choice: 'custom', scopes: offered }
}

/**
 * Why a client cannot reach this server, as a sentence for the person, or
 * null when it can. Only the clients that connect from their vendor's
 * servers are ever out of reach.
 */
export function outOfReach(client: AgentClient, url: string): string | null {
  if (client.method !== 'sign-in' || reachableFromCloud(url)) return null
  return `${client.name} connects from ${client.vendor}'s servers, so it needs a public HTTPS address. This instance's address is not one. A local client such as ${client.local} works with it.`
}

/**
 * A client's name as it is shown. The client chose it, so it is only ever
 * text. Characters that draw nothing or reorder what stands beside them are
 * dropped, and line breaks become spaces.
 */
export function shownClientName(name: string): string {
  const shown = name
    .replace(/\p{Cf}/gu, '')
    .replace(/[\p{Cc}\p{Z}]+/gu, ' ')
    .trim()
  return shown || 'Unnamed agent'
}

/**
 * Where a sign-in sends the browser back to. A client picks its own name,
 * so this is the one thing a person can check it by.
 */
export type ReturnDestination =
  /** A website, by its host. */
  | { kind: 'site'; host: string }
  /** A program listening on the computer the browser runs on. */
  | { kind: 'device' }
  /** The app that the computer opens for a private scheme such as `cursor://`. */
  | { kind: 'app'; scheme: string }

/** Schemes the browser runs or shows by itself. No client is reached through one. */
const NEVER_A_CLIENT = /^(javascript|data|vbscript|blob|file|about):$/

/**
 * The destination of a redirect URI, or null when it is not a URL or is one
 * the browser must never be sent to. The server refuses those when a client
 * registers; the consent screen checks again before it follows an address.
 */
export function returnDestination(
  redirectUri: string
): ReturnDestination | null {
  let url: URL
  try {
    url = new URL(redirectUri)
  } catch {
    return null
  }
  if (NEVER_A_CLIENT.test(url.protocol)) return null
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    return { kind: 'app', scheme: `${url.protocol}//` }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return isLoopback(host)
    ? { kind: 'device' }
    : { kind: 'site', host: url.host }
}

/**
 * The destination in words. On the consent screen (`here`) the browser and a
 * local client share a device. The list of connections may be read anywhere,
 * so there a local client is only that.
 */
export function destinationLabel(
  destination: ReturnDestination,
  here: boolean
): string {
  if (destination.kind === 'site') return destination.host
  const app = here ? 'an app on this device' : 'Local app'
  if (destination.kind === 'app') return `${app} (${destination.scheme})`
  return here ? 'this device' : app
}
