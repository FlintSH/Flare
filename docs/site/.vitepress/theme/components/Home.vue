<script setup>
import { withBase } from 'vitepress'
import DocIcon from './DocIcon.vue'
import FeatureShowcase from './FeatureShowcase.vue'

const features = [
  {
    title: 'Capture tools',
    text: 'Upload directly from ShareX, iTake, Flameshot, Spectacle, or Bash.',
    link: '/guide/screenshot-tools.html',
    icon: 'terminal',
  },
  {
    title: 'Tags & folders',
    text: 'Group files into folders and keep them easy to find with tags.',
    link: '/guide/folders.html',
    icon: 'files',
  },
  {
    title: 'OCR search',
    text: 'Find screenshots by the text inside them, not just their filenames.',
    link: '/guide/library.html#read-text-in-images-with-ocr',
    icon: 'search',
  },
  {
    title: 'Local or S3',
    text: 'Keep files on local disk or an S3-compatible bucket.',
    link: '/hosting/storage.html',
    icon: 'server',
  },
  {
    title: 'Roles & permissions',
    text: 'Give each person the access they need with custom roles.',
    link: '/admin/roles.html',
    icon: 'shield',
  },
  {
    title: 'API & webhooks',
    text: 'Connect your software with scoped API tokens and signed webhook events.',
    link: '/api/index.html',
    icon: 'code',
  },
]
</script>

<template>
  <div class="product-home">
    <section class="product-hero" aria-labelledby="product-title">
      <div class="product-hero-copy">
        <h1 id="product-title">Your own file host.</h1>
        <p class="product-intro">
          Screenshots, files, pastes, and short links. On your server, under
          your domain.
        </p>
        <div class="product-actions">
          <a class="button-primary" :href="withBase('/hosting/index.html')">
            <DocIcon name="server" />Get Flare<DocIcon name="arrow" />
          </a>
          <a class="button-secondary" :href="withBase('/guide/index.html')">
            <DocIcon name="book" />Read the docs
          </a>
        </div>
      </div>
      <FeatureShowcase />
    </section>

    <section class="product-features" aria-label="Flare features">
      <a
        v-for="feature in features"
        :key="feature.title"
        class="product-feature"
        :href="withBase(feature.link)"
      >
        <div class="product-feature-title">
          <DocIcon :name="feature.icon" />
          <h2>{{ feature.title }}</h2>
          <DocIcon name="arrow" />
        </div>
        <p>{{ feature.text }}</p>
      </a>
    </section>

    <div class="product-project-links">
      <a href="https://github.com/FlintSH/Flare"
        >View on GitHub<DocIcon name="external"
      /></a>
      <span aria-hidden="true">·</span>
      <a href="https://github.com/FlintSH/Flare/blob/main/LICENSE"
        >Free and open source · MIT</a
      >
    </div>
  </div>
</template>

<style src="../landing.css"></style>
