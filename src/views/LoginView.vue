<script setup lang="ts">
import { Languages, LockKeyhole } from "lucide-vue-next";
import { reactive } from "vue";
import { useRouter } from "vue-router";
import { useBusinessTemplate } from "../businessTemplate";
import PersonalArchiveLogo from "../components/PersonalArchiveLogo.vue";
import { useI18n } from "../i18n";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const router = useRouter();
const { t, toggleLocale } = useI18n();
const { template } = useBusinessTemplate();

const form = reactive({
  email: "",
  password: ""
});

async function submit() {
  await auth.login(form.email, form.password);
  await router.push(auth.mustChangePassword ? "/change-password" : template.value.personalArchive ? "/documents" : "/dashboard");
}
</script>

<template>
  <main class="grid min-h-screen bg-ink-50 lg:grid-cols-[1.05fr_0.95fr]">
    <section class="flex min-h-screen flex-col justify-between bg-ink-900 px-8 py-8 text-white lg:px-14">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div v-if="template.personalArchive" class="personal-login-brand-mark grid h-14 w-14 place-items-center">
            <PersonalArchiveLogo class="h-14 w-14" />
          </div>
          <div v-else class="grid h-11 w-11 place-items-center rounded-md bg-accent-300 font-black text-ink-900">{{ template.productShortName }}</div>
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
        <p class="mb-4 text-sm font-semibold uppercase tracking-wide text-accent-200">Private workspace</p>
        <h1 class="max-w-3xl text-4xl font-semibold leading-tight md:text-6xl">
          {{ template.personalArchive ? "Personal records and reading, kept in one calm private space." : "Service records, customers, documents, and operations in one reliable workspace." }}
        </h1>
        <p class="mt-6 max-w-xl text-base leading-7 text-ink-200">
          {{ template.personalArchive
            ? "Organize important family files, read long-form material comfortably, and keep notes beside the source."
            : "Built for MD3 to manage communications service operations with secure document handling, structured records, and recovery support for day-to-day work." }}
        </p>
      </div>

      <div class="grid gap-4 border-t border-white/10 pt-6 text-sm text-ink-200 md:grid-cols-3">
        <div>
          <p class="text-2xl font-semibold text-white">Private</p>
          <p>Assigned account access</p>
        </div>
        <div>
          <p class="text-2xl font-semibold text-white">Files</p>
          <p>{{ template.personalArchive ? "Organized personal documents" : "Organized business documents" }}</p>
        </div>
        <div>
          <p class="text-2xl font-semibold text-white">Records</p>
          <p>{{ template.personalArchive ? "Notes and reading history" : "Recovery-aware workspace" }}</p>
        </div>
      </div>
    </section>

    <section class="flex min-h-screen items-center justify-center px-5 py-10">
      <form class="panel w-full max-w-md p-6" @submit.prevent="submit">
        <div class="mb-6 flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-md bg-accent-100 text-accent-800">
            <LockKeyhole class="h-5 w-5" />
          </div>
          <div>
            <h2 class="text-xl font-semibold text-ink-900">{{ t("login") }}</h2>
            <p class="text-sm text-ink-500">Use your assigned account credentials.</p>
          </div>
        </div>

        <label class="mb-4 block">
          <span class="mb-1 block text-sm font-semibold text-ink-700">{{ template.personalArchive ? "Username" : t("email") }}</span>
          <input
            v-model="form.email"
            class="input"
            :type="template.personalArchive ? 'text' : 'email'"
            autocomplete="username"
            autocapitalize="none"
            :placeholder="template.personalArchive ? 'Enter username' : 'name@example.com'"
            spellcheck="false"
          />
        </label>
        <label class="mb-5 block">
          <span class="mb-1 block text-sm font-semibold text-ink-700">{{ t("password") }}</span>
          <input v-model="form.password" class="input" type="password" autocomplete="current-password" placeholder="Enter password" />
        </label>

        <p v-if="auth.error" class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{{ auth.error }}</p>
        <button class="btn-primary w-full" :disabled="auth.loading">{{ auth.loading ? "Signing in..." : t("login") }}</button>
        <p v-if="template.personalArchive" class="mt-4 text-center text-xs text-ink-500">
          <a href="https://github.com/Alenwan/personal-archive" target="_blank" rel="noopener noreferrer" class="underline hover:text-ink-700">Source code (AGPL-3.0-only)</a>
        </p>
      </form>
    </section>
  </main>
</template>

<style scoped>
.personal-login-brand-mark {
  background: transparent;
}
</style>
