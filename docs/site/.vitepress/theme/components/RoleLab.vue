<script setup>
import { computed, ref } from 'vue'
const everyoneUpload = ref(true)
const contributor = ref(false)
const administrator = ref(false)
const tokenScope = ref(true)
const mayUpload = computed(
  () => everyoneUpload.value || contributor.value || administrator.value
)
const source = computed(() =>
  administrator.value
    ? 'Administrator grants every permission.'
    : everyoneUpload.value && contributor.value
      ? 'Both Everyone and Contributors grant uploads.'
      : everyoneUpload.value
        ? 'Everyone grants uploads, even without an additional role.'
        : contributor.value
          ? 'Contributors restores the permission removed from Everyone.'
          : 'No role grants uploads.'
)
</script>

<template>
  <section
    class="interactive-panel"
    aria-label="Role permissions demonstration"
  >
    <div class="panel-heading">
      <span class="eyebrow">COMBINE ROLE PERMISSIONS</span>
      <span class="demo-badge">Local simulation</span>
    </div>
    <p>
      Model one account's upload permission. These controls are an educational
      simulation; they never read an account or change a real role.
    </p>
    <label class="check-label">
      <input v-model="everyoneUpload" type="checkbox" /> Everyone grants uploads
    </label>
    <label class="check-label">
      <input v-model="contributor" type="checkbox" /> Assign Contributors
      (grants uploads)
    </label>
    <label class="check-label">
      <input v-model="administrator" type="checkbox" /> Assign Admin (grants
      Administrator)
    </label>
    <label class="check-label">
      <input v-model="tokenScope" type="checkbox" /> Named token has
      files:upload scope
    </label>
    <div class="role-lab-result" role="status" aria-live="polite">
      <p>
        <strong
          >Dashboard upload: {{ mayUpload ? 'Allowed' : 'Denied' }}</strong
        >
      </p>
      <p>{{ source }}</p>
      <p>
        <strong
          >Named-token upload:
          {{ mayUpload && tokenScope ? 'Allowed' : 'Denied' }}</strong
        >
        — requires both the account permission and the token scope.
      </p>
    </div>
    <p class="lab-note">
      This models role and scope checks only. Real uploads also require a valid
      session or token, email eligibility, available storage, valid file
      content, and the instance's size limits. Administrator does not expand a
      token's scopes.
    </p>
  </section>
</template>
