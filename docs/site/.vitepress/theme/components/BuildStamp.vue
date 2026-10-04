<script setup>
import { computed, ref, useId } from 'vue'
import { useData, withBase } from 'vitepress'
const { theme, page } = useData()
const selected = ref('')
const selectorId = useId()
const releases = computed(() => theme.value.docsVersions?.releases || [])
const root = computed(() => theme.value.docsRoot || withBase('/'))
const current = computed(() => theme.value.buildInfo.release)
const rolling = computed(() => theme.value.buildInfo.channel === 'rolling')
const destination = computed(() => {
  const release = releases.value.find((item) => item.tag === selected.value)
  if (!release) return null
  const path = page.value.relativePath.replace(/\.md$/, '.html')
  const exists = release.pages.some((item) => item.path === path)
  return `${root.value}${release.path}${exists ? path : ''}`
})
</script>

<template>
  <div
    class="build-stamp"
    aria-label="Documentation version and source revision"
  >
    <span
      >Docs for
      <b
        >Flare
        {{
          rolling
            ? `rolling (v${theme.buildInfo.version})`
            : current?.tag || `v${theme.buildInfo.version}`
        }}</b
      ></span
    >
    <span v-if="rolling" class="release-channel">
      Updated
      <time :datetime="theme.buildInfo.rolling.updatedAt">{{
        theme.buildInfo.rolling.updatedAt.slice(0, 10)
      }}</time>
    </span>
    <span v-else-if="current" class="release-channel">
      {{ current.latest ? 'Latest stable' : 'Archived release' }}
      ·
      <time :datetime="current.publishedAt">{{
        current.publishedAt.slice(0, 10)
      }}</time>
    </span>
    <span v-else class="build-dirty">Development preview</span>
    <span v-if="current && current.tag !== `v${theme.buildInfo.version}`">
      Source package v{{ theme.buildInfo.version }}
    </span>
    <span aria-hidden="true">·</span>
    <a
      v-if="theme.buildInfo.commit"
      :href="`https://github.com/FlintSH/Flare/commit/${theme.buildInfo.commit}`"
      :title="theme.buildInfo.commit"
      >{{ theme.buildInfo.shortCommit }}</a
    >
    <span v-else>Source commit unavailable</span>
    <span v-if="theme.buildInfo.dirty" class="build-dirty"
      >Uncommitted changes</span
    >
    <span v-else-if="theme.buildInfo.dirty === null" class="build-dirty"
      >Source archive</span
    >
    <span v-if="theme.buildInfo.renderer?.dirty" class="build-dirty"
      >Uncommitted site tooling</span
    >
    <a
      class="build-details"
      :href="withBase('/build-info.json')"
      :title="`Built ${theme.buildInfo.builtAt}`"
      >Build details ↗</a
    >
    <a :href="`${root}versions.html`" target="_self">Versions &amp; changes</a>
    <div
      v-if="rolling"
      class="rolling-notice"
      role="note"
      aria-label="Rolling documentation"
    >
      <strong>Rolling preview · Unreleased</strong>
      <p>These docs describe a rolling build, not a stable release.</p>
      <a :href="root" target="_self">Read stable docs</a>
    </div>
    <div v-if="releases.length" class="release-picker">
      <label :for="selectorId">Documentation release</label>
      <select :id="selectorId" v-model="selected">
        <option value="" disabled>Choose a release</option>
        <option
          v-for="release in releases"
          :key="release.tag"
          :value="release.tag"
        >
          {{ release.tag }} · {{ release.publishedAt.slice(0, 10) }}
        </option>
      </select>
      <a v-if="destination" :href="destination" target="_self">View docs</a>
      <span v-else>View docs</span>
    </div>
  </div>
</template>

<style scoped>
.release-channel {
  color: var(--vp-c-text-2);
}
.rolling-notice {
  width: 100%;
  margin-top: 8px;
  padding: 12px 16px;
  border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-text-1);
  font-size: 14px;
  line-height: 1.6;
}
.rolling-notice p {
  margin: 4px 0;
}
.release-picker {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-top: 4px;
}
.release-picker select {
  max-width: 100%;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 5px;
  padding: 3px 8px;
  font: inherit;
  color: var(--vp-c-text-1);
}
.release-picker select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}
</style>
