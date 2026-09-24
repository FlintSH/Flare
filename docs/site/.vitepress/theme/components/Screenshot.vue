<script setup>
import { computed, ref } from 'vue'
import { withBase } from 'vitepress'
const props = defineProps({ src: String, alt: String, caption: String })
const dialog = ref(null)
const source = computed(() =>
  withBase(props.src.replace(/\.(png|jpg)$/, '.webp'))
)
</script>

<template>
  <figure class="doc-screenshot">
    <button
      class="screenshot-button"
      :aria-label="`Enlarge screenshot: ${alt}`"
      @click="dialog.showModal()"
    >
      <img :src="source" :alt="alt" loading="lazy" decoding="async" />
      <span class="enlarge-hint" aria-hidden="true">↗ Enlarge</span>
    </button>
    <figcaption v-if="caption">{{ caption }}</figcaption>
    <dialog
      ref="dialog"
      class="screenshot-dialog"
      :aria-label="alt"
      @click="
        (event) => {
          if (event.target === dialog) dialog.close()
        }
      "
    >
      <button class="dialog-close" autofocus @click="dialog.close()">
        Close <span aria-hidden="true">×</span>
      </button>
      <img :src="source" :alt="alt" />
      <p v-if="caption">{{ caption }}</p>
    </dialog>
  </figure>
</template>
