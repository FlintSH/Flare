<script setup>
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useId,
  watch,
} from 'vue'
import { withBase } from 'vitepress'
import DocIcon from './DocIcon.vue'
import {
  advanceShowcase,
  initialShowcase,
  showcaseChapters,
  SHOWCASE_DURATION,
} from './showcase-model.mjs'

const root = ref(null)
const playback = ref(initialShowcase())
const environment = ref({
  mounted: false,
  inView: false,
  pageVisible: true,
  reducedMotion: true,
})
const id = useId()
const tabs = []
const chapter = computed(() => showcaseChapters[playback.value.chapter])
const progress = computed(() =>
  Math.min(1, playback.value.elapsed / SHOWCASE_DURATION)
)
const running = computed(
  () =>
    playback.value.mode === 'playing' &&
    environment.value.mounted &&
    environment.value.inView &&
    environment.value.pageVisible
)
const stage = (start, end) =>
  Math.max(0, Math.min(1, (progress.value - start) / (end - start)))
const tools = ['ShareX', 'iTake', 'Flameshot', 'Spectacle', 'Bash']
const activeTool = computed(() =>
  Math.min(tools.length - 1, Math.floor(progress.value * tools.length))
)
const query = computed(() =>
  'invoice'.slice(0, Math.floor(stage(0.2, 0.58) * 7))
)
const request =
  'curl "$FLARE_URL/api/files" \\\n  -H "Authorization: Bearer $FLARE_TOKEN" \\\n  -F "file=@capture.png"'
const typedRequest = computed(() =>
  request.slice(0, Math.ceil(stage(0.08, 0.72) * request.length))
)
const storage = computed(() => (progress.value < 0.5 ? 'local' : 's3'))
const routePoint = computed(() => {
  const t = progress.value < 0.5 ? stage(0.08, 0.43) : stage(0.56, 0.94)
  const end = storage.value === 'local' ? 110 : 370
  return {
    x: 240 * (1 - t * t) + end * t * t,
    y: 2 * (1 - t) * t * 52 + t * t * 82,
  }
})
let timer
let observer
let motionQuery

function stopClock() {
  clearInterval(timer)
  timer = undefined
}

watch(running, (value) => {
  stopClock()
  if (!value) return
  let last = performance.now()
  timer = setInterval(() => {
    const now = performance.now()
    playback.value = advanceShowcase(playback.value, Math.min(now - last, 250))
    last = now
  }, 50)
})

function selectChapter(index, focus = false) {
  playback.value = {
    chapter: index,
    elapsed: SHOWCASE_DURATION,
    mode: 'paused',
  }
  if (focus) nextTick(() => tabs[index]?.focus())
}

function pauseForNavigation() {
  if (playback.value.mode === 'playing')
    playback.value = { ...playback.value, mode: 'paused' }
}

function onTabKey(event) {
  let index = playback.value.chapter
  if (event.key === 'ArrowRight') index = (index + 1) % showcaseChapters.length
  else if (event.key === 'ArrowLeft')
    index = (index + showcaseChapters.length - 1) % showcaseChapters.length
  else if (event.key === 'Home') index = 0
  else if (event.key === 'End') index = showcaseChapters.length - 1
  else return
  event.preventDefault()
  selectChapter(index, true)
}

function togglePlayback() {
  playback.value =
    playback.value.mode === 'playing'
      ? { ...playback.value, mode: 'paused' }
      : {
          ...playback.value,
          elapsed:
            playback.value.elapsed >= SHOWCASE_DURATION
              ? 0
              : playback.value.elapsed,
          mode: 'playing',
        }
}

function updateVisibility() {
  environment.value = {
    ...environment.value,
    pageVisible: document.visibilityState === 'visible',
  }
}

function updateMotion() {
  environment.value = {
    ...environment.value,
    reducedMotion: motionQuery.matches,
  }
  if (motionQuery.matches)
    playback.value = { ...playback.value, mode: 'paused' }
}

