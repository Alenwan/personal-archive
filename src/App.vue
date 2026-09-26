<script setup lang="ts">
import {
  Activity,
  BarChart3,
  BriefcaseBusiness,
  Archive,
  ChevronDown,
  ChevronRight,
  ContactRound,
  Copy,
  Building2,
  BookOpen,
  ExternalLink,
  FileText,
  Feather,
  HardDrive,
  KeyRound,
  Languages,
  LockKeyhole,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTopClose,
  Search,
  Settings,
  Tags,
  X
} from "lucide-vue-next";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { client } from "./api/client";
import { useBusinessTemplate, workItemPath } from "./businessTemplate";
import PbxCallerPopup from "./components/PbxCallerPopup.vue";
import IconTooltip from "./components/IconTooltip.vue";
import ArchiveAudioPlayer from "./components/media/ArchiveAudioPlayer.vue";
import PersonalArchiveLogo from "./components/PersonalArchiveLogo.vue";
import ToastStack from "./components/ToastStack.vue";
import { useI18n } from "./i18n";
import { useAuthStore } from "./stores/auth";
import { useArchiveAudioPlayerStore } from "./stores/archiveAudioPlayer";
import { useToastStore } from "./stores/toasts";
import type { SearchCredentialMatch, SearchQuickValue, SearchResult } from "./shared/types";
import { useUiPreferences } from "./uiPreferences";
import { usePersonalNavigationVisibility } from "./composables/usePersonalNavigationVisibility";
import { useReadingPreferences } from "./readingPreferences";

const auth = useAuthStore();
const archiveAudio = useArchiveAudioPlayerStore();
const toasts = useToastStore();
const route = useRoute();
const router = useRouter();
const { t, toggleLocale } = useI18n();
const { template, labels } = useBusinessTemplate();
const { style: uiStyle, accent: uiAccent, palette: uiPalette, density: uiDensity } = useUiPreferences();
const { navigationOpen } = usePersonalNavigationVisibility();
const { preferences: readingPreferences } = useReadingPreferences();
const search = ref("");
const searchResults = ref<SearchResult[]>([]);
const searching = ref(false);
const showGlobalSearch = ref(false);
const globalSearchInput = ref<HTMLInputElement | null>(null);
const globalSearchReturnFocus = ref<HTMLElement | null>(null);
const navigationHideButton = ref<HTMLButtonElement | null>(null);
const navigationRestoreButton = ref<HTMLButtonElement | null>(null);
const mobileNavigationHideButton = ref<HTMLButtonElement | null>(null);
const mobileNavigationRestoreButton = ref<HTMLButtonElement | null>(null);
const discussionAttentionCount = ref(0);
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let searchRequestId = 0;

const isAuthScreen = computed(() => route.meta.authScreen);
const desktopShellClass = computed(() => {
  if (!template.value.personalArchive) return "lg:pl-64";
  if (!navigationOpen.value) return "lg:pl-0";
  if (uiStyle.value === "editorial") return "lg:pl-[15.5rem]";
  if (uiStyle.value === "gallery") return "lg:pl-[14rem]";
  return "lg:pl-60";
});

const globalSearchClass = computed(() => {
  if (!template.value.personalArchive) return "lg:left-[17rem] lg:w-[min(42rem,calc(100vw-18.5rem))]";
  if (navigationOpen.value && uiStyle.value === "editorial") {
    return "lg:left-[16.5rem] lg:w-[min(42rem,calc(100vw-18rem))]";
  }
  if (navigationOpen.value && uiStyle.value === "gallery") {
    return "lg:left-[15rem] lg:w-[min(42rem,calc(100vw-16.5rem))]";
  }
  return navigationOpen.value
    ? "lg:left-[16rem] lg:w-[min(42rem,calc(100vw-17.5rem))]"
    : "lg:left-6 lg:w-[min(42rem,calc(100vw-3rem))]";
});

const archiveAudioPlayerClass = computed(() => {
  if (!navigationOpen.value) return "lg:left-3";
  if (uiStyle.value === "editorial") return "lg:left-[16.25rem]";
  if (uiStyle.value === "gallery") return "lg:left-[14.75rem]";
  return "lg:left-[15.75rem]";
});

