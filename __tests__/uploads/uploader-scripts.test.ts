import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { uploadLinks } from '@/lib/uploads/links'
import { uploaderClients } from '@/lib/uploads/uploader-clients'
import {
  bashScript,
  flameshotScript,
  spectacleScript,
} from '@/lib/uploads/uploader-clients/scripts'

// The scripts run for real; only the desktop tools and curl are stand-ins.
const systemTools = ['bash', 'cat', 'cut', 'du', 'file', 'jq', 'mktemp', 'rm']
const located = Object.fromEntries(
  systemTools.map((tool) => [
    tool,
    spawnSync('sh', ['-c', `command -v ${tool}`], {
      encoding: 'utf8',
    }).stdout.trim(),
  ])
)

const stubs = {
  curl: `printf '%s\\n' "$@" > "$LOG/curl"
[ -n "$CURL_EXIT" ] && exit "$CURL_EXIT"
printf '%s' "$CURL_RESPONSE"`,
  'notify-send': `printf '%s|%s\\n' "$1" "$2" >> "$LOG/notify"`,
  xsel: `cat > "$LOG/clipboard-xsel"`,
  'wl-copy': `cat > "$LOG/clipboard-wl-copy"`,
  flameshot: `printf 'PNG'`,
  spectacle: `printf '%s\\n' "$@" > "$LOG/spectacle"
while [ $# -gt 0 ]; do
  [ "$1" = "-o" ] && printf 'PNG' > "$2"
  shift
done`,
}
type Stub = keyof typeof stubs

const target = {
  uploadUrl: new URL('https://flare.test/api/files?profileId=screens'),
  token: 'account-upload-token',
}
const links = uploadLinks(
  {
    id: 'file-id',
    urlPath: '/owner/shot.png',
    name: 'shot.png',
    mimeType: 'image/png',
    size: 0.01,
  },
  { urlId: 'owner', vanityId: 'alex' }
)
// The body `apiResponse` sends for a finished upload.
const uploaded = JSON.stringify({ data: links, success: true })

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

function run(
  script: string,
  {
    tools,
    args = [],
    env = {},
  }: { tools: Stub[]; args?: string[]; env?: Record<string, string> }
) {
  const directory = mkdtempSync(join(tmpdir(), 'flare-uploader-script-'))
  directories.push(directory)
  const bin = join(directory, 'bin')
  const log = join(directory, 'log')
  mkdirSync(bin)
  mkdirSync(log)
  for (const tool of systemTools) symlinkSync(located[tool], join(bin, tool))
  for (const tool of tools) {
    writeFileSync(join(bin, tool), `#!${located.bash}\n${stubs[tool]}\n`)
    chmodSync(join(bin, tool), 0o755)
  }
  writeFileSync(join(directory, 'script.sh'), script)
  const result = spawnSync(
    located.bash,
    [join(directory, 'script.sh'), ...args],
    { env: { NODE_ENV: 'test', PATH: bin, LOG: log, ...env }, encoding: 'utf8' }
  )
  const logged = (name: string) =>
    existsSync(join(log, name))
      ? readFileSync(join(log, name), 'utf8')
      : undefined
  return { ...result, logged, directory }
}

/** The file curl was asked to send, from its `-F file=@…` argument. */
const sentFile = (curlArgs = '') =>
  /^file=@([^;\n]+)/m.exec(curlArgs)?.[1] ?? ''

const screenshotScripts = [
  {
    name: 'Flameshot',
    tool: 'flameshot' as const,
    script: (useWayland: boolean) =>
      flameshotScript(target, {
        ...uploaderClients.flameshot.defaults,
        useWayland,
      }),
  },
  {
    name: 'Spectacle',
    tool: 'spectacle' as const,
    script: (useWayland: boolean) =>
      spectacleScript(target, {
        ...uploaderClients.spectacle.defaults,
        useWayland,
      }),
  },
]