onMounted(() => {
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  environment.value = {
    ...environment.value,
    mounted: true,
    pageVisible: document.visibilityState === 'visible',
    reducedMotion: motionQuery.matches,
  }
  if (!motionQuery.matches)
    playback.value = { chapter: 0, elapsed: 0, mode: 'playing' }
  observer = new IntersectionObserver(
    ([entry]) => {
      environment.value = { ...environment.value, inView: entry.isIntersecting }
    },
    { threshold: 0.15 }
  )
  observer.observe(root.value)
  document.addEventListener('visibilitychange', updateVisibility)
  motionQuery.addEventListener('change', updateMotion)
})

onUnmounted(() => {
  stopClock()
  observer?.disconnect()
  document.removeEventListener('visibilitychange', updateVisibility)
  motionQuery?.removeEventListener('change', updateMotion)
})
</script>

<template>
  <section
    ref="root"
    class="flare-showcase"
    :class="{ 'fs-paused': !running }"
    :data-scene="chapter.id"
    :data-mode="playback.mode"
    :data-running="running"
    :data-progress="progress.toFixed(4)"
    aria-label="Interactive Flare feature preview"
  >
    <div class="fs-header">
      <div class="fs-brand">
        <img :src="withBase('/icon.svg')" width="18" height="22" alt="" /><b
          >Flare</b
        ><span>Interactive demo</span>
      </div>
      <button
        class="fs-playback"
        type="button"
        :aria-label="
          playback.mode === 'playing'
            ? 'Pause feature showcase'
            : 'Play feature showcase'
        "
        @click="togglePlayback"
      >
        <svg
          v-if="playback.mode === 'playing'"
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M4 3h3v10H4zm5 0h3v10H9z" />
        </svg>
        <svg
          v-else
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="m5 2 8 6-8 6z" />
        </svg>
        {{ playback.mode === 'playing' ? 'Pause' : 'Play' }}
      </button>
    </div>
    <div
      class="fs-tabs"
      role="tablist"
      aria-label="Feature showcase chapters"
      @keydown="onTabKey"
      @focusin="pauseForNavigation"
    >
      <button
        v-for="(item, index) in showcaseChapters"
        :id="`${id}-tab-${index}`"
        :key="item.id"
        :ref="(element) => (tabs[index] = element)"
        role="tab"
        type="button"
        :aria-selected="index === playback.chapter"
        :aria-controls="`${id}-panel`"
        :tabindex="index === playback.chapter ? 0 : -1"
        @click="selectChapter(index)"
      >
        <DocIcon :name="item.icon" /><span>{{ item.label }}</span>
      </button>
    </div>
    <div
      :id="`${id}-panel`"
      class="fs-stage"
      role="tabpanel"
      :aria-labelledby="`${id}-tab-${playback.chapter}`"
      aria-live="off"
    >
      <p class="visually-hidden">{{ chapter.description }}</p>
      <div class="fs-scene" aria-hidden="true">
        <template v-if="chapter.id === 'capture'">
          <div class="fs-tools">
            <span
              v-for="(tool, index) in tools"
              :key="tool"
              :class="{ active: index === activeTool }"
              >{{ tool }}</span
            >
          </div>
          <div class="fs-flow-line">
            <span
              :style="{
                left: `${12 + stage(0.05, 0.35) * 76}%`,
                opacity: progress < 0.42 ? 1 : 0,
              }"
              ><DocIcon name="files" />capture.png</span
            ><i />
          </div>
          <div class="fs-workspace-header">
            <b>Your files</b
            ><span :class="['fs-status', { ready: progress > 0.72 }]">{{
              progress > 0.72 ? '✓ Link ready' : 'Receiving capture…'
            }}</span>
          </div>
          <div class="fs-files">
            <div
              v-for="(file, index) in [
                'Morning.webp',
                'Moodboard.webp',
                'capture.png',
              ]"
              :key="file"
              class="fs-file"
              :class="[
                `fs-tone-${index}`,
                {
                  'fs-file-arriving': index === 2,
                  visible: index < 2 || progress > 0.42,
                },
              ]"
            >
              <svg viewBox="0 0 160 78" class="fs-thumb" role="presentation">
                <rect width="160" height="78" class="fs-sky" />
                <circle cx="117" cy="22" r="10" class="fs-sun" />
                <path
                  d="m0 61 47-34 37 31 33-19 43 31v8H0Z"
                  class="fs-mountain-back"
                />
                <path
                  d="m0 78 49-30 40 20 29-13 42 23Z"
                  class="fs-mountain-front"
                />
              </svg>
              <b>{{ file }}</b
              ><small>{{ index === 2 ? 'Just now' : 'In your library' }}</small>
            </div>
          </div>
        </template>

        <template v-else-if="chapter.id === 'organize'">
          <div class="fs-workspace-header">
            <b
              >Your files
              <span class="fs-breadcrumb"
                >/ {{ progress > 0.68 ? 'Projects' : 'Unfiled' }}</span
              ></b
            ><span class="fs-count">2 selected</span>
          </div>
          <div class="fs-organize-layout">
            <div class="fs-organize-files" :class="{ moved: progress > 0.65 }">
              <div
                v-for="(file, index) in ['capture.png', 'Moodboard.webp']"
                :key="file"
                class="fs-compact-file"
                :class="`fs-tone-${index}`"
              >
                <span class="fs-mini-art"
                  ><svg viewBox="0 0 60 44">
                    <rect width="60" height="44" class="fs-sky" />
                    <path
                      d="m0 44 19-28 16 16 12-12 13 24Z"
                      class="fs-mountain-front"
                    /></svg></span
                ><span
                  ><b>{{ file }}</b
                  ><small
                    class="fs-file-tag"
                    :class="{ visible: progress > 0.3 }"
                    >Design</small
                  ></span
                ><span class="fs-selected-mark">✓</span>
              </div>
            </div>
            <span class="fs-organize-arrow" :class="{ active: progress > 0.5 }"
              >→</span
            >
            <div class="fs-folder" :class="{ active: progress > 0.65 }">
              <svg width="42" height="36" viewBox="0 0 42 36" fill="none">
                <path
                  d="M3 7a3 3 0 0 1 3-3h10l4 5h16a3 3 0 0 1 3 3v16a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"
                  fill="currentColor"
                  fill-opacity=".1"
                  stroke="currentColor"
                  stroke-width="1.5"
                /></svg
              ><b>Projects</b
              ><small>{{
                progress > 0.65 ? '2 files · Design' : 'Ready for your files'
              }}</small>
            </div>
          </div>
          <div class="fs-bottom-note">
            <span :class="{ 'fs-note-done': progress > 0.72 }">{{
              progress > 0.72
                ? '✓ Tagged and organized'
                : progress > 0.3
                  ? 'Design tag added'
                  : 'Select the files you need'
            }}</span
            ><span>Original links stay the same</span>
          </div>
        </template>

        <template v-else-if="chapter.id === 'ocr'">
          <div class="fs-workspace-header">
            <b>Search your library</b><span class="fs-soft-badge">OCR</span>
          </div>
          <div class="fs-ocr-layout">
            <div class="fs-receipt">
              <small>STUDIO KIT</small><b>INVOICE #042</b
              ><span>Design supplies</span>
              <div class="fs-receipt-lines"><i /><i /><i /></div>
              <strong>$128.00</strong
              ><span
                class="fs-scan"
                :style="{
                  top: `${18 + stage(0.02, 0.55) * 64}%`,
                  opacity: progress > 0.55 ? 0 : 1,
                }"
              /><span
                class="fs-recognized"
                :class="{ visible: progress > 0.48 }"
                >Text recognized ✓</span
              >
            </div>
            <div class="fs-ocr-results">
              <div class="fs-query">
                <DocIcon name="search" /><span
                  >{{ query
                  }}<i v-if="running && progress < 0.6" class="fs-caret"
                /></span>
              </div>
              <small class="fs-result-count">{{
                progress > 0.6
                  ? '1 matching file'
                  : 'Search filenames and image text'
              }}</small>
              <div
                class="fs-search-result"
                :class="{ visible: progress > 0.6 }"
              >
                <span class="fs-paper-icon"><DocIcon name="files" /></span>
                <div>
                  <b>scan-042.png</b>
                  <p><mark>INVOICE</mark> #042</p>
                  <small>Matched text in image</small>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="chapter.id === 'storage'">
          <div class="fs-workspace-header">
            <b>Choose where files live</b
            ><span class="fs-soft-badge">Your storage</span>
          </div>
          <div class="fs-storage-origin">
            <DocIcon name="files" /><b>capture.png</b>
          </div>
          <svg
            class="fs-storage-routes"
            viewBox="0 0 480 86"
            fill="none"
            preserveAspectRatio="none"
          >
            <path
              d="M240 0Q240 52 110 82"
              :class="{ active: storage === 'local' }"
            />
            <path
              d="M240 0Q240 52 370 82"
              :class="{ active: storage === 's3' }"
            />
            <circle :cx="routePoint.x" :cy="routePoint.y" r="4" />
          </svg>
          <div class="fs-providers">
            <div :class="{ active: storage === 'local' }">
              <DocIcon name="server" /><b>Local disk</b
              ><small>On your server</small
              ><span>{{
                storage === 'local'
                  ? 'Selected destination'
                  : 'Available option'
              }}</span>
            </div>
            <div :class="{ active: storage === 's3' }">
              <svg
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              >
                <path
                  d="M7 18H5a4 4 0 0 1-1-7.87A7 7 0 0 1 17.7 8a5 5 0 0 1 1.3 9.83H17M12 12v10m-3-7 3-3 3 3"
                /></svg
              ><b>S3-compatible</b><small>In your bucket</small
              ><span>{{
                storage === 's3' ? 'Selected destination' : 'Available option'
              }}</span>
            </div>
          </div>
        </template>

        <template v-else-if="chapter.id === 'api'">
          <div class="fs-workspace-header">
            <b>Make it part of your workflow</b
            ><span class="fs-soft-badge">Example</span>
          </div>
          <div class="fs-terminal">
            <div class="fs-terminal-title">
              <DocIcon name="terminal" /><span>Upload with curl</span
              ><span>POST /api/files</span>
            </div>
            <pre>{{ typedRequest }}<i v-if="running && progress < 0.74" class="fs-caret" /></pre>
          </div>
          <div class="fs-api-capabilities">
            <span :class="{ visible: progress > 0.55 }"
              ><DocIcon name="shield" /><b>files:upload</b
              ><small>Scoped tokens</small></span
            ><span :class="{ visible: progress > 0.78 }"
              ><DocIcon name="code" /><b>file.ready</b
              ><small>Signed webhooks</small></span
            >
          </div>
        </template>

        <template v-else>
          <div class="fs-workspace-header">
            <b>Roles &amp; permissions</b
            ><span class="fs-soft-badge">Example grants</span>
          </div>
          <div class="fs-person">
            <span class="fs-avatar">AR</span>
            <div><b>Alex Rivera</b><small>Team member</small></div>
            <span class="fs-role">Everyone</span
            ><span
              class="fs-role fs-added-role"
              :class="{ visible: progress > 0.32 }"
              >+ Contributors</span
            >
          </div>
          <div class="fs-permissions">
            <div><span>View files</span><small>Everyone</small><b>✓</b></div>
            <div :class="{ granted: progress > 0.5 }">
              <span>Upload files</span
              ><small>{{
                progress > 0.5 ? 'Contributors' : 'Not granted'
              }}</small
              ><b>{{ progress > 0.5 ? '✓' : '–' }}</b>
            </div>
            <div>
              <span>Manage instance</span><small>Not granted</small
              ><b class="fs-not-granted">–</b>
            </div>
          </div>
          <div class="fs-bottom-note">
            <span>{{
              progress > 0.5
                ? 'Additional roles add permissions.'
                : 'Everyone is the shared baseline.'
            }}</span>
          </div>
        </template>
      </div>
    </div>
    <div class="fs-progress" aria-hidden="true">
      <span v-for="(item, index) in showcaseChapters" :key="item.id"
        ><i
          :style="{
            width: index === playback.chapter ? `${progress * 100}%` : '0%',
          }"
      /></span>
    </div>
    <div class="fs-footer">
      <span>{{ chapter.caption }}</span
      ><a :href="withBase(chapter.guide)"
        >Read the guide<DocIcon name="arrow"
      /></a>
    </div>
    <span class="fs-sample-label">Sample data · no account connected</span>
    <noscript
      ><img
        class="fs-noscript"
        :src="withBase('/landing/library-desktop.webp')"
        alt="Flare’s real file library with demonstration files. Enable JavaScript to explore the interactive feature preview."
        width="1440"
        height="1000"
    /></noscript>
  </section>
</template>

<style src="../showcase.css"></style>