const manuscriptAppearanceStyle = computed(() => {
  if (!template.value.personalArchive || route.name !== "manuscript-workspace") return undefined;
  return {
    "--manuscript-shell-surface": readingPreferences.backgroundColor,
    "--manuscript-shell-ink": readingPreferences.textColor,
    "--manuscript-shell-border": "color-mix(in srgb, var(--manuscript-shell-ink) 17%, var(--manuscript-shell-surface))",
    "--personal-surface": readingPreferences.backgroundColor,
    "--personal-text": readingPreferences.textColor,
    "--personal-border": "var(--manuscript-shell-border)"
  };
});

async function hidePersonalNavigation() {
  navigationOpen.value = false;
  await nextTick();
  if (window.matchMedia("(min-width: 1024px)").matches) navigationRestoreButton.value?.focus();
  else mobileNavigationRestoreButton.value?.focus();
}

async function showPersonalNavigation() {
  navigationOpen.value = true;
  await nextTick();
  if (window.matchMedia("(min-width: 1024px)").matches) navigationHideButton.value?.focus();
  else mobileNavigationHideButton.value?.focus();
}

const navItems = computed(() => {
  if (template.value.personalArchive) {
    const personalItems = [
      { label: t("archive"), to: "/documents", icon: FileText },
      { label: t("study"), to: "/reading-notes?view=all", icon: BookOpen, badge: discussionAttentionCount.value },
      { label: "Knowledge", to: "/knowledge", icon: FileText },
      { label: "Long writing", to: "/manuscripts", icon: Feather },
      { label: "Private vault", to: "/private-vault", icon: LockKeyhole }
    ];
    if (auth.canManageSettings) personalItems.push({ label: "System status", to: "/system-status", icon: Activity });
    if (auth.canManageBackups) personalItems.push({ label: t("backups"), to: "/backups", icon: Archive });
    if (auth.canManageSettings) personalItems.push({ label: t("settings"), to: "/settings", icon: Settings });
    return personalItems;
  }
  const items = [
    { label: t("dashboard"), to: "/dashboard", icon: BarChart3 },
    { label: labels.value.plural, to: workItemPath(), icon: BriefcaseBusiness },
    { label: t("contacts"), to: "/contacts", icon: ContactRound },
    { label: t("organizations"), to: "/organizations", icon: Building2 },
    { label: t("communications"), to: "/communications", icon: MessageSquare },
    { label: t("discussions"), to: "/discussions?view=my-attention", icon: MessageSquare, badge: discussionAttentionCount.value },
    { label: t("assets"), to: "/managed-assets", icon: HardDrive },
    { label: t("knowledge"), to: "/knowledge", icon: BookOpen },
    { label: t("documents"), to: "/documents", icon: FileText }
  ];
  if (auth.canManageBackups) items.push({ label: t("backups"), to: "/backups", icon: Archive });
  if (auth.canManageSettings) {
    items.push({ label: t("tags"), to: "/tags", icon: Tags });
    items.push({ label: t("settings"), to: "/settings", icon: Settings });
  }
  return items;
});

watch(search, async (value) => {
  if (searchTimer) clearTimeout(searchTimer);
  if (!auth.isAuthenticated || value.trim().length < 2) {
    searchResults.value = [];
    searching.value = false;
    return;
  }
  const q = value.trim();
  const requestId = ++searchRequestId;
  searching.value = true;
  searchTimer = setTimeout(async () => {
    try {
      const results = await client.search(q);
      if (requestId === searchRequestId) searchResults.value = results;
    } finally {
      if (requestId === searchRequestId) searching.value = false;
    }
  }, 250);
});

async function loadDiscussionAttentionCount() {
  if (!auth.isAuthenticated || isAuthScreen.value) {
    discussionAttentionCount.value = 0;
    return;
  }
  try {
    const summary = await client.discussionSummary();
    discussionAttentionCount.value = summary.myAttention;
  } catch {
    discussionAttentionCount.value = 0;
  }
}

watch(
  () => [auth.isAuthenticated, route.fullPath],
  () => {
    void loadDiscussionAttentionCount();
  },
  { immediate: true }
);

// Another tab can change the shared cookie without invoking this tab's logout.
// Stop audio and discard queued file names until the account is verified again.
watch(
  () => [auth.user?.userId ?? null, auth.sessionUncertain] as const,
  ([userId, uncertain], [previousUserId]) => {
    if (uncertain || !userId || (previousUserId && previousUserId !== userId)) {
      archiveAudio.closePlayer();
    }
  }
);

