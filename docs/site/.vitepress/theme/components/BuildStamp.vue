<script setup>
import { useData, withBase } from 'vitepress'
const { theme } = useData()
</script>

<template>
  <div
    class="build-stamp"
    aria-label="Documentation version and source revision"
  >
    <span
      >Docs for <b>Flare v{{ theme.buildInfo.version }}</b></span
    >
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
    <a
      class="build-details"
      :href="withBase('/build-info.json')"
      :title="`Built ${theme.buildInfo.builtAt}`"
      >Build details ↗</a
    >
  </div>
</template>
