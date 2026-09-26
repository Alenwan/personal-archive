<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { client } from "../../api/client";
import { useAuthStore } from "../../stores/auth";

const auth = useAuthStore();
const emit = defineEmits<{ change: [verifiedUntil: string | null] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const password = ref("");
const error = ref("");
const busy = ref(false);
const verifiedUntil = ref<string | null>(null);
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let requestVersion = 0;
const active = computed(() => Boolean(verifiedUntil.value));
function setExpiry(until: string | null) {
  clearTimeout(expiryTimer);
  verifiedUntil.value = until && Date.parse(until) > Date.now() ? until : null;
  emit("change", verifiedUntil.value);
  if (verifiedUntil.value) expiryTimer = setTimeout(() => { setExpiry(null); }, Math.max(0, Date.parse(verifiedUntil.value) - Date.now()));
}
async function open() {
  if (busy.value) return;
  const version = ++requestVersion;
  error.value = "";
  password.value = "";
  dialog.value?.showModal();
  const userId = auth.user?.userId;
  try {
    const state = await client.archiveManagementAccess();
    if (version === requestVersion && auth.user?.userId === userId) setExpiry(state.verifiedUntil);
  } catch (cause) {
    if (version === requestVersion) error.value = cause instanceof Error ? cause.message : "Unable to check management access.";
  }
}
async function verify() {
  if (busy.value) return;
  const version = ++requestVersion;
  busy.value = true;
  error.value = "";
  const userId = auth.user?.userId;
  const value = password.value;
  password.value = "";
  try {
    const state = await client.verifyArchiveManagementAccess(value);
    if (version === requestVersion && auth.user?.userId === userId) setExpiry(state.verifiedUntil);
  } catch (cause) {
    if (version === requestVersion) {
      setExpiry(null);
      error.value = cause instanceof Error ? cause.message : "Unable to verify password.";
    }
  } finally { if (version === requestVersion) busy.value = false; }
}
async function end() {
  const version = ++requestVersion;
  busy.value = true;
  error.value = "";
  try {
    await client.endArchiveManagementAccess();
    if (version === requestVersion) setExpiry(null);
  } catch (cause) {
    if (version === requestVersion) error.value = cause instanceof Error ? cause.message : "Unable to end management access.";
  } finally { if (version === requestVersion) busy.value = false; }
}
watch([() => auth.user?.userId, () => auth.sessionUncertain], () => {
  requestVersion++;
  busy.value = false;
  password.value = "";
  setExpiry(null);
  dialog.value?.close();
});
onBeforeUnmount(() => { requestVersion++; password.value = ""; setExpiry(null); });
</script>

<template>
  <button class="btn-secondary h-8 px-2.5 text-xs" type="button" @click="open">
    Manage shared content<span v-if="active" class="ml-1 text-amber-800"> · Active</span>
  </button>
  <dialog ref="dialog" class="panel w-[min(32rem,calc(100%-2rem))] p-6 backdrop:bg-ink-900/45" aria-labelledby="archive-management-title" @close="password = ''">
    <h2 id="archive-management-title" class="text-lg font-semibold">Manage shared content</h2>
    <p class="mt-2 text-sm text-ink-600">Verify your account password to manage files, folders, notes, Knowledge and writing belonging to other members, unresolved content, and shared classifications for up to five minutes. These actions are recorded.</p>
    <p class="mt-2 text-sm text-ink-600">This access applies to shared Archive management. Vault and writing encryption keep their own access rules.</p>
    <div v-if="active" class="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-sm" role="status">
      Management access is active until {{ new Date(verifiedUntil!).toLocaleTimeString() }}. Close this dialog to continue.
    </div>
    <form v-else class="mt-4 space-y-3" @submit.prevent="verify">
      <label class="block text-sm font-medium" for="archive-management-password">Current account password</label>
      <input id="archive-management-password" v-model="password" class="input w-full" type="password" autocomplete="current-password" required :disabled="busy" />
      <button class="btn-primary" type="submit" :disabled="busy || !password">{{ busy ? "Verifying…" : "Verify password" }}</button>
    </form>
    <p v-if="error" class="mt-3 text-sm text-red-700" role="alert">{{ error }}</p>
    <div class="mt-5 flex justify-end gap-2">
      <button v-if="active" class="btn-secondary" type="button" :disabled="busy" @click="end">End management access</button>
      <button class="btn-secondary" type="button" :disabled="busy" @click="dialog?.close()">Close</button>
    </div>
  </dialog>
</template>
