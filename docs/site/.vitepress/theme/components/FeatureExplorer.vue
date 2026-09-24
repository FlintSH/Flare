<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
const category = ref('Everything')
const query = ref('')
const categories = [
  'Everything',
  'Share',
  'Organize',
  'Personalize',
  'Automate',
  'Host & administer',
]
const features = [
  [
    'Share',
    'File uploads',
    'Drag and drop, queue multiple files, choose a destination, and transfer large files in chunks.',
    '/guide/uploading',
  ],
  [
    'Share',
    'Rich previews',
    'Images with zoom, video, audio, PDFs, CSV tables, plain text, and syntax-highlighted code.',
    '/guide/sharing',
  ],
  [
    'Share',
    'Sharing controls',
    'Public or private access, password protection, expiring links, and view/download counts.',
    '/guide/sharing',
  ],
  [
    'Share',
    'Pastes & code',
    'Turn a note or code snippet into a hosted text file with a read-only preview.',
    '/guide/pastes',
  ],
  [
    'Share',
    'Short links',
    'Create a compact URL on your domain and follow its click count.',
    '/guide/short-links',
  ],
  [
    'Share',
    'Screenshot tools',
    'Download account-ready configurations for ShareX and iTake, or scripts for Flameshot, Spectacle, and Bash.',
    '/guide/screenshot-tools',
  ],
  [
    'Organize',
    'Folders & subfolders',
    'Give files a home, move them in bulk, and share direct public contents in a folder gallery.',
    '/guide/folders',
  ],
  [
    'Organize',
    'Tags & automatic rules',
    'Label files, filter by a tag, and apply matching rules by filename or extracted image text.',
    '/guide/tags',
  ],
  [
    'Organize',
    'Search & filters',
    'Find files by name or OCR text, and narrow the library by date, type, tags, and visibility.',
    '/guide/library',
  ],
  [
    'Organize',
    'Image gallery',
    'Browse images by month, open the lightbox, and navigate with keyboard arrows or touch.',
    '/guide/library',
  ],
  [
    'Organize',
    'OCR',
    'Extract text from images in the background for searching and automatic tagging.',
    '/guide/tags',
  ],
  [
    'Personalize',
    'Upload profiles',
    'Reuse visibility, expiration, URL naming, tags, and share-page preferences across clients.',
    '/guide/upload-profiles',
  ],
  [
    'Personalize',
    'Appearance studio',
    'Preview and publish your identity, light/dark palettes, typography, and shared-page layout.',
    '/admin/appearance',
  ],
  [
    'Personalize',
    'Portable recipes & packs',
    'Export upload preferences and appearance designs. Recipe tags remain specific to their original account.',
    '/admin/appearance',
  ],
  [
    'Personalize',
    'Your account',
    'Manage avatar, password, personal theme, upload token, default expiration, and data export.',
    '/guide/account',
  ],
  [
    'Automate',
    'Scoped API tokens',
    'Give each integration its own revocable permissions, expiration, and optional upload profile binding.',
    '/api/authentication',
  ],
  [
    'Automate',
    'Upload & listing API',
    'Use multipart or chunked uploads, list files, and create or manage short links.',
    '/api/files',
  ],
  [
    'Automate',
    'Signed webhooks',
    'React to file.ready events with HMAC signatures, retries, test events, and delivery history.',
    '/api/webhooks',
  ],
  [
    'Host & administer',
    'Guided setup',
    'Create an administrator, choose storage and registration policy, then optionally personalize and configure email.',
    '/admin/setup',
  ],
  [
    'Host & administer',
    'Local or S3 storage',
    'Use persistent disk or an S3-compatible bucket, with a PostgreSQL database for metadata.',
    '/hosting/storage',
  ],
  [
    'Host & administer',
    'Access & moderation',
    'Manage users, roles, shared storage quotas, registration, and uploaded content.',
    '/admin/users',
  ],
  [
    'Host & administer',
    'Account email',
    'Optional SMTP delivery, password recovery, address verification, and confirmed email changes.',
    '/admin/email',
  ],
  [
    'Host & administer',
    'OpenID Connect',
    'Connect an identity provider, control provisioning, and retain a local administrator recovery route.',
    '/admin/sso',
  ],
  [
    'Host & administer',
    'Operate with confidence',
    'Back up the database and files, preserve secrets, upgrade carefully, and diagnose failures.',
    '/hosting/maintenance',
  ],
]
const filtered = computed(() =>
  features.filter(
    (item) =>
      (category.value === 'Everything' || item[0] === category.value) &&
      item.join(' ').toLowerCase().includes(query.value.toLowerCase())
  )
)
</script>

<template>
  <section class="feature-explorer" aria-label="Filter Flare features">
    <label class="input-label" for="feature-query">Find a capability</label>
    <input
      id="feature-query"
      v-model="query"
      type="search"
      placeholder="Try passwords, S3, screenshots…"
      class="demo-input"
    />
    <div class="filter-pills" aria-label="Feature categories">
      <button
        v-for="item in categories"
        :key="item"
        :aria-pressed="category === item"
        @click="category = item"
      >
        {{ item }}
      </button>
    </div>
    <p class="result-count" role="status">
      {{ filtered.length }} of {{ features.length }} capabilities
    </p>
    <div class="feature-grid">
      <a
        v-for="item in filtered"
        :key="item[1]"
        :href="withBase(item[3] + '.html')"
        class="feature-card"
        ><span class="eyebrow">{{ item[0] }}</span>
        <h3>{{ item[1] }} <span aria-hidden="true">↗</span></h3>
        <p>{{ item[2] }}</p></a
      >
    </div>
    <p v-if="!filtered.length">
      No matches. Try another word or choose Everything.
    </p>
  </section>
</template>
