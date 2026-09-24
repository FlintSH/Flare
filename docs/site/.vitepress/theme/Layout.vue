<script setup>
import DefaultTheme from 'vitepress/theme'
import BuildStamp from './components/BuildStamp.vue'
import ProjectCredit from './components/ProjectCredit.vue'
const { Layout } = DefaultTheme
</script>

<template>
  <Layout>
    <template #page-top
      ><div class="home-build-stamp"><BuildStamp /></div
    ></template>
    <template #doc-before><BuildStamp /></template>
    <template #layout-bottom><ProjectCredit /></template>
  </Layout>
</template>
