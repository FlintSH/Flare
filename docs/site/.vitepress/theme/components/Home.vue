<script setup>
import { withBase } from 'vitepress'
const paths = [
  {
    number: '01',
    title: 'Make it yours',
    text: 'Go from a fresh server to your first upload. Choose storage, set up your domain, and settle in.',
    link: '/hosting/docker',
    action: 'Host your own Flare',
    icon: '↗',
  },
  {
    number: '02',
    title: 'Find your flow',
    text: 'Capture, organize, and share. Get more out of folders, tags, upload profiles, and your favorite tools.',
    link: '/guide/',
    action: 'Explore the user guide',
    icon: '⌘',
  },
  {
    number: '03',
    title: 'Connect the dots',
    text: 'Build a custom uploader, react to new files, and bring Flare into your everyday automations.',
    link: '/api/',
    action: 'Build an integration',
    icon: '{ }',
  },
]
</script>

<template>
  <div class="docs-home">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <span class="eyebrow"
          ><span class="status-dot" /> THE FLARE HANDBOOK</span
        >
        <h1 id="home-title">Your files.<br /><span>Your rules.</span></h1>
        <p class="hero-description">
          A little guidance. A lot of possibilities.<br />Everything you need to
          host, shape, and get the most out of Flare.
        </p>
        <div class="hero-actions">
          <a class="button-primary" :href="withBase('/hosting/docker.html')"
            >Start self-hosting <span aria-hidden="true">↗</span></a
          >
          <a class="button-secondary" :href="withBase('/guide/index.html')"
            >Learn the essentials <span aria-hidden="true">→</span></a
          >
        </div>
        <div class="hero-footnote">
          <span>Open source</span><i /> <span>On your infrastructure</span
          ><i /> <span>Made to be yours</span>
        </div>
      </div>
      <div class="hero-visual">
        <div class="visual-orbit" aria-hidden="true" />
        <a
          :href="withBase('/demos.html')"
          class="browser-frame"
          aria-label="Explore real Flare screenshots and walkthroughs"
        >
          <div class="browser-toolbar">
            <span class="window-dots" aria-hidden="true"><i /><i /><i /></span
            ><span>your corner of the internet</span
            ><span aria-hidden="true">↗</span>
          </div>
          <img
            :src="withBase('/screenshots/image-gallery/files-by-month.webp')"
            alt="Flare’s real file library, showing image previews, privacy indicators, search, and files grouped by month."
            width="1440"
            height="1120"
            fetchpriority="high"
          />
        </a>
        <div class="visual-caption">
          <span class="status-dot" /> REAL APP. YOUR POSSIBILITIES.
          <a :href="withBase('/demos.html')">Take a closer look →</a>
        </div>
      </div>
    </section>

    <section class="home-paths" aria-labelledby="paths-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">A GOOD PLACE TO START</span>
          <h2 id="paths-title">What brings you here?</h2>
        </div>
        <p>From first upload to your next integration.</p>
      </div>
      <div class="path-grid">
        <a
          v-for="path in paths"
          :key="path.number"
          :href="withBase(path.link.replace(/\/$/, '/index') + '.html')"
          class="path-card"
        >
          <div class="path-top">
            <span>{{ path.number }} /</span
            ><span class="path-icon" aria-hidden="true">{{ path.icon }}</span>
          </div>
          <h3>{{ path.title }}</h3>
          <p>{{ path.text }}</p>
          <span class="path-action"
            >{{ path.action }} <span aria-hidden="true">→</span></span
          >
        </a>
      </div>
    </section>

    <section class="home-lower" aria-labelledby="possibilities-title">
      <div>
        <span class="eyebrow">SMALL DETAILS. BIG POSSIBILITIES.</span>
        <h2 id="possibilities-title">
          A file host that fits<br />the way you work.
        </h2>
        <p>Keep it simple, or make it your own. There’s a guide for that.</p>
        <a :href="withBase('/features.html')" class="text-link"
          >Browse every feature →</a
        >
      </div>
      <div class="quick-links">
        <a :href="withBase('/guide/screenshot-tools.html')"
          ><span
            ><b>Capture. Upload. Copy.</b
            ><small>ShareX, iTake, Flameshot, Spectacle & Bash</small></span
          ><span>↗</span></a
        >
        <a :href="withBase('/admin/appearance.html')"
          ><span
            ><b>A familiar place, with your identity.</b
            ><small
              >Branding, palettes, share pages & appearance packs</small
            ></span
          ><span>↗</span></a
        >
        <a :href="withBase('/api/webhooks.html')"
          ><span
            ><b>When a file lands, make things happen.</b
            ><small
              >Signed events, delivery history & working examples</small
            ></span
          ><span>↗</span></a
        >
        <a :href="withBase('/hosting/maintenance.html')"
          ><span
            ><b>Keep your home in good shape.</b
            ><small
              >Backups, restores, upgrades & day-to-day operations</small
            ></span
          ><span>↗</span></a
        >
      </div>
    </section>
    <div class="home-help">
      <span>Looking for something specific?</span
      ><span
        >Use search <kbd>Ctrl / ⌘ K</kbd> or visit
        <a :href="withBase('/hosting/troubleshooting.html')"
          >troubleshooting →</a
        ></span
      >
    </div>
  </div>
</template>
