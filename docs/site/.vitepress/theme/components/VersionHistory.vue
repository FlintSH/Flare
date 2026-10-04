<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useData, withBase } from 'vitepress'
import { changedFiles, compareFile } from './version-diff.mjs'

const { theme } = useData()
const root = computed(() => theme.value.docsRoot || withBase('/'))
const releases = computed(() => theme.value.docsVersions?.releases || [])
const from = ref(releases.value[1]?.tag || releases.value[0]?.tag || '')
const to = ref(theme.value.docsVersions?.latest || '')
const changes = ref(null)
const compared = ref('')
const selected = ref('')
const busy = ref(false)
const error = ref('')
const query = ref('')
const cache = new Map()
const filtered = computed(() =>
  (changes.value || []).filter((file) =>
    `${file.path} ${file.after?.title || file.before?.title || ''}`
      .toLowerCase()
      .includes(query.value.toLowerCase())
  )
)
const active = computed(() =>
  changes.value?.find((file) => file.path === selected.value)
)
watch(filtered, (files) => {
  if (!files.some((file) => file.path === selected.value))
    selected.value = files[0]?.path || ''
})
const patch = computed(() =>
  active.value
    ? compareFile(active.value.before?.content, active.value.after?.content)
    : []
)
const href = (path) => (/^(https?:)?\/\//.test(path) ? path : root.value + path)

async function snapshot(tag) {
  if (!cache.has(tag)) {
    const response = await fetch(
      `${root.value}history/${encodeURIComponent(tag)}.json`
    )
    if (!response.ok)
      throw new Error(
        'The documentation snapshot could not be loaded. Try again, or reload this page after a deployment.'
      )
    const result = await response.json()
    if (result.tag !== tag || !result.files)
      throw new Error(
        'The documentation snapshot did not match the selected release. Reload this page and try again.'
      )
    cache.set(tag, result)
  }
  return cache.get(tag)
}

async function compare() {
  if (busy.value) return
  busy.value = true
  error.value = ''
  changes.value = null
  try {
    const [before, after] = await Promise.all([
      snapshot(from.value),
      snapshot(to.value),
    ])
    changes.value = changedFiles(before, after)
    selected.value = changes.value[0]?.path || ''
    compared.value = `${from.value} → ${to.value}`
    query.value = ''
    const url = new URL(window.location.href)
    url.searchParams.set('from', from.value)
    url.searchParams.set('to', to.value)
    window.history.replaceState(null, '', url)
  } catch {
    error.value =
      'The documentation snapshot could not be loaded. Check your connection and choose Show changes to retry, or reload this page after a deployment.'
  } finally {
    busy.value = false
  }
}

onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  if (
    releases.value.some((item) => item.tag === params.get('from')) &&
    releases.value.some((item) => item.tag === params.get('to'))
  ) {
    from.value = params.get('from')
    to.value = params.get('to')
    compare()
  }
})
</script>

