<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
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
    'Images with zoom, video and audio in Flare’s own player, PDFs, CSV and TSV tables, plain text, and syntax-highlighted code, each under the file’s name, type, size, and actions.',
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
    'Embeds & link previews',
    'Show an image or video on its own where a link is pasted, with a frame from the video in its real shape, or a card you write with placeholders, an author line, and an accent color.',
    '/guide/embeds',
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
    'Edit current tags across a retained selection, filter by a tag, and apply matching rules by filename or extracted image text.',
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
    'Continuous file timeline',
    'Scroll through every matching file and use a quiet date rail to jump into your upload history.',
    '/guide/library',
  ],
  [
    'Organize',
    'Image gallery',
    'Browse images by month, see a frame from every video, open the lightbox, and navigate with keyboard arrows or touch.',
    '/guide/library',
  ],
  [
    'Organize',
    'Archives',
    'Browse ZIP, TAR, and TAR.GZ archives of any size, preview images, video, audio, and text inside them, or extract and create ZIP/TAR.GZ files in your own library.',
    '/guide/archives',
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
    'Personalize',
    'Two-factor authentication',
    'Protect password sign-in with authenticator codes (2FA) and keep one-time recovery codes for a lost device.',
    '/guide/security',
  ],
  [
    'Personalize',
    'Passkeys',
    'Sign in with your device or security key; optionally require a passkey and save separate emergency recovery codes.',
    '/guide/security',
  ],
  [
    'Personalize',
    'Login history & active sessions',
    'Review recent sign-ins and their device details, then revoke one browser session or every session on your account.',
    '/guide/account',
  ],
  [
    'Host & administer',
    'Instance audit log',
    'Investigate file activity, background processing, access failures, role changes, and settings with searchable audit events.',
    '/admin/audit',
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
    'Use multipart or chunked uploads, list files, and create or manage short links, from servers or, once the instance allows their origin, from web apps in the browser.',
    '/api/files',
  ],
  [
    'Automate',
    'Signed webhooks',
    'React to file.ready events with HMAC signatures, retries, test events, and delivery history.',
    '/api/webhooks',
  ],
  [
    'Automate',
    'AI agents (MCP)',
    'Connect Claude Code, Codex, Cursor, Claude, ChatGPT, and other MCP clients to your account by signing in through your browser. They find, read, upload, and organize files, look inside, extract, or create an archive, and change account settings within the actions you allow.',
    '/guide/agents',
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
    'Roles & permissions',
    'Combine permission groups, delegate moderation or design, and protect administrator access with role hierarchy.',
    '/admin/roles',
  ],
  [
    'Host & administer',
    'Invite links',
    'Let people join a private instance with a link. Set uses, expiry, and roles; see who joined; let members invite within limits.',
    '/guide/invites',
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
    'Backups and upgrades',
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
// Cards sit under their area, so the area is said once instead of on each card.
// Every area stays in the page, hidden while it has nothing to show, so the
// outline's links to them always have somewhere to go.
const groups = computed(() =>
  categories.slice(1).map((name) => ({
    name,
    id: name.toLowerCase().replace(/[^a-z]+/g, '-'),
    items: filtered.value.filter((item) => item[0] === name),
  }))
)

// A link to an area that the current search or filter hides shows everything
// again and goes there.
async function showArea(hash) {
  const id = decodeURIComponent(hash.slice(1))
  const group = groups.value.find((item) => item.id === id)
  if (!group || (category.value === 'Everything' && group.items.length)) return
  category.value = 'Everything'
  query.value = ''
  await nextTick()
  // The site's own scroll for this link runs on the next frame and still has
  // the hidden area's position, so go to the area after it.
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView())
}
const onHashChange = () => showArea(location.hash)
// Following a link to the area already in the address does not change the
// hash, so clicks on such links are handled as well.
function onLinkClick(event) {
  const link = event.target.closest?.('a[href]')
  if (link?.origin === location.origin && link.pathname === location.pathname)
    showArea(link.hash)
}
onMounted(() => {
  window.addEventListener('hashchange', onHashChange)
  document.addEventListener('click', onLinkClick)
})
onUnmounted(() => {
  window.removeEventListener('hashchange', onHashChange)
  document.removeEventListener('click', onLinkClick)
})
</script>

<template>
  <section class="feature-explorer" aria-label="Filter Flare features">
    <label class="visually-hidden" for="feature-query">Search features</label>
    <input
      id="feature-query"
      v-model="query"
      type="search"
      placeholder="Search features"
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
    <!-- A count only says something once a search or filter has changed it. -->
    <p class="result-count" role="status">
      {{
        filtered.length === features.length
          ? ''
          : `${filtered.length} of ${features.length} features`
      }}
    </p>
    <div
      v-for="group in groups"
      v-show="group.items.length"
      :key="group.name"
      class="feature-group"
    >
      <!-- A chosen area is already named by its filter. -->
      <h2 v-show="category === 'Everything'" :id="group.id">
        {{ group.name }}
      </h2>
      <div class="feature-grid">
        <a
          v-for="item in group.items"
          :key="item[1]"
          :href="withBase(item[3] + '.html')"
          class="feature-card"
        >
          <h3>{{ item[1] }}</h3>
          <p>{{ item[2] }}</p>
        </a>
      </div>
    </div>
    <p v-if="!filtered.length">
      No matches. Try another word or choose Everything.
    </p>
  </section>
</template>
