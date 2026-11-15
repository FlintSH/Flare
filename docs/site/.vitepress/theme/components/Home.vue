<script setup>
import { withBase } from 'vitepress'
import DocIcon from './DocIcon.vue'
import ProductDemo from './ProductDemo.vue'

const features = [
  {
    title: 'Screenshot tool uploads',
    text: 'ShareX, iTake, Flameshot, Spectacle or a Bash script, each set up from one download.',
    link: '/guide/screenshot-tools.html',
  },
  {
    title: 'Links that preview',
    text: 'Images and video show up on their own in Discord and Slack. PDFs, audio and code open in the browser.',
    link: '/guide/embeds.html',
  },
  {
    title: 'Folders, tags and search',
    text: 'Search reads the text inside your screenshots, so you can find one by what it says.',
    link: '/guide/library.html',
  },
  {
    title: 'Private and expiring links',
    text: 'Public, private or behind a password, with an expiry date when you want one.',
    link: '/guide/sharing.html',
  },
]
</script>

<template>
  <div class="product-home">
    <section class="product-hero" aria-labelledby="product-title">
      <h1 id="product-title">Your own file host.</h1>
      <p class="product-intro">
        Screenshots, files, pastes and short links, on your server and your
        domain.
      </p>
      <div class="product-actions">
        <a class="button-primary" :href="withBase('/hosting/index.html')">
          Get Flare<DocIcon name="arrow" />
        </a>
        <a class="button-secondary" :href="withBase('/guide/index.html')">
          Read the docs
        </a>
      </div>
    </section>

    <ProductDemo />

    <section class="product-features" aria-label="What Flare does">
      <a
        v-for="feature in features"
        :key="feature.title"
        class="product-feature"
        :href="withBase(feature.link)"
      >
        <h2>{{ feature.title }}<DocIcon name="arrow" /></h2>
        <p>{{ feature.text }}</p>
      </a>
    </section>

    <section class="product-run" aria-labelledby="product-run-title">
      <h2 id="product-run-title">Install</h2>
      <p>
        Flare is free and open source. It runs anywhere Docker does, and all it
        needs is PostgreSQL.
      </p>
      <ul>
        <li><a :href="withBase('/hosting/docker.html')">Docker Compose</a></li>
        <li><a :href="withBase('/hosting/railway.html')">Railway</a></li>
        <li>
          <a href="https://github.com/FlintSH/Flare"
            >GitHub<DocIcon name="external"
          /></a>
        </li>
      </ul>
    </section>
  </div>
</template>

<style src="../landing.css"></style>
