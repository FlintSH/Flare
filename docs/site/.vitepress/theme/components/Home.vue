<script setup>
import { withBase } from 'vitepress'

const paths = [
  {
    number: '01',
    title: 'Use Flare',
    text: 'Upload, organize, and share your files. Learn folders, tags, pastes, upload profiles, and screenshot tools.',
    link: '/guide/index.html',
    action: 'Read the user guide',
    icon: '⌘',
  },
  {
    number: '02',
    title: 'Self-host Flare',
    text: 'Install with Docker or Railway, choose storage, connect a domain, and plan backups and upgrades.',
    link: '/hosting/index.html',
    action: 'Set up your server',
    icon: '↗',
  },
  {
    number: '03',
    title: 'Administer an instance',
    text: 'Complete setup, manage users and access, configure email and single sign-on, and customize your instance.',
    link: '/admin/index.html',
    action: 'Open the admin guide',
    icon: '◎',
  },
  {
    number: '04',
    title: 'Build integrations',
    text: 'Create scoped API tokens, automate uploads, receive signed webhook events, and follow working examples.',
    link: '/api/index.html',
    action: 'Explore the API',
    icon: '{ }',
  },
]

const references = [
  {
    title: 'Server configuration',
    text: 'Environment variables, defaults, and precedence',
    link: '/hosting/configuration.html',
  },
  {
    title: 'API authentication',
    text: 'Tokens, scopes, and supported operations',
    link: '/api/authentication.html',
  },
  {
    title: 'Webhooks',
    text: 'Events, signatures, retries, and delivery',
    link: '/api/webhooks.html',
  },
  {
    title: 'Troubleshooting',
    text: 'Diagnose common setup and upload problems',
    link: '/hosting/troubleshooting.html',
  },
]
</script>

<template>
  <div class="docs-home">
    <section class="home-hero" aria-labelledby="home-title">
      <div class="hero-copy">
        <span class="eyebrow">THE FLARE HANDBOOK</span>
        <h1 id="home-title">Flare <span>docs</span></h1>
        <p class="hero-description">
          Guides and reference for running Flare, sharing files, and building
          integrations. Start with a walkthrough or find the setting or endpoint
          you need.
        </p>
        <div class="hero-actions">
          <a class="button-primary" :href="withBase('/hosting/index.html')"
            >Set up Flare <span aria-hidden="true">→</span></a
          >
          <a class="button-secondary" :href="withBase('/guide/index.html')"
            >Read the user guide <span aria-hidden="true">→</span></a
          >
        </div>
        <p class="hero-footnote">
          New to Flare?
          <a :href="withBase('/features.html')">Explore the feature guide →</a>
        </p>
      </div>
      <nav class="home-reference" aria-labelledby="reference-title">
        <span class="eyebrow">QUICK REFERENCE</span>
        <h2 id="reference-title">Find an answer</h2>
        <div class="quick-links">
          <a
            v-for="reference in references"
            :key="reference.link"
            :href="withBase(reference.link)"
          >
            <span
              ><b>{{ reference.title }}</b
              ><small>{{ reference.text }}</small></span
            ><span aria-hidden="true">→</span>
          </a>
        </div>
      </nav>
    </section>

    <section class="home-paths" aria-labelledby="paths-title">
      <div class="section-heading">
        <div>
          <span class="eyebrow">GUIDES BY TASK</span>
          <h2 id="paths-title">Where would you like to start?</h2>
        </div>
        <p>Step-by-step help for every part of Flare.</p>
      </div>
      <div class="path-grid">
        <a
          v-for="path in paths"
          :key="path.number"
          :href="withBase(path.link)"
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

    <section class="home-lower" aria-labelledby="walkthroughs-title">
      <div>
        <span class="eyebrow">WALKTHROUGHS & EXAMPLES</span>
        <h2 id="walkthroughs-title">Learn with the real interface.</h2>
        <p>
          Follow a screenshot tour, watch a recorded workflow, or explore upload
          settings and build API request examples in your browser.
        </p>
        <a :href="withBase('/demos.html')" class="text-link"
          >Open the interactive walkthroughs →</a
        >
        <div class="quick-links walkthrough-links">
          <a :href="withBase('/guide/screenshot-tools.html')"
            ><span
              ><b>Connect your screenshot tool</b
              ><small>ShareX, iTake, Flameshot, Spectacle & Bash</small></span
            ><span aria-hidden="true">→</span></a
          >
          <a :href="withBase('/guide/upload-profiles.html')"
            ><span
              ><b>Configure upload profiles</b
              ><small>Saved defaults, recipes, and token bindings</small></span
            ><span aria-hidden="true">→</span></a
          >
          <a :href="withBase('/hosting/maintenance.html')"
            ><span
              ><b>Back up and update your instance</b
              ><small
                >Backups, restores, upgrades & daily operations</small
              ></span
            ><span aria-hidden="true">→</span></a
          >
        </div>
      </div>
      <div class="hero-visual">
        <a
          :href="withBase('/demos.html')"
          class="browser-frame"
          aria-label="Explore real Flare screenshots and walkthroughs"
        >
          <div class="browser-toolbar">
            <span class="window-dots" aria-hidden="true"><i /><i /><i /></span
            ><span>Inside Flare · the file library</span
            ><span aria-hidden="true">↗</span>
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
          <span class="status-dot" /> REAL APP SCREENSHOTS
          <a :href="withBase('/guide/library.html')"
            >Read the library guide →</a
          >
        </div>
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
