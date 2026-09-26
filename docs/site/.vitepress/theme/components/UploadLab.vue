<script setup>
import { computed, ref } from 'vue'
const account = 'PUBLIC'
const profile = ref('inherit')
const request = ref('inherit')
const bound = ref(false)
const expiry = ref('DAY')
const action = ref('DELETE')
const effective = computed(() =>
  bound.value
    ? profile.value === 'inherit'
      ? account
      : profile.value
    : request.value !== 'inherit'
      ? request.value
      : profile.value !== 'inherit'
        ? profile.value
        : account
)
const winner = computed(() =>
  !bound.value && request.value !== 'inherit'
    ? 'This upload'
    : profile.value !== 'inherit'
      ? 'Saved profile'
      : 'Starting default'
)
</script>

<template>
  <section class="interactive-panel" aria-label="Upload settings demonstration">
    <div class="panel-heading">
      <span class="eyebrow">TRY THE RULES</span
      ><span class="demo-badge">Local simulation</span>
    </div>
    <p>
      Change the inputs to see which visibility setting wins. Flare starts with
      public visibility; make a private profile your default to change your
      everyday uploads. Nothing is uploaded or saved here.
    </p>
    <div class="lab-grid">
      <div>
        <label for="lab-starting-visibility">1. Starting visibility</label
        ><select id="lab-starting-visibility" :value="account" disabled>
          <option value="PUBLIC">Public</option>
        </select>
      </div>
      <div>
        <label for="lab-saved-profile">2. Saved profile</label
        ><select id="lab-saved-profile" v-model="profile">
          <option value="inherit">Inherit starting visibility</option>
          <option value="PUBLIC">Public</option>
          <option value="PRIVATE">Private</option>
        </select>
      </div>
      <div>
        <label for="lab-upload-visibility">3. This upload</label
        ><select id="lab-upload-visibility" v-model="request" :disabled="bound">
          <option value="inherit">Use profile / defaults</option>
          <option value="PUBLIC">Public</option>
          <option value="PRIVATE">Private</option>
        </select>
      </div>
    </div>
    <label class="check-label"
      ><input v-model="bound" type="checkbox" /> Use a token bound to this
      profile</label
    >
    <p v-if="bound" class="lab-note">
      A bound token cannot override its profile’s options. An actual request
      that tries to change them is rejected.
    </p>
    <div class="lab-result" role="status">
      <span class="eyebrow">EFFECTIVE VISIBILITY · {{ winner }}</span
      ><strong>{{ effective === 'PUBLIC' ? 'Public' : 'Private' }}</strong>
      <p>
        {{
          effective === 'PUBLIC'
            ? 'People with the share URL can view the file unless it also has password protection.'
            : 'Only an eligible signed-in owner or an account with permission to read all content can access the file. A password does not make a private file accessible to other people.'
        }}
      </p>
    </div>
    <div class="lab-grid two">
      <div>
        <label for="lab-expiration">Expiration</label
        ><select id="lab-expiration" v-model="expiry">
          <option value="DISABLED">No expiration</option>
          <option value="HOUR">After an hour</option>
          <option value="DAY">After a day</option>
          <option value="WEEK">After a week</option>
          <option value="MONTH">After a month</option>
        </select>
      </div>
      <div>
        <label for="lab-expiry-action">When it expires</label
        ><select
          id="lab-expiry-action"
          v-model="action"
          :disabled="expiry === 'DISABLED'"
        >
          <option value="DELETE">Delete the file</option>
          <option value="SET_PRIVATE">Make it private</option>
        </select>
      </div>
    </div>
    <p class="lab-note" role="status">
      {{
        expiry === 'DISABLED'
          ? 'No expiration is scheduled.'
          : action === 'DELETE'
            ? 'When the expiration worker processes the deadline, the file is deleted. Keep a separate copy if you need it later.'
            : 'When the expiration worker processes the deadline, the file becomes private. It still uses storage. Existing passwords are not removed; previously issued S3 URLs can remain valid until their own expiry.'
      }}
    </p>
  </section>
</template>
