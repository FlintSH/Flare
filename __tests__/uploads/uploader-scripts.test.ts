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
  type ScriptTarget,
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
  // Records its arguments and prints the link, as the program does.
  'flare-upload': `printf '%s\\n' "$@" > "$LOG/flare-upload"
[ -n "$HELPER_EXIT" ] && { echo "flare-upload: refused" >&2; exit "$HELPER_EXIT"; }
printf '%s\\n' "$HELPER_LINK"`,
  flameshot: `printf 'PNG'`,
  spectacle: `printf '%s\\n' "$@" > "$LOG/spectacle"
while [ $# -gt 0 ]; do
  [ "$1" = "-o" ] && printf 'PNG' > "$2"
  shift
done`,
}
type Stub = keyof typeof stubs

const target: ScriptTarget = {
  transport: 'request',
  uploadUrl: 'https://flare.test/api/files?profileId=screens',
  token: 'flr_configuration-token',
}
/** An encrypted profile: the script starts `flare-upload`. */
const helperTarget: ScriptTarget = {
  transport: 'helper',
  origin: 'https://flare.test',
  configFile: 'screens.json',
}
const encryptedLink =
  'https://flare.test/alex/e_AAAAAAAAAAAAAAAAAAAAAA#S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2V5S2U'
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
        expect(curl).toContain('Authorization: Bearer flr_configuration-token')
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

    describe('for an encrypted profile', () => {
      /** A home with the configuration where the script looks for it. */
      function home() {
        const directory = mkdtempSync(join(tmpdir(), 'flare-helper-home-'))
        directories.push(directory)
        const config = join(directory, '.config', 'flare-upload')
        mkdirSync(config, { recursive: true })
        writeFileSync(join(config, 'screens.json'), '{}')
        return { directory, config: join(config, 'screens.json') }
      }

      it('the Flameshot script starts flare-upload and holds no token and no curl', () => {
        const script = flameshotScript(helperTarget, {
          ...uploaderClients.flameshot.defaults,
        })
        expect(script).not.toContain('curl')
        expect(script).not.toContain('UPLOAD_TOKEN')
        expect(script).not.toContain('Authorization')
        expect(script).toContain('"flameshot" "flare-upload" "xsel"')

        const { directory, config } = home()
        const result = run(script, {
          tools: ['flameshot', 'flare-upload', 'xsel', 'notify-send'],
          env: { HOME: directory, HELPER_LINK: encryptedLink },
        })
        expect(result.status).toBe(0)
        const [flag, path, file] = result.logged('flare-upload')!.split('\n')
        expect([flag, path]).toEqual(['--config', config])
        expect(file).toMatch(/^\/tmp\/flameshot-.+\.png$/)
        // The capture is removed after the upload.
        expect(existsSync(file)).toBe(false)
        // The whole link, with the key after `#`, is what gets copied.
        expect(result.logged('clipboard-xsel')).toBe(encryptedLink)
        // A notification can stay in a history, so it does not show the key.
        expect(result.logged('notify')).toBe(
          'Screenshot Uploaded|Link copied to clipboard\n'
        )
      })

      it('reports the exit code of flare-upload and copies nothing', () => {
        const { directory } = home()
        const result = run(
          spectacleScript(helperTarget, {
            ...uploaderClients.spectacle.defaults,
            useWayland: true,
          }),
          {
            tools: ['spectacle', 'flare-upload', 'wl-copy', 'notify-send'],
            env: { HOME: directory, HELPER_EXIT: '3' },
          }
        )
        expect(result.status).toBe(1)
        expect(result.stdout).toContain(
          'Upload failed: flare-upload exited with code 3'
        )
        expect(result.stderr).toContain('flare-upload: refused')
        expect(result.logged('clipboard-wl-copy')).toBeUndefined()
        expect(result.logged('notify')).toContain(
          'Screenshot Upload Failed|flare-upload exited with code 3.'
        )
      })

      it('asks for the configuration file when it is missing', () => {
        const directory = mkdtempSync(join(tmpdir(), 'flare-helper-empty-'))
        directories.push(directory)
        const result = run(bashScript(helperTarget), {
          tools: ['flare-upload'],
          args: [join(directory, 'missing.txt')],
          env: { HOME: directory },
        })
        expect(result.status).toBe(1)
        expect(result.logged('flare-upload')).toBeUndefined()
      })

      it('the Bash script passes the file to flare-upload and honors FLARE_UPLOAD_CONFIG', () => {
        const { directory, config } = home()
        const notes = join(directory, 'notes.txt')
        writeFileSync(notes, 'plain text\n')
        const other = join(directory, 'other.json')
        writeFileSync(other, '{}')
        const script = bashScript(helperTarget)
        expect(script).toContain('dependencies=("flare-upload")')

        const result = run(script, {
          tools: ['flare-upload', 'xsel'],
          args: [notes],
          env: { HOME: directory, HELPER_LINK: encryptedLink },
        })
        expect(result.status).toBe(0)
        expect(result.logged('flare-upload')).toBe(
          `--config\n${config}\n${notes}\n`
        )
        expect(result.stdout).toContain(`URL: ${encryptedLink}`)
        expect(result.logged('clipboard-xsel')).toBe(encryptedLink)

        const chosen = run(script, {
          tools: ['flare-upload', 'xsel'],
          args: [notes],
          env: {
            HOME: directory,
            HELPER_LINK: encryptedLink,
            FLARE_UPLOAD_CONFIG: other,
          },
        })
        expect(chosen.logged('flare-upload')).toBe(
          `--config\n${other}\n${notes}\n`
        )
      })
    })
  }
)
