<script setup>
import DefaultTheme from 'vitepress/theme'
import { useData } from 'vitepress'
import BuildStamp from './components/BuildStamp.vue'
import ProjectCredit from './components/ProjectCredit.vue'
const { Layout } = DefaultTheme
const { frontmatter } = useData()
</script>

<template>
  <Layout>
    <template #page-top
      ><div v-if="!frontmatter.productHome" class="home-build-stamp">
        <BuildStamp /></div
    ></template>
    <template #page-bottom
      ><div
        v-if="frontmatter.productHome"
        class="home-build-stamp product-build-stamp"
      >
        <BuildStamp /></div
    ></template>
    <template #doc-before><BuildStamp /></template>
    <template #layout-bottom><ProjectCredit /></template>
  </Layout>
</template>
