<script setup>
import { withBase } from 'vitepress'
import DocIcon from './DocIcon.vue'

const features = [
  {
    title: 'Screenshot tools',
    text: 'Connect ShareX, iTake, Flameshot, Spectacle, or Bash to your own instance.',
    link: '/guide/screenshot-tools.html',
    icon: 'terminal',
  },
  {
    title: 'Rich previews',
    text: 'Let recipients preview images, video, audio, PDFs, and code before downloading.',
    link: '/guide/sharing.html',
    icon: 'files',
  },
  {
    title: 'Stay organized',
    text: 'Find uploads with folders, tags, and search that includes text from images.',
    link: '/guide/library.html',
    icon: 'search',
  },
  {
    title: 'Sharing controls',
    text: 'Choose public or private access, add a password, or set an expiry.',
    link: '/guide/sharing.html',
    icon: 'shield',
  },
  {
    title: 'Make it yours',
    text: 'Customize your branding, themes, and share pages to suit your instance.',
    link: '/admin/appearance.html',
    icon: 'settings',
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
      <picture class="product-picture">
        <source
          media="(max-width: 600px)"
          :srcset="withBase('/landing/library-mobile.webp')"
          width="390"
          height="900"
        />
        <img
          :src="withBase('/landing/library-desktop.webp')"
          alt="Flare’s real file library with demonstration images, folders, search, and sharing controls."
          width="1440"
          height="1000"
          fetchpriority="high"
        />
      </picture>
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
