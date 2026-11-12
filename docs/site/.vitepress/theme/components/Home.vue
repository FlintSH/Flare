<script setup>
import { withBase } from 'vitepress'
import DocIcon from './DocIcon.vue'

const paths = [
  {
    title: 'Use Flare',
    text: 'Upload, organize, and share. Find your way around files, folders, tags, and screenshot tools.',
    link: '/guide/index.html',
    action: 'Read the user guide',
    icon: 'files',
  },
  {
    title: 'Self-host Flare',
    text: 'Bring your own server. Set up Docker or Railway, choose storage, and connect your domain.',
    link: '/hosting/index.html',
    action: 'Set up your server',
    icon: 'server',
  },
  {
    title: 'Administer an instance',
    text: 'Manage accounts and permissions, configure email and sign-in, and make the instance your own.',
    link: '/admin/index.html',
    action: 'Open the admin guide',
    icon: 'settings',
  },
  {
    title: 'Build integrations',
    text: 'Connect your tools with scoped API tokens, automated uploads, signed webhooks, and working examples.',
    link: '/api/index.html',
    action: 'Explore the API',
    icon: 'code',
  },
]

const references = [
  {
    title: 'Server configuration',
    text: 'Environment variables, defaults, and precedence',
    link: '/hosting/configuration.html',
    icon: 'server',
  },
  {
    title: 'API authentication',
    text: 'Tokens, scopes, and supported operations',
    link: '/api/authentication.html',
    icon: 'shield',
  },
  {
    title: 'Webhooks',
    text: 'Events, signatures, retries, and delivery',
    link: '/api/webhooks.html',
    icon: 'code',
  },
  {
    title: 'Troubleshooting',
    text: 'Help with setup and upload problems',
    link: '/hosting/troubleshooting.html',
    icon: 'terminal',
  },
]
</script>

<template>
  <div class="docs-home">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <span class="eyebrow">THE FLARE HANDBOOK</span>
        <h1 id="home-title">Flare documentation</h1>
        <p class="hero-description">
          Your files. Your server. Your rules. Learn to share, customize,
          automate, and run your own Flare instance.
        </p>
        <div class="hero-actions">
          <a class="button-primary" :href="withBase('/hosting/index.html')">
            <DocIcon name="server" />Set up Flare<DocIcon name="arrow" />
          </a>
          <a class="button-secondary" :href="withBase('/guide/index.html')">
            <DocIcon name="book" />Read the user guide
          </a>
        </div>
        <p class="hero-footnote">
          New here?
          <a :href="withBase('/features.html')"
            >See what Flare can do<DocIcon name="arrow"
          /></a>
        </p>
      </div>
      <nav class="home-reference" aria-labelledby="reference-title">
        <div class="panel-title">
          <span class="icon-tile"><DocIcon name="search" /></span>
          <div>
            <span class="eyebrow">QUICK REFERENCE</span>
            <h2 id="reference-title">Find an answer</h2>
          </div>
        </div>
        <div class="quick-links">
          <a
            v-for="reference in references"
            :key="reference.link"
            :href="withBase(reference.link)"
          >
            <DocIcon :name="reference.icon" />
            <span
              ><b>{{ reference.title }}</b
              ><small>{{ reference.text }}</small></span
            >
            <DocIcon name="arrow" />
          </a>
        </div>
      </nav>
    </section>

    <section class="home-paths" aria-labelledby="paths-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">GUIDES BY TASK</span>
          <h2 id="paths-title">What would you like to do?</h2>
        </div>
        <p>Start with what you want to do.</p>
      </div>
      <div class="path-grid">
        <a
          v-for="path in paths"
          :key="path.link"
          :href="withBase(path.link)"
          class="path-card"
        >
          <span class="icon-tile"><DocIcon :name="path.icon" /></span>
          <h3>{{ path.title }}</h3>
          <p>{{ path.text }}</p>
          <span class="path-action"
            >{{ path.action }}<DocIcon name="arrow"
          /></span>
        </a>
      </div>
    </section>

    <section class="home-lower" aria-labelledby="walkthroughs-title">
      <div class="walkthrough-copy">
        <span class="eyebrow">WALKTHROUGHS & EXAMPLES</span>
        <h2 id="walkthroughs-title">See it in Flare.</h2>
        <p>
          Follow the real interface, watch a workflow, or try upload settings
          and API requests in the browser.
        </p>
        <a :href="withBase('/demos.html')" class="text-link"
          >Open the interactive walkthroughs<DocIcon name="arrow"
        /></a>
        <div class="quick-links walkthrough-links">
          <a :href="withBase('/guide/screenshot-tools.html')"
            ><span
              ><b>Connect your screenshot tool</b
              ><small>ShareX, iTake, Flameshot, Spectacle & Bash</small></span
            ><DocIcon name="arrow"
          /></a>
          <a :href="withBase('/guide/upload-profiles.html')"
            ><span
              ><b>Save your upload preferences</b
              ><small>Profiles, recipes, and token bindings</small></span
            ><DocIcon name="arrow"
          /></a>
          <a :href="withBase('/hosting/maintenance.html')"
            ><span
              ><b>Keep your instance running</b
              ><small
                >Backups, restores, upgrades & daily operations</small
              ></span
            ><DocIcon name="arrow"
          /></a>
        </div>
      </div>
      <div class="hero-visual">
        <a
          :href="withBase('/demos.html')"
          class="browser-frame"
          aria-label="Explore real Flare screenshots and walkthroughs"
        >
          <div class="browser-toolbar">
            <span><DocIcon name="files" />Inside Flare</span
            ><span>The file library<DocIcon name="external" /></span>
          </div>
          <img
            :src="withBase('/screenshots/image-gallery/files-by-month.webp')"
            alt="Flare’s real file library, showing image previews, privacy indicators, search, and files grouped by month."
            width="1440"
            height="1120"
            loading="lazy"
          />
        </a>
        <div class="visual-caption">
          <span>Real app · demonstration data</span
          ><a :href="withBase('/guide/library.html')"
            >Explore the library<DocIcon name="arrow"
          /></a>
        </div>
      </div>
    </section>
    <div class="home-help">
      <span><DocIcon name="search" />Looking for something specific?</span
      ><span
        >Search with <kbd>Ctrl / ⌘ K</kbd> or open
        <a :href="withBase('/hosting/troubleshooting.html')">troubleshooting</a
        >.</span
      >
    </div>
  </div>
</template>
