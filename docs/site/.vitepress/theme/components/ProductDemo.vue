<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useData, withBase } from 'vitepress'

// The page is rendered ahead of time without knowing the reader's theme or
// screen, so both stills are in the markup and CSS shows the right one. The
// recording itself is chosen in the browser. Below 900px the desktop recording
// would be too small to read, so the phone one is shown at its own size.
const themes = ['dark', 'light']
const asset = (size, theme, kind) =>
  withBase(`/landing/${size}-${theme}${kind}`)

const { isDark } = useData()
const video = ref(null)
const frame = ref(null)
const mounted = ref(false)
const phone = ref(false)
const playing = ref(false)
const playable = ref(true)
const variant = computed(
  () =>
    `${phone.value ? 'mobile' : 'desktop'}-${isDark.value ? 'dark' : 'light'}`
)
// MP4 first: every current browser plays it. WebM covers builds without H.264.
const sources = computed(() =>
  mounted.value
    ? [
        ['video/mp4', withBase(`/landing/${variant.value}.mp4`)],
        ['video/webm', withBase(`/landing/${variant.value}.webm`)],
      ]
    : null
)

// Playback follows what the reader asked for. Until they press the button it
// runs while the recording is on screen, unless they prefer reduced motion.
let wanted = false
let visible = false
let phoneQuery
let observer

function sync() {
  const element = video.value
  if (!element) return
  if (wanted && visible) element.play().catch(() => {})
  else element.pause()
}

// Pressing Play always plays, even when only the edge of the recording shows.
function toggle() {
  wanted = !playing.value
  if (wanted) video.value?.play().catch(() => {})
  else sync()
}

function updatePhone() {
  phone.value = phoneQuery.matches
}

// Changing theme or screen size swaps in another recording, which starts from
// its first frame like the still behind it.
watch(sources, async () => {
  playing.value = false
  playable.value = true
  await nextTick()
  sync()
})

onMounted(() => {
  phoneQuery = window.matchMedia('(max-width: 900px)')
  phone.value = phoneQuery.matches
  phoneQuery.addEventListener('change', updatePhone)
  wanted = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  observer = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting
      sync()
    },
    { threshold: 0.25 }
  )
  observer.observe(frame.value)
  mounted.value = true
})

onUnmounted(() => {
  phoneQuery?.removeEventListener('change', updatePhone)
  observer?.disconnect()
})
</script>

<template>
  <figure class="product-demo" :data-playing="playing" :data-variant="variant">
    <div ref="frame" class="product-demo-frame">
      <picture
        v-for="theme in themes"
        :key="theme"
        class="product-demo-still"
        :class="`is-${theme}`"
      >
        <source
          media="(max-width: 900px)"
          :srcset="asset('mobile', theme, '-poster.webp')"
          width="780"
          height="1240"
        />
        <img
          :src="asset('desktop', theme, '-poster.webp')"
          width="2240"
          height="1400"
          alt="Flare’s file library: a search box and filters above a grid of image and code files."
          loading="lazy"
          decoding="async"
        />
      </picture>
      <video
        v-if="sources"
        ref="video"
        :key="variant"
        muted
        loop
        playsinline
        preload="metadata"
        aria-label="Recording of Flare: a file is uploaded, opened, and its link is copied."
        @click="toggle"
        @play="playing = true"
        @pause="playing = false"
      >
        <source
          v-for="([type, src], index) in sources"
          :key="type"
          :type="type"
          :src="src"
          @error="index === sources.length - 1 && (playable = false)"
        />
      </video>
    </div>
    <figcaption>
      <p>Upload a file, open it, copy the link.</p>
      <button
        v-if="mounted && playable"
        type="button"
        class="product-demo-toggle"
        :aria-label="playing ? 'Pause the recording' : 'Play the recording'"
        @click="toggle"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            :d="playing ? 'M3 2h4v12H3zm6 0h4v12H9z' : 'm4 2 10 6-10 6z'"
          />
        </svg>
        {{ playing ? 'Pause' : 'Play' }}
      </button>
    </figcaption>
  </figure>
</template>
