<script setup>
import { computed, ref } from 'vue'
const origin = ref('https://files.example.com')
const operation = ref('upload')
const language = ref('curl')
const copied = ref('')
function selectLanguage(value) {
  language.value = value
  copied.value = ''
}
const operations = {
  upload: {
    label: 'Upload a file',
    method: 'POST',
    path: '/api/files',
    scope: 'files:upload',
    permission: 'files.upload',
  },
  files: {
    label: 'List your files',
    method: 'GET',
    path: '/api/files',
    scope: 'files:read',
    permission: 'files.read',
  },
  urls: {
    label: 'List short links',
    method: 'GET',
    path: '/api/urls',
    scope: 'urls:read',
    permission: 'links.read',
  },
  createUrl: {
    label: 'Create a short link',
    method: 'POST',
    path: '/api/urls',
    scope: 'urls:write',
    permission: 'links.create',
  },
}
const selected = computed(() => operations[operation.value])
const base = computed(() => {
  try {
    const url = new URL(origin.value)
    return ['https:', 'http:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url.origin
      : null
  } catch {
    return null
  }
})
const quote = (value) => "'" + value.replaceAll("'", "'\"'\"'") + "'"
const code = computed(() => {
  if (!base.value)
    return 'Enter an HTTP(S) origin, such as https://files.example.com'
  const url = base.value + selected.value.path
  const upload = operation.value === 'upload'
  const create = operation.value === 'createUrl'
  if (language.value === 'curl')
    return `curl --fail-with-body ${quote(url)} \\\n  -H "Authorization: Bearer $FLARE_TOKEN"${upload ? ' \\\n  -F "file=@./screenshot.png"' : create ? ' \\\n  -H "Content-Type: application/json" \\\n  --data \'{"url":"https://example.com"}\'' : ''}`
  if (language.value === 'JavaScript')
    return `// Node.js 22+. Set FLARE_TOKEN in your environment.\n${upload ? "import { readFile } from 'node:fs/promises'\nconst body = new FormData()\nbody.set('file', new Blob([await readFile('./screenshot.png')], { type: 'image/png' }), 'screenshot.png')\n" : ''}const response = await fetch(${JSON.stringify(url)}, {\n  method: '${selected.value.method}',\n  headers: {\n    Authorization: \`Bearer \${process.env.FLARE_TOKEN}\`,${create ? "\n    'Content-Type': 'application/json'," : ''}\n  },${upload ? '\n  body,' : create ? "\n  body: JSON.stringify({ url: 'https://example.com' })," : ''}\n})\nconst result = await response.json()\nif (!response.ok) throw new Error(JSON.stringify(result))\nconsole.log(result)`
  return `# Install requests: python -m pip install requests\nimport os\nimport requests\n\nheaders = {"Authorization": "Bearer " + os.environ["FLARE_TOKEN"]}\n${upload ? `with open("screenshot.png", "rb") as file:\n    response = requests.post(${JSON.stringify(url)}, headers=headers,\n        files={"file": ("screenshot.png", file, "image/png")}, timeout=120)` : `response = requests.${create ? 'post' : 'get'}(${JSON.stringify(url)},\n    headers=headers, ${create ? 'json={"url": "https://example.com"}, ' : ''}timeout=30)`}\nresponse.raise_for_status()\nprint(response.json())`
})
async function copy() {
  try {
    await navigator.clipboard.writeText(code.value)
    copied.value = 'Copied'
  } catch {
    copied.value = 'Select the code and copy it manually.'
  }
}
</script>

<template>
  <section class="interactive-panel" aria-label="API request builder">
    <div class="panel-heading">
      <span class="eyebrow">BUILD YOUR FIRST REQUEST</span
      ><span class="demo-badge">No requests sent</span>
    </div>
    <p>
      Choose an operation and copy a working starting point. Set
      <code>FLARE_TOKEN</code> in your terminal to a named token with the
      required scope. The token owner must also have the current role
      permission.
    </p>
    <div class="lab-grid two">
      <div>
        <label for="api-instance-url">Instance URL</label
        ><input
          id="api-instance-url"
          v-model="origin"
          type="url"
          placeholder="https://files.example.com"
          :aria-invalid="!base"
        />
      </div>
      <div>
        <label for="api-operation">Operation</label
        ><select id="api-operation" v-model="operation">
          <option v-for="(item, key) in operations" :key="key" :value="key">
            {{ item.label }}
          </option>
        </select>
      </div>
    </div>
    <p v-if="!base" role="alert">
      Use your instance’s origin with no credentials, path, query, or fragment.
    </p>
    <div class="request-meta">
      <code>{{ selected.method }} {{ selected.path }}</code
      ><span
        >Scope: <code>{{ selected.scope }}</code></span
      ><span
        >Account permission: <code>{{ selected.permission }}</code></span
      >
    </div>
    <div class="code-toolbar">
      <div class="filter-pills">
        <button
          v-for="item in ['curl', 'JavaScript', 'Python']"
          :key="item"
          :aria-pressed="language === item"
          @click="selectLanguage(item)"
        >
          {{ item }}
        </button>
      </div>
      <button class="copy-button" :disabled="!base" @click="copy">
        Copy code
      </button>
    </div>
    <pre
      class="demo-code"
      tabindex="0"
      aria-label="Generated API request"
    ><code>{{ code }}</code></pre>
    <span class="copy-status" role="status">{{ copied }}</span>
    <p class="lab-note">
      Credentials never enter this demo. Run these requests yourself against
      your instance; uploads and short-link creation change your data.
    </p>
  </section>
</template>
