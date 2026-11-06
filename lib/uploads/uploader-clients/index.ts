import { z } from 'zod'

import type { Permission } from '@/lib/permissions/catalog'

/** Every download carries the account upload token. */
export const UPLOADER_DOWNLOAD_PERMISSION: Permission = 'tokens.manage'

/** The share-page link in an upload response: `apiResponse(uploadLinks(…))`. */
export const SHARE_LINK_PATH = 'data.pageUrl'

interface UploaderClient<Shape extends z.ZodRawShape> {
  /** The tool's name in the dashboard. */
  label: string
  /** POST clients send their options as a JSON body; GET clients have none. */
  method: 'GET' | 'POST'
  options: z.ZodObject<Shape>
  defaults: z.infer<z.ZodObject<Shape>>
  /** Commands the generated script checks for before it does anything. */
  dependencies: (options: z.infer<z.ZodObject<Shape>>) => string[]
  /** The downloaded file's name, after the account-name prefix. */
  fileName: (options: z.infer<z.ZodObject<Shape>>) => string
  contentType: 'application/json' | 'text/plain'
}

const uploaderClient = <Shape extends z.ZodRawShape>(
  client: UploaderClient<Shape>
) => client

/** Screenshot scripts copy the link with the session's clipboard tool. */
const screenshotDependencies = (tool: string, useWayland: boolean) => [
  tool,
  'curl',
  'jq',
  useWayland ? 'wl-copy' : 'xsel',
]

const captureMode = z.enum(['fullscreen', 'current', 'activewindow', 'region'])
/**
 * `spectacle -R s` records the screen under the pointer, so recording a whole
 * screen is one choice. Earlier dashboards offered it twice, also as `fullscreen`.
 */
const recordingMode = z.enum(['current', 'region'])

/** A Spectacle mode's label in the form and its command-line flag. */
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
    method: 'GET',
    options: z.object({}),
    defaults: {},
    dependencies: () => [],
    fileName: () => 'sharex.sxcu',
    contentType: 'application/json',
  }),
  itake: uploaderClient({
    label: 'iTake',
    method: 'GET',
    options: z.object({}),
    defaults: {},
    dependencies: () => [],
    fileName: () => 'itake.itup',
    contentType: 'application/json',
  }),
  flameshot: uploaderClient({
    label: 'Flameshot',
    method: 'POST',
    options: z.object({
      useWayland: z.boolean(),
      /** Hyprland compatibility: Flameshot can't detect Hyprland, so the
       * script reports the desktop as sway. */
      useCompositor: z.boolean(),
    }),
    defaults: { useWayland: false, useCompositor: false },
    dependencies: ({ useWayland }) =>
      screenshotDependencies('flameshot', useWayland),
    fileName: () => 'flameshot.sh',
    contentType: 'text/plain',
  }),
  spectacle: uploaderClient({
    label: 'Spectacle',
    method: 'POST',
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
    dependencies: ({ useWayland }) =>
      screenshotDependencies('spectacle', useWayland),
    fileName: ({ scriptType }) => `spectacle-${scriptType}.sh`,
    contentType: 'text/plain',
  }),
  bash: uploaderClient({
    label: 'Bash',
    method: 'GET',
    options: z.object({}),
    defaults: {},
    dependencies: () => ['curl', 'jq', 'file'],
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

/** The request that downloads a client, selecting `profileId` when given. */
export function uploaderClientRequest<Id extends UploaderClientId>(
  id: Id,
  options: UploaderOptions<Id>,
  profileId?: string
): [string, RequestInit] {
  const url = `/api/profile/${id}${profileId ? `?profileId=${encodeURIComponent(profileId)}` : ''}`
  return uploaderClients[id].method === 'GET'
    ? [url, {}]
    : [
        url,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(options),
        },
      ]
}