<template>
  <div class="version-history">
    <div v-if="!releases.length" class="version-notice">
      <strong>Development preview</strong>
      <p>
        This build describes the working source. The published website has the
        dated release archive and comparisons. Run
        <code>npm run build:releases --prefix docs/site</code> to preview that
        site locally.
      </p>
    </div>
    <template v-else>
      <p v-if="theme.docsVersions.rolling" class="rolling-entry">
        Using a rolling build?
        <a :href="href(theme.docsVersions.rolling.path)" target="_self"
          >Open rolling docs (unreleased)</a
        >. The default handbook stays on the latest stable release.
      </p>
      <section aria-labelledby="compare-documentation">
        <h2 id="compare-documentation">Compare documentation</h2>
        <p>
          Choose two stable releases to see added, removed, and changed
          documentation. Comparisons show the original source text, including
          examples and interactive guide components.
        </p>
        <form class="compare-controls" @submit.prevent="compare">
          <label
            >From release
            <select v-model="from" aria-label="From release" :disabled="busy">
              <option
                v-for="release in releases"
                :key="release.tag"
                :value="release.tag"
              >
                {{ release.tag }} · {{ release.publishedAt.slice(0, 10) }}
              </option>
            </select>
          </label>
          <label
            >To release
            <select v-model="to" aria-label="To release" :disabled="busy">
              <option
                v-for="release in releases"
                :key="release.tag"
                :value="release.tag"
              >
                {{ release.tag }} · {{ release.publishedAt.slice(0, 10) }}
              </option>
            </select>
          </label>
          <button type="submit" :disabled="busy">
            {{ busy ? 'Loading…' : 'Show changes' }}
          </button>
        </form>
        <p v-if="error" role="alert">{{ error }}</p>
        <p v-if="changes" role="status" class="comparison-status">
          {{ compared }} · {{ changes.length }} changed
          {{ changes.length === 1 ? 'file' : 'files'
          }}<span v-if="!changes.length">. No documentation changes.</span>
        </p>
        <div v-if="changes?.length" class="comparison-results">
          <label class="file-filter"
            >Find a changed file<input
              v-model="query"
              type="search"
              placeholder="Try uploading, API, README…"
          /></label>
          <label class="file-filter"
            >Changed file
            <select v-model="selected" aria-label="Changed file" size="5">
              <option
                v-for="file in filtered"
                :key="file.path"
                :value="file.path"
              >
                {{ file.status }} · {{ file.path }}
              </option>
            </select>
          </label>
          <p v-if="!filtered.length">No files match your search.</p>
          <article
            v-if="active"
            class="file-diff"
            aria-label="Documentation changes"
          >
            <div class="diff-heading">
              <strong>{{ active.status }} · {{ active.path }}</strong>
              <div class="diff-links">
                <a
                  v-if="active.before?.url"
                  :href="href(active.before.url)"
                  target="_self"
                  >Read before</a
                >
                <a
                  v-if="active.after?.url"
                  :href="href(active.after.url)"
                  target="_self"
                  >Read after</a
                >
              </div>
            </div>
            <p class="diff-legend">
              <span>− Removed</span> <span>+ Added</span> · Unchanged sections
              can be expanded.
            </p>
            <template v-for="(part, index) in patch" :key="index">
              <pre
                v-if="part.added || part.removed"
                :class="part.added ? 'diff-added' : 'diff-removed'"
              ><code>{{ part.value.replace(/\n$/, '').split('\n').map(line => `${part.added ? '+' : '−'} ${line}`).join('\n') }}</code></pre>
              <details v-else class="diff-context">
                <summary>
                  {{ part.count || part.value.split('\n').length }} unchanged
                  lines
                </summary>
                <pre><code>{{ part.value }}</code></pre>
              </details>
            </template>
          </article>
        </div>
      </section>
      <section aria-labelledby="browse-releases">
        <h2 id="browse-releases">Browse releases</h2>
        <p>
          Dates are when each stable release was published, in UTC. Choose a
          version to read its documentation as it existed at that release.
        </p>
        <ul class="release-list">
          <li v-for="release in releases" :key="release.tag">
            <div>
              <a class="release-title" :href="href(release.path)" target="_self"
                >Flare {{ release.tag }}</a
              >
              <span
                v-if="release.tag === theme.docsVersions.latest"
                class="release-badge"
                >Latest stable</span
              >
              <p>
                {{
                  release.kind === 'legacy'
                    ? 'Original README & available guides'
                    : 'Full handbook'
                }}
              </p>
            </div>
            <div class="release-meta">
              <time :datetime="release.publishedAt">{{
                release.publishedAt.slice(0, 10)
              }}</time>
              <a
                :href="`https://github.com/FlintSH/Flare/releases/tag/${release.tag}`"
                >Release notes ↗</a
              >
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.version-history {
  margin: 24px 0;
}
.rolling-entry {
  padding: 12px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
}
.version-notice,
.file-diff {
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  padding: 20px;
}
.version-notice {
  background: var(--vp-c-bg-soft);
}
.compare-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 14px;
}
label {
  display: flex;
  flex: 1 1 170px;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
}
select,
input {
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  color: var(--vp-c-text-1);
  padding: 9px 10px;
  font: inherit;
  min-width: 0;
  max-width: 100%;
}
select {
  width: 100%;
}
button {
  border-radius: 6px;
  background: var(--vp-c-brand-3);
  color: white;
  font-weight: 600;
  padding: 8px 18px;
  min-height: 42px;
}
button:disabled {
  opacity: 0.65;
  cursor: wait;
}
.dark button {
  color: #111a2a;
}
select:focus-visible,
input:focus-visible,
button:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 3px;
}
.comparison-status {
  font-weight: 600;
}
.file-filter {
  margin: 14px 0;
}
.diff-heading {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.diff-links {
  display: flex;
  gap: 16px;
}
.diff-legend {
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.file-diff pre {
  margin: 0;
  padding: 10px;
  overflow-x: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
  line-height: 1.7;
  border-radius: 4px;
}
.file-diff code {
  color: inherit;
  padding: 0;
  background: transparent;
}
.diff-added {
  background: #e1f5e7;
  color: #15472c;
}
.diff-removed {
  background: #ffeaec;
  color: #762b34;
}
.dark .diff-added {
  background: #123725;
  color: #bbefd1;
}
.dark .diff-removed {
  background: #401d26;
  color: #ffc4cb;
}
.diff-context {
  margin: 8px 0;
  font-size: 12px;
  color: var(--vp-c-text-2);
}
.diff-context summary {
  cursor: pointer;
  padding: 8px;
}
.release-list {
  list-style: none;
  padding: 0;
}
.release-list li {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  justify-content: space-between;
  padding: 18px 0;
  border-bottom: 1px solid var(--vp-c-divider);
  margin: 0;
}
.release-title {
  font-size: 18px;
  font-weight: 650;
}
.release-list p {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
.release-badge {
  display: inline-block;
  margin-left: 10px;
  padding: 0 7px;
  border-radius: 5px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 11px;
  font-weight: 600;
}
.release-meta {
  display: flex;
  flex-direction: column;
  align-items: end;
  font-size: 13px;
  color: var(--vp-c-text-2);
}
@media (max-width: 480px) {
  .file-diff {
    padding: 12px;
  }
  .compare-controls button {
    width: 100%;
  }
  .release-meta {
    align-items: start;
  }
}
</style>
