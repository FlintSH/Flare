export const SHOWCASE_DURATION = 6600

export const showcaseChapters = [
  {
    id: 'capture',
    label: 'Capture',
    icon: 'terminal',
    caption: 'Your capture tools, straight to Flare.',
    description:
      'An illustrated capture moves from a configured screenshot tool into the sample file library, where its share link becomes available.',
    guide: '/guide/screenshot-tools.html',
  },
  {
    id: 'organize',
    label: 'Organize',
    icon: 'files',
    caption: 'A place for every file.',
    description:
      'Two sample files receive a Design tag and move from Unfiled into a Projects folder.',
    guide: '/guide/folders.html',
  },
  {
    id: 'ocr',
    label: 'OCR',
    icon: 'search',
    caption: 'Find the words inside your images.',
    description:
      'The example query invoice finds scan-042.png by text recognized inside the image, even though its filename does not contain invoice.',
    guide: '/guide/library.html#read-text-in-images-with-ocr',
  },
  {
    id: 'storage',
    label: 'Storage',
    icon: 'server',
    caption: 'Local disk or an S3-compatible bucket.',
    description:
      'The illustration shows two alternative destinations for a new upload: local disk or an S3-compatible bucket. It does not move existing files between providers.',
    guide: '/hosting/storage.html',
  },
  {
    id: 'api',
    label: 'API',
    icon: 'code',
    caption: 'Connect your tools. Automate the rest.',
    description:
      'A sample curl request uploads capture.png with a scoped token. The command is an example and is never executed. Signed webhooks are available for file-ready events.',
    guide: '/api/index.html',
  },
  {
    id: 'roles',
    label: 'Roles',
    icon: 'shield',
    caption: 'Give people the access they need.',
    description:
      'In these example grants, Everyone allows viewing files and an added Contributors role allows uploads. Managing instance settings remains ungranted.',
    guide: '/admin/roles.html',
  },
]

export function initialShowcase() {
  return { chapter: 0, elapsed: SHOWCASE_DURATION, mode: 'paused' }
}

export function advanceShowcase(state, delta) {
  if (state.mode !== 'playing' || !Number.isFinite(delta) || delta <= 0)
    return state
  const elapsed = state.elapsed + delta
  return {
    ...state,
    chapter:
      (state.chapter + Math.floor(elapsed / SHOWCASE_DURATION)) %
      showcaseChapters.length,
    elapsed: elapsed % SHOWCASE_DURATION,
  }
}
