import { z } from 'zod'

import type { Permission } from '@/lib/permissions/catalog'

/** Every configuration carries a new upload token. */
export const UPLOADER_DOWNLOAD_PERMISSION: Permission = 'tokens.manage'

/** Where people get the `flare-upload` program: the release assets of the project. */
export const UPLOAD_PROGRAM_RELEASES_URL =
  'https://github.com/FlintSH/flare/releases'

/** The share-page link in an upload response: `apiResponse(uploadLinks(…))`. */
export const SHARE_LINK_PATH = 'data.pageUrl'

/**
 * How a generated file uploads.
 *
 * - `request`: the file describes or sends one HTTP request with the token
 *   in it. It cannot encrypt, so it is for a `plain` upload profile only
 *   (docs/e2ee-spec.md, section 10.4).
 * - `helper`: the file starts the `flare-upload` program, which reads its
 *   own configuration file, encrypts if that file says so, and prints the
 *   link.
 */
export type UploaderTransport = 'request' | 'helper'

interface UploaderClient<Shape extends z.ZodRawShape> {
  label: string
  options: z.ZodObject<Shape>
  defaults: z.infer<z.ZodObject<Shape>>
  /**
   * Whether the tool can start a program. A tool that only reads a
   * declarative description of a request cannot, and so cannot encrypt.
   */
  runsPrograms: boolean
  /** Commands the generated script checks for before it does anything. */
  dependencies: (
    options: z.infer<z.ZodObject<Shape>>,
    transport: UploaderTransport
  ) => string[]
  /** The downloaded file's name, after the account-name prefix. */
  fileName: (options: z.infer<z.ZodObject<Shape>>) => string
  contentType: 'application/json' | 'text/plain'
}

const uploaderClient = <Shape extends z.ZodRawShape>(
  client: UploaderClient<Shape>
) => client

/** What uploads: curl with jq to read the answer, or the helper program. */
const transportDependencies = (transport: UploaderTransport) =>
  transport === 'helper' ? ['flare-upload'] : ['curl', 'jq']

/** Screenshot scripts copy the link with the session's clipboard tool. */
const screenshotDependencies = (
  tool: string,
  useWayland: boolean,
  transport: UploaderTransport
) => [
  tool,
  ...transportDependencies(transport),
  useWayland ? 'wl-copy' : 'xsel',
]

const captureMode = z.enum(['fullscreen', 'current', 'activewindow', 'region'])
/**
 * `spectacle -R s` records the screen under the pointer, so recording a whole
 * screen is one choice.
 */
const recordingMode = z.enum(['current', 'region'])

interface SpectacleMode {
  label: string
  flag: string
}

export const SPECTACLE_CAPTURE_MODES = {
  fullscreen: { label: 'Full desktop', flag: '-f' },
  current: { label: 'Current monitor', flag: '-m' },
  activewindow: { label: 'Active window', flag: '-a' },
  region: { label: 'Select region', flag: '-r' },
} satisfies Record<z.infer<typeof captureMode>, SpectacleMode>

export const SPECTACLE_RECORDING_MODES = {
  current: { label: 'Current monitor recording', flag: 's' },
  region: { label: 'Select region recording', flag: 'r' },
} satisfies Record<z.infer<typeof recordingMode>, SpectacleMode>

/**
 * The uploader clients Flare writes ready-to-use files for. The dashboard
 * builds its forms from these and `server.ts` answers with them, so a client's
 * options, defaults, dependencies and file name live only here.
 */
const clients = {
  sharex: uploaderClient({
    label: 'ShareX',
    options: z.object({}),
    defaults: {},
    // Through an action of a task; see the ShareX steps of the handbook.
    runsPrograms: true,
    dependencies: () => [],
    fileName: () => 'sharex.sxcu',
    contentType: 'application/json',
  }),
  itake: uploaderClient({
    label: 'iTake',
    options: z.object({}),
    defaults: {},
    // An .itup file describes one HTTP request and nothing else.
    runsPrograms: false,
    dependencies: () => [],
    fileName: () => 'itake.itup',
    contentType: 'application/json',
  }),
  flameshot: uploaderClient({
    label: 'Flameshot',
    runsPrograms: true,
    options: z.object({
      useWayland: z.boolean(),
      /** Hyprland compatibility: Flameshot can't detect Hyprland, so the
       * script reports the desktop as sway. */
      useCompositor: z.boolean(),
    }),
    defaults: { useWayland: false, useCompositor: false },
    dependencies: ({ useWayland }, transport) =>
      screenshotDependencies('flameshot', useWayland, transport),
    fileName: () => 'flameshot.sh',
    contentType: 'text/plain',
  }),
  spectacle: uploaderClient({
    label: 'Spectacle',
    runsPrograms: true,
    options: z.object({
      scriptType: z.enum(['screenshot', 'recording']),
      useWayland: z.boolean(),
      includePointer: z.boolean(),
      captureMode,
      recordingMode,
      /** Milliseconds before a screenshot, for API callers; the form has
       * no control for it. */
      delay: z.number().min(0).max(10000).optional(),
    }),
    defaults: {
      scriptType: 'screenshot',
      useWayland: false,
      includePointer: false,
      captureMode: 'region',
      recordingMode: 'region',
    },
    dependencies: ({ useWayland }, transport) =>
      screenshotDependencies('spectacle', useWayland, transport),
    fileName: ({ scriptType }) => `spectacle-${scriptType}.sh`,
    contentType: 'text/plain',
  }),
  bash: uploaderClient({
    label: 'Bash',
    options: z.object({}),
    defaults: {},
    runsPrograms: true,
    dependencies: (_options, transport) =>
      transport === 'helper'
        ? transportDependencies(transport)
        : [...transportDependencies(transport), 'file'],
    fileName: () => 'upload.sh',
    contentType: 'text/plain',
  }),
}

export type UploaderClientId = keyof typeof clients
type OptionShape<Id extends UploaderClientId> =
  (typeof clients)[Id] extends UploaderClient<infer Shape> ? Shape : never
export type UploaderOptions<Id extends UploaderClientId> = z.infer<
  z.ZodObject<OptionShape<Id>>
>

/** Typed per client, so a generic `id` keeps its own option types. */
export const uploaderClients: {
  [Id in UploaderClientId]: UploaderClient<OptionShape<Id>>
} = clients

/** In the order the dashboard lists them. */
export const UPLOADER_CLIENT_IDS = Object.keys(clients) as UploaderClientId[]