describe.skipIf(!Object.values(located).every(Boolean))(
  'generated upload scripts',
  () => {
    describe.each(screenshotScripts)('$name screenshot script', (client) => {
      it('uploads the capture and copies the share-page link', () => {
        const result = run(client.script(false), {
          tools: [client.tool, 'curl', 'xsel', 'notify-send'],
          env: { CURL_RESPONSE: uploaded },
        })
        expect(result.status).toBe(0)
        expect(result.stdout).toContain(
          `Screenshot uploaded successfully: ${links.pageUrl}`
        )
        expect(result.logged('clipboard-xsel')).toBe(links.pageUrl)
        expect(result.logged('notify')).toBe(
          `Screenshot Uploaded|URL copied to clipboard: ${links.pageUrl}\n`
        )
        const curl = result.logged('curl')
        expect(curl).toContain('Authorization: Bearer account-upload-token')
        expect(curl).toContain(target.uploadUrl.toString())
        expect(curl).toMatch(/^file=@\/tmp\/.+\.png;type=image\/png$/m)
        expect(existsSync(sentFile(curl))).toBe(false)
      })

      it('reports a failed connection as a network error', () => {
        const result = run(client.script(false), {
          tools: [client.tool, 'curl', 'xsel', 'notify-send'],
          env: { CURL_EXIT: '7' },
        })
        expect(result.status).toBe(1)
        expect(result.stdout).toContain(
          'Upload failed: Network error or invalid URL'
        )
        expect(result.stdout).not.toContain('Could not extract URL')
        expect(result.logged('notify')).toBe(
          'Screenshot Upload Failed|Network error or invalid URL\n'
        )
        expect(existsSync(sentFile(result.logged('curl')))).toBe(false)
      })

      it("shows the server's reason when it refuses the upload", () => {
        const result = run(client.script(false), {
          tools: [client.tool, 'curl', 'xsel', 'notify-send'],
          env: {
            CURL_RESPONSE: JSON.stringify({
              success: false,
              error: 'The file exceeds the upload size limit.',
            }),
          },
        })
        expect(result.status).toBe(1)
        expect(result.stdout).toContain(
          'Upload failed: The file exceeds the upload size limit.'
        )
        expect(result.logged('clipboard-xsel')).toBeUndefined()
      })

      it('copies with wl-copy on Wayland and does not need xsel there', () => {
        const wayland = run(client.script(true), {
          tools: [client.tool, 'curl', 'wl-copy', 'notify-send'],
          env: { CURL_RESPONSE: uploaded },
        })
        expect(wayland.status).toBe(0)
        expect(wayland.logged('clipboard-wl-copy')).toBe(links.pageUrl)

        const x11 = run(client.script(false), {
          tools: [client.tool, 'curl', 'wl-copy', 'notify-send'],
          env: { CURL_RESPONSE: uploaded },
        })
        expect(x11.status).toBe(1)
        expect(x11.stdout).toContain(
          "Error: Required command 'xsel' not found."
        )
        expect(x11.logged('curl')).toBeUndefined()
      })
    })

    it('Spectacle screenshots pass the capture options to Spectacle', () => {
      const result = run(
        spectacleScript(target, {
          ...uploaderClients.spectacle.defaults,
          captureMode: 'activewindow',
          includePointer: true,
          delay: 500,
        }),
        {
          tools: ['spectacle', 'curl', 'xsel', 'notify-send'],
          env: { CURL_RESPONSE: uploaded },
        }
      )
      expect(result.status).toBe(0)
      expect(result.logged('spectacle')?.split('\n')).toEqual([
        '-a',
        '-b',
        '-n',
        '-o',
        expect.stringMatching(/^\/tmp\/spectacle-.+\.png$/),
        '-d',
        '500',
        '-p',
        '',
      ])
    })

    it('the Spectacle recording script uploads a recording file', () => {
      const directory = mkdtempSync(join(tmpdir(), 'flare-recording-'))
      directories.push(directory)
      const recording = join(directory, 'demo.webm')
      writeFileSync(recording, 'WEBM')
      const result = run(
        spectacleScript(target, {
          ...uploaderClients.spectacle.defaults,
          scriptType: 'recording',
        }),
        {
          tools: ['curl', 'xsel', 'notify-send', 'spectacle'],
          args: [recording],
          env: { CURL_RESPONSE: uploaded },
        }
      )
      expect(result.status).toBe(0)
      expect(result.logged('curl')).toContain(
        `file=@${recording};type=video/webm`
      )
      expect(result.stdout).toContain(
        `Recording uploaded successfully: ${links.pageUrl}`
      )
      expect(result.logged('clipboard-xsel')).toBe(links.pageUrl)
      expect(existsSync(recording)).toBe(true)

      const offline = run(
        spectacleScript(target, {
          ...uploaderClients.spectacle.defaults,
          scriptType: 'recording',
        }),
        {
          tools: ['curl', 'xsel', 'notify-send', 'spectacle'],
          args: [recording],
          env: { CURL_EXIT: '6' },
        }
      )
      expect(offline.status).toBe(1)
      expect(offline.logged('notify')).toBe(
        'Recording Upload Failed|Network error or invalid URL\n'
      )
    })

    it('the Bash script uploads a file with its detected type', () => {
      const directory = mkdtempSync(join(tmpdir(), 'flare-bash-upload-'))
      directories.push(directory)
      const notes = join(directory, 'notes.txt')
      writeFileSync(notes, 'plain text\n')

      const result = run(bashScript(target), {
        tools: ['curl', 'xsel'],
        args: [notes],
        env: { CURL_RESPONSE: uploaded },
      })
      expect(result.status).toBe(0)
      expect(result.stdout).toContain(`URL: ${links.pageUrl}`)
      expect(result.logged('curl')).toContain(`file=@${notes};type=text/plain`)
      expect(result.logged('clipboard-xsel')).toBe(links.pageUrl)

      const offline = run(bashScript(target), {
        tools: ['curl'],
        args: [notes],
        env: { CURL_EXIT: '7' },
      })
      expect(offline.status).toBe(1)
      expect(offline.stdout).toContain(
        'Upload failed: Network error or invalid URL'
      )
    })
  }
)