onBeforeUnmount(() => {
  if (searchTimer) clearTimeout(searchTimer);
  window.removeEventListener("keydown", onGlobalKeydown);
});

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown);
});

async function logout() {
  closeGlobalSearch();
  archiveAudio.closePlayer();
  await auth.logout();
  await router.push("/login");
}

async function openGlobalSearch() {
  if (!showGlobalSearch.value && document.activeElement instanceof HTMLElement) {
    globalSearchReturnFocus.value = document.activeElement;
  }
  showGlobalSearch.value = true;
  await nextTick();
  globalSearchInput.value?.focus();
}

async function hideGlobalSearch(reset: boolean) {
  showGlobalSearch.value = false;
  if (reset) {
    search.value = "";
    searchResults.value = [];
    searching.value = false;
    searchRequestId += 1;
    if (searchTimer) clearTimeout(searchTimer);
  }
  await nextTick();
  globalSearchReturnFocus.value?.focus();
}

function closeGlobalSearch() {
  void hideGlobalSearch(true);
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (event.repeat || !auth.isAuthenticated || isAuthScreen.value) return;
    if (showGlobalSearch.value) void hideGlobalSearch(false);
    else void openGlobalSearch();
  } else if (event.key === "Escape" && showGlobalSearch.value) {
    closeGlobalSearch();
  }
}

function openResult(result: SearchResult) {
  closeGlobalSearch();
  if (result.type === "case") router.push(workItemPath(result.id));
  if (result.type === "contact") router.push(`/contacts/${result.id}`);
  if (result.type === "organization") router.push(`/organizations/${result.id}`);
  if (result.type === "asset") router.push(`/managed-assets/${result.id}`);
  if (result.type === "knowledge") router.push(`/knowledge/${result.id}`);
  if (result.type === "manuscript") router.push(`/manuscripts/${result.id}`);
  if (result.type === "document") {
    router.push(
      result.caseId
        ? workItemPath(result.caseId, `tab=documents&documentId=${result.id}`)
        : `/documents?documentId=${result.id}`
    );
  }
}

function resultOpenLabel(result: SearchResult): string {
  const labels: Record<SearchResult["type"], string> = {
    case: "Open Service",
    contact: "Open Contact profile",
    document: "Open Document",
    organization: "Open Organization profile",
    asset: "Open Asset profile",
    knowledge: "Open Knowledge record",
    manuscript: "Open long-form work"
  };
  return labels[result.type];
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back below when the current browser blocks the Clipboard API.
    }
  }

  const textArea = document.createElement("textarea");
  textArea.value = value;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

async function copySearchValue(resultTitle: string, label: string, value: string) {
  const copied = await copyTextToClipboard(value);
  if (copied) {
    toasts.success(`${label} copied`, `${resultTitle}: ${value}`);
  } else {
    toasts.error("Clipboard blocked", `Select the ${label} value and copy it manually.`);
  }
}

async function copyQuickValue(result: SearchResult, quickValue: SearchQuickValue) {
  await copySearchValue(result.title, quickValue.label, quickValue.value);
}

async function copyCredentialValue(result: SearchResult, label: string, value: string) {
  await copySearchValue(result.title, label, value);
}

function openCredentialResult(result: SearchResult, credential: SearchCredentialMatch) {
  closeGlobalSearch();
  void router.push({
    path: `/managed-assets/${result.id}`,
    query: { credentialId: credential.credentialId },
    hash: "#credentials"
  });
}
</script>

