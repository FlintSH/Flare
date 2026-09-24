<script setup>
import { ref } from 'vue'
import { useSidebar } from 'vitepress/theme'

const { hasSidebar } = useSidebar()
const buttonUnavailable = ref(false)
</script>

<template>
  <footer class="project-credit" :class="{ 'has-sidebar': hasSidebar }">
    <div class="project-credit-inner">
      <a class="creator-link" href="https://fl1nt.dev">
        <!-- Official hotlink from fl1nt.dev; preserve the original pixel art. -->
        <img
          v-if="!buttonUnavailable"
          src="https://fl1nt.dev/images/mybutton.gif"
          alt=""
          width="88"
          height="31"
          loading="lazy"
          decoding="async"
          @error="buttonUnavailable = true"
        />
        <span class="creator-text">
          <span>Created by FlintSH</span>
          <strong>fl1nt.dev <span aria-hidden="true">↗</span></strong>
        </span>
      </a>
      <div class="project-credit-details">
        <p>Open source. Yours to make your own.</p>
        <p>
          <a href="https://github.com/FlintSH/Flare/blob/main/LICENSE"
            >MIT License</a
          >
          <span aria-hidden="true"> · </span>
          Icon by <a href="https://ko-fi.com/xnefas/">xNefas</a>
        </p>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.project-credit {
  border-top: 1px solid var(--flare-line);
  padding: 28px 24px;
  background: var(--vp-c-bg);
}
.project-credit-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 20px 32px;
  max-width: 1232px;
  margin: 0 auto;
}
.creator-link {
  display: inline-flex;
  align-items: center;
  gap: 16px;
  border-radius: 4px;
}
.creator-link img {
  flex: none;
  width: 88px;
  height: 31px;
  image-rendering: pixelated;
}
.creator-text {
  display: grid;
  gap: 2px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
.creator-text strong {
  font-size: 14px;
  font-weight: 650;
  color: var(--vp-c-text-1);
}
.creator-link:hover strong {
  color: var(--flare-accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}
.project-credit-details {
  font-size: 12px;
  line-height: 1.8;
  color: var(--vp-c-text-2);
}
.project-credit-details a {
  text-decoration: underline;
  text-underline-offset: 3px;
}
.project-credit-details a:hover {
  color: var(--flare-accent);
}
@media (min-width: 960px) {
  .project-credit.has-sidebar {
    margin-left: var(--vp-sidebar-width);
  }
}
@media (min-width: 1440px) {
  .project-credit.has-sidebar {
    margin-left: max(
      var(--vp-sidebar-width),
      calc((100vw - var(--vp-layout-max-width)) / 2 + var(--vp-sidebar-width))
    );
  }
}
</style>
