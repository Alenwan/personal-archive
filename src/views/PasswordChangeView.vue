<script setup lang="ts">
import { KeyRound, Languages, ShieldCheck } from "lucide-vue-next";
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "../i18n";
import { useAuthStore } from "../stores/auth";
import { useBusinessTemplate } from "../businessTemplate";

const auth = useAuthStore();
const { template } = useBusinessTemplate();
const router = useRouter();
const { toggleLocale, t } = useI18n();
const localError = ref("");

const form = reactive({
  currentPassword: "",
  newPassword: "",
  confirmPassword: ""
});

async function submit() {
  localError.value = "";
  if (form.newPassword !== form.confirmPassword) {
    localError.value = "New passwords do not match.";
    return;
  }
  if (form.newPassword.length < 10) {
    localError.value = "New password must be at least 10 characters.";
    return;
  }
  await auth.changePassword(form.currentPassword, form.newPassword, form.confirmPassword);
  await router.push(template.value.personalArchive ? "/documents" : "/dashboard");
}
</script>

<template>
  <main class="grid min-h-screen bg-ink-50 lg:grid-cols-[1.05fr_0.95fr]">
    <section class="flex min-h-screen flex-col justify-between bg-ink-900 px-8 py-8 text-white lg:px-14">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-md bg-accent-300 font-black text-ink-900">{{ template.productShortName }}</div>
          <div>
            <p class="font-semibold">{{ template.productName }}</p>
            <p class="text-xs text-ink-300">{{ template.productSubtitle }}</p>
          </div>
        </div>
        <button class="btn-secondary border-white/20 bg-white/10 px-3 text-white hover:bg-white/15" @click="toggleLocale">
          <Languages class="h-4 w-4" />
          {{ t("language") }}
        </button>
      </div>

      <div class="max-w-2xl py-14">
        <p class="mb-4 text-sm font-semibold uppercase tracking-wide text-accent-200">Account security</p>
        <h1 class="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
          Create a private password before entering the workspace.
        </h1>
        <p class="mt-6 max-w-xl text-base leading-7 text-ink-200">
          Temporary credentials are only used to verify the assigned account. Your new password replaces them immediately.
        </p>
      </div>

      <div class="grid gap-4 border-t border-white/10 pt-6 text-sm text-ink-200 md:grid-cols-3">
        <div>
          <p class="text-2xl font-semibold text-white">Private</p>
          <p>Only you know the new password</p>
        </div>
        <div>
          <p class="text-2xl font-semibold text-white">Secure</p>
          <p>Protected account session</p>
        </div>
        <div>
          <p class="text-2xl font-semibold text-white">Required</p>
          <p>Before workspace access</p>
        </div>
      </div>
    </section>

    <section class="flex min-h-screen items-center justify-center px-5 py-10">
      <form class="panel w-full max-w-md p-6" @submit.prevent="submit">
        <div class="mb-6 flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-md bg-accent-100 text-accent-800">
            <ShieldCheck class="h-5 w-5" />
          </div>
          <div>
            <h2 class="text-xl font-semibold text-ink-900">Change password</h2>
            <p class="text-sm text-ink-500">Set a private password for {{ auth.user?.name || "your account" }}.</p>
          </div>
        </div>

        <label class="mb-4 block">
          <span class="mb-1 block text-sm font-semibold text-ink-700">Current password</span>
          <input v-model="form.currentPassword" class="input" type="password" autocomplete="current-password" required />
        </label>
        <label class="mb-4 block">
          <span class="mb-1 block text-sm font-semibold text-ink-700">New password</span>
          <input v-model="form.newPassword" class="input" type="password" autocomplete="new-password" required />
        </label>
        <label class="mb-5 block">
          <span class="mb-1 block text-sm font-semibold text-ink-700">Confirm new password</span>
          <input v-model="form.confirmPassword" class="input" type="password" autocomplete="new-password" required />
        </label>

        <p v-if="localError || auth.error" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {{ localError || auth.error }}
        </p>
        <button class="btn-primary w-full" :disabled="auth.loading">
          <KeyRound class="h-4 w-4" />
          {{ auth.loading ? "Saving..." : "Save new password" }}
        </button>
      </form>
    </section>
  </main>
</template>
