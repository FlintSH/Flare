<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import Screenshot from './Screenshot.vue'
const current = ref(0)
const steps = [
  {
    title: 'File library',
    label: 'Library',
    src: '/screenshots/timeline/library-desktop.webp',
    text: 'Scroll through every matching file without changing pages. The slim date rail lets you jump into your upload history; search, folders, and filters keep the view focused.',
    link: '/guide/library',
  },
  {
    title: 'Upload options',
    label: 'Upload',
    src: '/screenshots/workspace/upload.png',
    text: 'Choose files and a saved upload profile. Visibility, passwords, and expiration let you decide how this upload is shared.',
    link: '/guide/uploading',
  },
  {
    title: 'Share pages',
    label: 'Share pages',
    src: '/screenshots/workspace/share-framed-image.png',
    text: 'A share page gives recipients the file’s name, type, size, and actions above its preview. The Minimal and Delivery layouts frame the same file differently.',
    link: '/guide/sharing',
  },
  {
    title: 'Upload profiles',
    label: 'Profiles',
    src: '/screenshots/handbook/upload-profiles.webp',
    text: 'Start from a recipe, review what it inherits, and save a profile for your browser or capture tool. Export its preferences to reuse them; selected tags belong to the original account.',
    link: '/guide/upload-profiles',
  },
  {
    title: 'Appearance',
    label: 'Appearance',
    src: '/screenshots/handbook/appearance-studio.webp',
    text: 'The appearance studio combines identity, palettes, and sharing preferences with previews. Draft your changes before publishing them.',
    link: '/admin/appearance',
  },
  {
    title: 'Roles and permissions',
    label: 'Roles',
    src: '/screenshots/roles/role-editor.webp',
    text: 'Create reusable permission groups, combine roles on an account, and delegate moderation or design. Everyone supplies the baseline; additional roles add access.',
    link: '/admin/roles',
  },
  {
    title: 'Two-factor and passkeys',
    label: 'Sign-in',
    src: '/screenshots/security/security-overview.webp',
    text: 'Add an authenticator or passkey in Profile → Account. Optionally require passkey sign-in to block password and SSO fallback, with dedicated emergency recovery codes.',
    link: '/guide/security',
  },
  {
    title: 'Sessions and login history',
    label: 'Sessions',
    src: '/screenshots/audit/sessions-desktop.webp',
    text: 'Review active browser sessions and login history in Profile → Account. Revoke an unfamiliar session, or sign out every browser including this one.',
    link: '/guide/account',
  },
  {
    title: 'Audit log',
    label: 'Audit log',
    src: '/screenshots/audit/audit-desktop.webp',
    text: 'Use Audit log to filter file operations, background processing, and administrative changes. Inspect the actor, filename, outcome, and recorded details.',
    link: '/admin/audit',
  },
  {
    title: 'API tokens and webhooks',
    label: 'API',
    src: '/screenshots/handbook/integrations.webp',
    text: 'Create a named API token for a custom uploader or add a signed webhook receiver. Each connection belongs to your account.',
    link: '/api/',
  },
  {
    title: 'Archives',
    label: 'Archives',
    src: '/screenshots/archives/share-entry.webp',
    text: 'Browse archives of any size and preview images, video, audio, and text inside them without unpacking. In your own library, extract into a new folder or package files as ZIP/TAR.GZ with private defaults or an explicitly reviewed upload profile.',
    link: '/guide/archives',
  },
  {
    title: 'Invite links',
    label: 'Invites',
    src: '/screenshots/invites/profile-invites.webp',
    text: 'Keep registration closed and send invite links instead. Choose how many people each link admits and when it expires, see who joined, and revoke a link anytime.',
    link: '/guide/invites',
  },
]
const step = computed(() => steps[current.value])
</script>

<template>
  <section class="demo-tour" aria-label="Flare product walkthrough">
    <div class="filter-pills">
      <button
        v-for="(item, index) in steps"
        :key="item.label"
        :aria-pressed="current === index"
        @click="current = index"
      >
        {{ index + 1 }}. {{ item.label }}
      </button>
    </div>
    <Screenshot
      :src="step.src"
      :alt="step.title"
      :caption="'Captured from Flare with demonstration data. Your instance’s appearance and files will differ.'"
    />
    <div aria-live="polite" class="tour-description">
      <h3>{{ step.title }}</h3>
      <p>{{ step.text }}</p>
      <a :href="withBase(step.link.replace(/\/$/, '/index') + '.html')"
        >Read the complete guide →</a
      >
    </div>
    <div class="demo-navigation">
      <button :disabled="current === 0" @click="current--">← Previous</button
      ><span>{{ current + 1 }} / {{ steps.length }}</span
      ><button :disabled="current === steps.length - 1" @click="current++">
        Next step →
      </button>
    </div>
  </section>
</template>
