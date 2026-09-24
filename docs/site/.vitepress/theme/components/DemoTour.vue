<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
import Screenshot from './Screenshot.vue'
const current = ref(0)
const steps = [
  {
    title: 'A home for every file',
    label: 'Browse',
    src: '/screenshots/image-gallery/files-by-month.png',
    text: 'Filter your library to images and choose Group files → By month in Upload date. Open an image for a closer look, then move through the filtered gallery.',
    link: '/guide/library',
  },
  {
    title: 'Upload with intention',
    label: 'Upload',
    src: '/screenshots/workspace/upload.png',
    text: 'Choose files and a saved upload profile. Visibility, passwords, and expiration let you decide how this upload is shared.',
    link: '/guide/uploading',
  },
  {
    title: 'One link, a proper preview',
    label: 'Share',
    src: '/screenshots/workspace/share-framed-image.png',
    text: 'A framed share page gives recipients an image preview and file actions. Minimal and delivery layouts offer different ways to present the same file.',
    link: '/guide/sharing',
  },
  {
    title: 'Your favorite settings, saved',
    label: 'Repeat',
    src: '/screenshots/handbook/upload-profiles.webp',
    text: 'Start from a recipe, review what it inherits, and save a profile for your browser or capture tool. Export its preferences to reuse them; selected tags belong to the original account.',
    link: '/guide/upload-profiles',
  },
  {
    title: 'Put your name on it',
    label: 'Customize',
    src: '/screenshots/handbook/appearance-studio.webp',
    text: 'The appearance studio combines identity, palettes, and sharing preferences with previews. Draft your changes before publishing them.',
    link: '/admin/appearance',
  },
  {
    title: 'Keep your tools connected',
    label: 'Automate',
    src: '/screenshots/handbook/integrations.webp',
    text: 'Create a named API token for a custom uploader or add a signed webhook receiver. Each connection belongs to your account.',
    link: '/api/',
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
    <div aria-live="polite" class="tour-description">
      <span class="eyebrow"
        >STEP {{ current + 1 }} OF {{ steps.length }} · REAL APP
        SCREENSHOTS</span
      >
      <h3>{{ step.title }}</h3>
      <p>{{ step.text }}</p>
      <a :href="withBase(step.link.replace(/\/$/, '/index') + '.html')"
        >Read the complete guide →</a
      >
    </div>
    <Screenshot
      :src="step.src"
      :alt="step.title"
      :caption="'Captured from Flare with demonstration data. Your instance’s appearance and files will differ.'"
    />
    <div class="demo-navigation">
      <button :disabled="current === 0" @click="current--">← Previous</button
      ><span>{{ current + 1 }} / {{ steps.length }}</span
      ><button :disabled="current === steps.length - 1" @click="current++">
        Next step →
      </button>
    </div>
  </section>
</template>
