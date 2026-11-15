<script setup>
import { withBase } from 'vitepress'
import DocIcon from './DocIcon.vue'
import ProductDemo from './ProductDemo.vue'

// Capture tools Flare has a ready-made setup for, each shown by its own mark.
const tools = [
  {
    name: 'ShareX',
    on: 'Windows',
    icon: 'sharex.png',
    link: '#sharex-on-windows',
  },
  { name: 'iTake', on: 'macOS', icon: 'itake.png', link: '#itake-on-macos' },
  {
    name: 'Flameshot',
    on: 'Linux',
    icon: 'flameshot.svg',
    link: '#flameshot-on-linux',
  },
  {
    name: 'Spectacle',
    on: 'KDE',
    icon: 'spectacle.svg',
    link: '#spectacle-on-kde',
  },
].map((tool) => ({
  ...tool,
  icon: `/landing/tools/${tool.icon}`,
  link: `/guide/screenshot-tools.html${tool.link}`,
}))

const features = [
  {
    icon: 'image',
    title: 'Links that preview',
    text: 'Images and video show up in Discord and Slack. PDFs and code open in the browser.',
    link: '/guide/embeds.html',
  },
  {
    icon: 'link',
    title: 'Pastes and short links',
    text: 'Share code with syntax highlighting, and shorten URLs under your own domain.',
    link: '/guide/pastes.html',
  },
  {
    icon: 'search',
    title: 'Folders, tags and search',
    text: 'Group files in folders, label them with tags, and search the text inside your screenshots.',
    link: '/guide/library.html',
  },
  {
    icon: 'lock',
    title: 'Private and expiring links',
    text: 'Public, private or behind a password, with an expiry date when you want one.',
    link: '/guide/sharing.html',
  },
]

const installs = [
  {
    title: 'Docker Compose',
    text: 'For your own server, NAS or VPS.',
    link: '/hosting/docker.html',
  },
  {
    title: 'Railway',
    text: 'A managed host, deployed from a template.',
    link: '/hosting/railway.html',
  },
]
</script>

<template>
  <div class="product-home">
    <section class="product-hero" aria-labelledby="product-title">
      <h1 id="product-title">Your own file host.</h1>
      <p class="product-intro">
        Screenshots, files, pastes and short links on your server and domain.
      </p>
      <div class="product-actions">
        <a class="button-primary" :href="withBase('/hosting/index.html')">
          Get Flare<DocIcon name="arrow" />
        </a>
        <a class="product-docs" :href="withBase('/guide/index.html')">
          Read the docs
        </a>
      </div>
    </section>

    <!-- What uploads to Flare sits on top of Flare itself. -->
    <ProductDemo>
      <div class="product-sources">
        <div class="product-sources-tools">
          <p id="product-sources-label">Uploads straight from</p>
          <ul aria-labelledby="product-sources-label">
            <li v-for="tool in tools" :key="tool.name">
              <a :href="withBase(tool.link)">
                <img
                  :src="withBase(tool.icon)"
                  alt=""
                  width="28"
                  height="28"
                  decoding="async"
                />
                <span>
                  <b>{{ tool.name }}</b>
                  <small>{{ tool.on }}</small>
                </span>
              </a>
            </li>
          </ul>
        </div>
        <a
          class="product-sources-ember"
          href="https://github.com/FlintSH/Ember"
        >
          <img
            :src="withBase('/landing/tools/ember.svg')"
            alt=""
            width="28"
            height="28"
            decoding="async"
          />
          <span>
            <b>Ember for Android<DocIcon name="external" /></b>
            <small>Shares from any app and syncs your screenshots.</small>
          </span>
        </a>
      </div>
    </ProductDemo>

    <section class="product-section" aria-labelledby="product-features-title">
      <header>
        <h2 id="product-features-title">Features</h2>
        <a :href="withBase('/features.html')"
          >All features<DocIcon name="arrow"
        /></a>
      </header>
      <div class="product-features">
        <a
          v-for="feature in features"
          :key="feature.title"
          class="product-feature"
          :href="withBase(feature.link)"
        >
          <h3><DocIcon :name="feature.icon" />{{ feature.title }}</h3>
          <p>{{ feature.text }}</p>
        </a>
      </div>
    </section>

    <section class="product-section" aria-labelledby="product-install-title">
      <header>
        <div>
          <h2 id="product-install-title">Install</h2>
          <p>
            Flare is free and open source, and runs anywhere Docker does.
            <a href="https://github.com/FlintSH/Flare"
              >Source on GitHub<DocIcon name="external"
            /></a>
          </p>
        </div>
      </header>
      <div class="product-installs">
        <a
          v-for="install in installs"
          :key="install.title"
          class="product-install"
          :href="withBase(install.link)"
        >
          <span>
            <b>{{ install.title }}</b>
            <small>{{ install.text }}</small>
          </span>
          <DocIcon name="arrow" />
        </a>
      </div>
      <p class="product-credits">
        The ShareX, iTake, Flameshot and Spectacle logos belong to their
        projects.
        <a :href="withBase('/landing/tools/CREDITS.txt')"
          >Credits and licenses</a
        >
      </p>
    </section>
  </div>
</template>

<style src="../landing.css"></style>