<template>
  <ToastStack />
  <PbxCallerPopup v-if="auth.isAuthenticated && !isAuthScreen && !template.personalArchive" />
  <RouterView v-if="isAuthScreen" />
  <div
    v-else
    class="min-h-screen bg-ink-50 text-ink-900"
    :class="[
      template.personalArchive ? 'personal-shell' : '',
      template.personalArchive && route.name === 'manuscript-workspace' ? 'manuscript-shell' : ''
    ]"
    :data-ui-theme="template.personalArchive ? uiStyle : undefined"
    :data-ui-style="template.personalArchive ? uiStyle : undefined"
    :data-ui-accent="template.personalArchive ? uiAccent : undefined"
    :data-ui-palette="template.personalArchive ? uiPalette : undefined"
    :data-ui-density="template.personalArchive ? uiDensity : undefined"
    :style="manuscriptAppearanceStyle"
  >
    <aside
      v-if="!template.personalArchive || navigationOpen"
      class="fixed inset-y-0 left-0 z-30 hidden flex-col border-r lg:flex"
      :class="template.personalArchive ? 'personal-sidebar w-60 px-3 py-4' : 'w-64 border-ink-200 bg-ink-900 px-4 py-5 text-white'"
    >
      <template v-if="template.personalArchive">
        <div class="personal-brand flex items-center gap-2.5 px-1.5 py-1">
          <div class="personal-brand-mark grid h-14 w-14 shrink-0 place-items-center">
            <PersonalArchiveLogo class="h-14 w-14" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="personal-brand-name text-[15px] font-bold leading-tight">{{ template.productName }}</p>
          </div>
          <button
            ref="navigationHideButton"
            class="personal-navigation-toggle"
            type="button"
            title="Hide main navigation"
            aria-label="Hide main navigation"
            :aria-expanded="true"
            @click="hidePersonalNavigation"
          >
            <PanelLeftClose />
          </button>
        </div>
        <button
          class="personal-search-trigger mt-4 flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium transition"
          type="button"
          :title="labels.searchPlaceholder"
          aria-label="Open global search"
          :aria-expanded="showGlobalSearch"
          @click="openGlobalSearch"
        >
          <Search class="h-4 w-4" />
          <span class="min-w-0 flex-1 truncate">Search archive</span>
          <span class="personal-keycap rounded-md px-1.5 py-0.5 text-[10px] font-bold">Ctrl K</span>
        </button>
      </template>
      <div v-else class="flex items-center gap-3 px-2">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-accent-400 text-sm font-black text-ink-900">{{ template.productShortName }}</div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-semibold">{{ template.productName }}</p>
          <p class="truncate text-[11px] text-ink-300">{{ template.productSubtitle }}</p>
        </div>
        <button class="grid h-9 w-9 shrink-0 place-items-center rounded-md text-ink-300 transition hover:bg-white/10 hover:text-white" type="button" :title="labels.searchPlaceholder" aria-label="Open global search" :aria-expanded="showGlobalSearch" @click="openGlobalSearch">
          <Search class="h-4 w-4" />
        </button>
      </div>
      <nav :class="template.personalArchive ? 'mt-4' : 'mt-6'" class="min-h-0 flex-1 space-y-1 overflow-y-auto py-1">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="flex items-center gap-3 px-3 py-2 text-sm transition"
          :class="template.personalArchive ? 'personal-nav-link rounded-xl font-semibold' : 'rounded-md text-ink-200 hover:bg-white/10 hover:text-white'"
          :active-class="template.personalArchive ? 'personal-nav-link-active' : 'bg-white text-ink-900 hover:bg-white hover:text-ink-900'"
        >
          <component :is="item.icon" class="h-4 w-4" />
          <span class="min-w-0 flex-1">{{ item.label }}</span>
          <span
            v-if="'badge' in item && item.badge"
            class="ml-auto rounded-full bg-accent-400 px-2 py-0.5 text-xs font-bold text-ink-900"
          >
            {{ item.badge }}
          </span>
        </RouterLink>
      </nav>
      <div class="mt-4 shrink-0 rounded-md border border-white/10" :class="template.personalArchive ? 'personal-account' : ''">
        <div class="min-w-0 px-3 py-2.5">
          <p class="truncate text-sm font-semibold">{{ auth.user?.name }}</p>
          <p class="truncate text-xs text-ink-300">{{ auth.user?.role }}</p>
        </div>
        <div class="grid grid-cols-2 border-t border-white/10">
          <button
            class="flex h-9 min-w-0 items-center justify-center gap-2 border-r border-white/10 px-2 text-xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
            type="button"
            :title="t('language')"
            @click="toggleLocale"
          >
            <Languages class="h-4 w-4 shrink-0" />
            <span class="truncate">{{ t("language") }}</span>
          </button>
          <button
            class="flex h-9 min-w-0 items-center justify-center gap-2 px-2 text-xs font-semibold text-ink-300 transition hover:bg-white/10 hover:text-white"
            type="button"
            :title="t('logout')"
            @click="logout"
          >
            <LogOut class="h-4 w-4 shrink-0" />
            <span class="truncate">{{ t("logout") }}</span>
          </button>
        </div>
      </div>
    </aside>

    <button
      v-if="template.personalArchive && !navigationOpen"
      ref="navigationRestoreButton"
      class="personal-navigation-restore hidden lg:flex"
      type="button"
      title="Show main navigation"
      aria-label="Show main navigation"
      :aria-expanded="false"
      @click="showPersonalNavigation"
    >
      <PanelLeftOpen />
      <span>Menu</span>
    </button>

    <Transition name="personal-navigation-tab">
      <button
        v-if="template.personalArchive && !navigationOpen"
        ref="mobileNavigationRestoreButton"
        class="personal-mobile-navigation-restore lg:hidden"
        type="button"
        title="Show main navigation"
        aria-label="Show main navigation"
        :aria-expanded="false"
        aria-controls="personal-primary-navigation-mobile"
        @click="showPersonalNavigation"
      >
        <span>Menu</span>
        <ChevronDown />
      </button>
    </Transition>

    <div
      v-if="showGlobalSearch"
      class="fixed inset-0 z-50 bg-ink-900/25"
      role="presentation"
      @mousedown.self="closeGlobalSearch"
    >
      <section
        class="fixed left-3 right-3 top-3 overflow-hidden rounded-md border border-ink-200 bg-white shadow-soft sm:left-6 sm:right-6 sm:top-5 lg:right-auto"
        :class="globalSearchClass"
        role="dialog"
        aria-modal="true"
        aria-label="Global search"
      >
        <div class="flex items-center gap-2 border-b border-ink-100 px-3 py-2.5">
          <Search class="h-5 w-5 shrink-0 text-ink-400" />
          <input
            ref="globalSearchInput"
            v-model="search"
            class="min-w-0 flex-1 border-0 bg-transparent px-1 py-2 text-base text-ink-900 outline-none placeholder:text-ink-400"
            :placeholder="labels.searchPlaceholder"
            @keydown.enter.prevent="searchResults[0] && openResult(searchResults[0])"
          />
          <button
            class="grid h-8 w-8 shrink-0 place-items-center rounded-md text-ink-500 transition hover:bg-ink-50 hover:text-ink-900"
            type="button"
            title="Close search"
            @click="closeGlobalSearch"
          >
            <X class="h-4 w-4" />
          </button>
        </div>
        <div v-if="searchResults.length || searching || search.trim().length >= 2" class="max-h-[min(32rem,70vh)] overflow-y-auto">
          <div
            v-for="result in searchResults"
            :key="`${result.type}-${result.id}`"
            class="border-b border-ink-100 last:border-b-0"
          >
            <button
              class="flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition hover:bg-ink-50"
              type="button"
              @click="openResult(result)"
            >
              <span class="min-w-0 flex-1">
                <span class="block truncate font-semibold text-ink-900">{{ result.title }}</span>
                <span class="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-ink-500">
                  <span class="min-w-0 truncate">{{ result.subtitle }} · {{ result.meta }}</span>
                  <span
                    v-if="result.matchReason"
                    class="shrink-0 rounded-full bg-accent-50 px-2 py-0.5 text-[11px] font-semibold text-accent-900"
                  >
                    Matched {{ result.matchReason }}
                  </span>
                </span>
              </span>
              <IconTooltip :text="resultOpenLabel(result)">
                <ChevronRight class="h-4 w-4 shrink-0 text-ink-400" />
              </IconTooltip>
            </button>
            <div v-if="result.quickValues?.length" class="flex flex-wrap gap-2 px-4 pb-3">
              <div
                v-for="quickValue in result.quickValues"
                :key="`${result.id}-${quickValue.label}`"
                class="flex h-9 max-w-full items-stretch overflow-hidden rounded-md border border-ink-200 bg-ink-50 transition hover:border-accent-300"
              >
                <button
                  class="flex min-w-0 items-center gap-2 px-2.5 text-left hover:bg-accent-50"
                  type="button"
                  :title="`Copy ${quickValue.label}`"
                  :aria-label="`Copy ${quickValue.label} ${quickValue.value}`"
                  @click="copyQuickValue(result, quickValue)"
                >
                  <span class="shrink-0 text-[11px] font-semibold uppercase text-ink-500">{{ quickValue.label }}</span>
                  <span class="min-w-0 truncate font-mono text-xs font-semibold text-ink-900">{{ quickValue.value }}</span>
                  <Copy class="h-3.5 w-3.5 shrink-0 text-accent-800" />
                </button>
                <IconTooltip
                  v-if="quickValue.kind === 'url' && safeHttpUrl(quickValue.value)"
                  text="Open Web UI in a new tab"
                >
                  <a
                    class="grid h-9 w-9 shrink-0 place-items-center border-l border-ink-200 text-accent-800 hover:bg-accent-50"
                    :href="safeHttpUrl(quickValue.value) ?? undefined"
                    target="_blank"
                    rel="noopener noreferrer"
                    :aria-label="`Open ${quickValue.label} ${quickValue.value} in a new tab`"
                  >
                    <ExternalLink class="h-3.5 w-3.5" />
                  </a>
                </IconTooltip>
              </div>
            </div>
            <div v-if="result.credentialMatches?.length" class="px-4 pb-3">
              <div class="border-t border-ink-100 pt-2">
                <p class="text-[11px] font-semibold uppercase text-ink-500">Matched access</p>
                <div
                  v-for="credential in result.credentialMatches"
                  :key="credential.credentialId"
                  class="flex flex-wrap items-center gap-2 py-2"
                >
                  <KeyRound class="h-4 w-4 shrink-0 text-accent-800" />
                  <div class="mr-auto min-w-[9rem] flex-1">
                    <p class="truncate text-xs font-semibold text-ink-900">{{ credential.label }}</p>
                    <p class="truncate text-[11px] text-ink-500">{{ credential.credentialType }}</p>
                  </div>
                  <button
                    v-if="credential.host"
                    class="flex h-8 min-w-0 max-w-[15rem] items-center gap-1.5 rounded-md border border-ink-200 bg-white px-2 text-left hover:bg-ink-50"
                    type="button"
                    :title="`Copy host ${credential.host}`"
                    :aria-label="`Copy host ${credential.host}`"
                    @click="copyCredentialValue(result, 'Host', credential.host)"
                  >
                    <span class="truncate font-mono text-[11px] font-semibold text-ink-800">{{ credential.host }}</span>
                    <Copy class="h-3.5 w-3.5 shrink-0 text-accent-800" />
                  </button>
                  <div
                    v-if="credential.loginUrl"
                    class="flex h-8 min-w-0 max-w-[17rem] items-stretch overflow-hidden rounded-md border border-ink-200 bg-white"
                  >
                    <button
                      class="flex min-w-0 items-center gap-1.5 px-2 text-left hover:bg-ink-50"
                      type="button"
                      :title="`Copy Web UI ${credential.loginUrl}`"
                      :aria-label="`Copy Web UI ${credential.loginUrl}`"
                      @click="copyCredentialValue(result, 'Web UI', credential.loginUrl)"
                    >
                      <span class="truncate font-mono text-[11px] font-semibold text-ink-800">{{ credential.loginUrl }}</span>
                      <Copy class="h-3.5 w-3.5 shrink-0 text-accent-800" />
                    </button>
                    <IconTooltip v-if="safeHttpUrl(credential.loginUrl)" text="Open Web UI in a new tab">
                      <a
                        class="grid h-8 w-8 shrink-0 place-items-center border-l border-ink-200 text-accent-800 hover:bg-accent-50"
                        :href="safeHttpUrl(credential.loginUrl) ?? undefined"
                        target="_blank"
                        rel="noopener noreferrer"
                        :aria-label="`Open Web UI ${credential.loginUrl} in a new tab`"
                      >
                        <ExternalLink class="h-3.5 w-3.5" />
                      </a>
                    </IconTooltip>
                  </div>
                  <IconTooltip text="View Credential in Asset profile">
                    <button
                      class="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-ink-200 text-accent-800 hover:bg-accent-50"
                      type="button"
                      :aria-label="`View credential ${credential.label} in Asset profile`"
                      @click="openCredentialResult(result, credential)"
                    >
                      <ChevronRight class="h-3.5 w-3.5" />
                    </button>
                  </IconTooltip>
                </div>
                <p
                  v-if="(result.credentialMatchCount ?? 0) > result.credentialMatches.length"
                  class="pb-1 text-[11px] text-ink-500"
                >
                  +{{ (result.credentialMatchCount ?? 0) - result.credentialMatches.length }} more access matches
                </p>
              </div>
            </div>
          </div>
          <p v-if="searching" class="px-4 py-3 text-sm text-ink-500">Searching...</p>
          <p v-else-if="!searchResults.length" class="px-4 py-3 text-sm text-ink-500">No matching records.</p>
        </div>
      </section>
    </div>

    <div class="desktop-shell-content" :class="desktopShellClass">
      <Transition name="personal-mobile-navigation">
        <header
          v-if="!template.personalArchive || navigationOpen"
          id="personal-primary-navigation-mobile"
          class="sticky top-0 z-20 border-b border-ink-200 bg-ink-50/95 backdrop-blur lg:hidden"
          :class="template.personalArchive ? 'personal-mobile-header' : ''"
        >
          <div class="flex h-12 items-center gap-2 px-3 sm:px-4">
            <div v-if="template.personalArchive" class="personal-brand-mark grid h-10 w-10 shrink-0 place-items-center">
              <PersonalArchiveLogo class="h-10 w-10" />
            </div>
            <div v-else class="grid h-8 w-8 place-items-center rounded-md bg-accent-400 text-xs font-black text-ink-900">{{ template.productShortName }}</div>
            <span class="min-w-0 flex-1 truncate text-sm font-semibold">{{ template.productName }}</span>
            <button class="personal-mobile-action grid h-9 w-9 place-items-center rounded-md text-ink-600 hover:bg-white" type="button" :title="labels.searchPlaceholder" aria-label="Open global search" @click="openGlobalSearch">
              <Search class="h-4 w-4" />
            </button>
            <button class="personal-mobile-action grid h-9 w-9 place-items-center rounded-md text-ink-600 hover:bg-white" type="button" :title="t('language')" :aria-label="t('language')" @click="toggleLocale">
              <Languages class="h-4 w-4" />
            </button>
            <button class="personal-mobile-action grid h-9 w-9 place-items-center rounded-md text-ink-600 hover:bg-white" type="button" :title="t('logout')" :aria-label="t('logout')" @click="logout">
              <LogOut class="h-4 w-4" />
            </button>
          </div>
          <nav class="flex gap-1 overflow-x-auto px-3 pb-2 sm:px-4">
            <RouterLink
              v-for="item in navItems"
              :key="item.to"
              :to="item.to"
              class="personal-mobile-nav-link inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-ink-600"
              active-class="personal-mobile-nav-link-active bg-white text-ink-900 shadow-sm"
            >
              <component :is="item.icon" class="h-4 w-4" />
              <span>{{ item.label }}</span>
              <span
                v-if="'badge' in item && item.badge"
                class="rounded-full bg-accent-100 px-1.5 py-0.5 text-[11px] font-bold text-accent-950"
              >
                {{ item.badge }}
              </span>
            </RouterLink>
          </nav>
          <button
            v-if="template.personalArchive"
            ref="mobileNavigationHideButton"
            class="personal-mobile-navigation-hide"
            type="button"
            title="Hide main navigation"
            aria-label="Hide main navigation"
            :aria-expanded="true"
            aria-controls="personal-primary-navigation-mobile"
            @click="hidePersonalNavigation"
          >
            <PanelTopClose />
          </button>
        </header>
      </Transition>
      <main
        class="px-4 py-4 sm:px-5 lg:px-6 lg:pt-5"
        :class="[
          template.personalArchive ? 'personal-main' : '',
          template.personalArchive && !navigationOpen ? 'personal-main--navigation-collapsed' : '',
          route.name === 'manuscript-workspace' ? 'manuscript-main' : '',
          archiveAudio.visible ? '!pb-56 sm:!pb-40 lg:!pb-32' : ''
        ]"
      >
        <RouterView />
      </main>
    </div>
    <ArchiveAudioPlayer
      v-if="template.personalArchive && auth.isAuthenticated"
      :class="archiveAudioPlayerClass"
    />
  </div>
</template>
