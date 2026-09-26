<script setup lang="ts">
import { Check, Copy, Database, KeyRound, ListChecks, Palette, PhoneCall, Plus, Rows3, Save, ShieldCheck, Trash2, X } from "lucide-vue-next";
import { computed, onMounted, reactive, ref } from "vue";
import { client } from "../api/client";
import { filterCaseTypeTemplates, useBusinessTemplate } from "../businessTemplate";
import PageHeader from "../components/PageHeader.vue";
import { useI18n } from "../i18n";
import { formatDateTime } from "../shared/format";
import { useAuthStore } from "../stores/auth";
import { PERSONAL_UI_ACCENTS, PERSONAL_UI_PALETTES, PERSONAL_UI_STYLES, useUiPreferences } from "../uiPreferences";
import type { AuditLog, CaseTypeTemplate, GmailExtensionToken, PbxSettings, PbxSettingsInput } from "../shared/types";

const { t } = useI18n();
const { template, labels } = useBusinessTemplate();
const auth = useAuthStore();
const { style: uiStyle, accent: uiAccent, palette: uiPalette, density: uiDensity } = useUiPreferences();
const auditLogs = ref<AuditLog[]>([]);
const caseTypes = ref<CaseTypeTemplate[]>([]);
const gmailExtensionTokens = ref<GmailExtensionToken[]>([]);
const auditError = ref("");
const workflowError = ref("");
const pbxError = ref("");
const pbxMessage = ref("");
const gmailTokenError = ref("");
const gmailTokenMessage = ref("");
const newGmailToken = ref("");
const creatingGmailToken = ref(false);
const isGmailTokenFormOpen = ref(false);
const revokingGmailTokenId = ref("");
const savingPbxSettings = ref(false);
const visibleCaseTypes = computed(() => filterCaseTypeTemplates(template.value, caseTypes.value));
const canEditSettings = computed(() => auth.canMutate && auth.user?.role === "Admin");

const pbxForm = reactive({
  isEnabled: false,
  allowedDidsText: "",
  allowedDestinationsText: "",
  ignoredDidsText: "",
  ignoredDestinationsText: "",
  showUnknownCallers: true,
  popupRetentionSeconds: 30
});
const gmailTokenForm = reactive({
  name: ""
});

function listToText(values: string[]) {
  return values.join("\n");
}

function textToList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function applyPbxSettings(settings: PbxSettings) {
  Object.assign(pbxForm, {
    isEnabled: settings.isEnabled,
    allowedDidsText: listToText(settings.allowedDids),
    allowedDestinationsText: listToText(settings.allowedDestinations),
    ignoredDidsText: listToText(settings.ignoredDids),
    ignoredDestinationsText: listToText(settings.ignoredDestinations),
    showUnknownCallers: settings.showUnknownCallers,
    popupRetentionSeconds: settings.popupRetentionSeconds
  });
}

function pbxPayload(): PbxSettingsInput {
  return {
    isEnabled: pbxForm.isEnabled,
    allowedDids: textToList(pbxForm.allowedDidsText),
    allowedDestinations: textToList(pbxForm.allowedDestinationsText),
    ignoredDids: textToList(pbxForm.ignoredDidsText),
    ignoredDestinations: textToList(pbxForm.ignoredDestinationsText),
    showUnknownCallers: pbxForm.showUnknownCallers,
    popupRetentionSeconds: Number(pbxForm.popupRetentionSeconds) || 30
  };
}

async function savePbxSettings() {
  if (!canEditSettings.value || savingPbxSettings.value) return;
  savingPbxSettings.value = true;
  pbxError.value = "";
  pbxMessage.value = "";
  try {
    const settings = await client.updatePbxSettings(pbxPayload());
    applyPbxSettings(settings);
    pbxMessage.value = "PBX caller popup settings saved.";
  } catch (error) {
    pbxError.value = error instanceof Error ? error.message : "Unable to save PBX settings";
  } finally {
    savingPbxSettings.value = false;
  }
}

async function loadGmailExtensionTokens() {
  if (!canEditSettings.value) return;
  try {
    gmailExtensionTokens.value = await client.gmailExtensionTokens();
  } catch (error) {
    gmailTokenError.value = error instanceof Error ? error.message : "Gmail extension tokens unavailable";
  }
}

async function createGmailToken() {
  if (!canEditSettings.value || creatingGmailToken.value) return;
  const tokenName = gmailTokenForm.name.trim();
  if (!tokenName) {
    gmailTokenError.value = "Enter a token name so it is easy to identify later.";
    return;
  }
  creatingGmailToken.value = true;
  gmailTokenError.value = "";
  gmailTokenMessage.value = "";
  newGmailToken.value = "";
  try {
    const result = await client.createGmailExtensionToken({ name: tokenName });
    newGmailToken.value = result.token;
    gmailTokenMessage.value = "Token created. Copy it into the Chrome extension now; it will not be shown again.";
    gmailTokenForm.name = "";
    isGmailTokenFormOpen.value = false;
    await loadGmailExtensionTokens();
  } catch (error) {
    gmailTokenError.value = error instanceof Error ? error.message : "Unable to create Gmail extension token";
  } finally {
    creatingGmailToken.value = false;
  }
}

function openGmailTokenForm() {
  if (!canEditSettings.value) return;
  gmailTokenError.value = "";
  gmailTokenMessage.value = "";
  isGmailTokenFormOpen.value = true;
}

function cancelGmailTokenForm() {
  if (creatingGmailToken.value) return;
  gmailTokenForm.name = "";
  gmailTokenError.value = "";
  isGmailTokenFormOpen.value = false;
}

async function copyNewGmailToken() {
  if (!newGmailToken.value) return;
  const copied = await copyTextToClipboard(newGmailToken.value);
  if (copied) {
    gmailTokenMessage.value = "Token copied. Paste it into the Chrome extension settings now.";
    gmailTokenError.value = "";
  } else {
    gmailTokenError.value = "Unable to copy automatically. Select the token text and copy it manually.";
  }
}

async function copyTextToClipboard(value: string): Promise<boolean> {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // Fall back for browsers that expose the API but block this origin.
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
  textArea.setSelectionRange(0, textArea.value.length);
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textArea);
  }
}

async function revokeGmailToken(token: GmailExtensionToken) {
  if (!canEditSettings.value || token.revokedAt || revokingGmailTokenId.value) return;
  const confirmed = window.confirm(`Revoke Gmail extension token "${token.name}"? The Chrome extension using it will stop connecting.`);
  if (!confirmed) return;
  revokingGmailTokenId.value = token.tokenId;
  gmailTokenError.value = "";
  gmailTokenMessage.value = "";
  try {
    await client.revokeGmailExtensionToken(token.tokenId);
    gmailTokenMessage.value = "Token revoked.";
    await loadGmailExtensionTokens();
  } catch (error) {
    gmailTokenError.value = error instanceof Error ? error.message : "Unable to revoke Gmail extension token";
  } finally {
    revokingGmailTokenId.value = "";
  }
}

onMounted(async () => {
  if (template.value.personalArchive) {
    try {
      auditLogs.value = await client.auditLogs();
    } catch (error) {
      auditError.value = error instanceof Error ? error.message : "Activity data unavailable";
    }
    return;
  }

  try {
    caseTypes.value = await client.caseTypes();
  } catch (error) {
    workflowError.value = error instanceof Error ? error.message : "Workflow template data unavailable";
  }

  try {
    applyPbxSettings(await client.pbxSettings());
  } catch (error) {
    pbxError.value = error instanceof Error ? error.message : "PBX settings unavailable";
  }

  await loadGmailExtensionTokens();

  try {
    auditLogs.value = await client.auditLogs();
  } catch (error) {
    auditError.value = error instanceof Error ? error.message : "Audit log data unavailable";
  }
});
</script>

<template>
  <template v-if="template.personalArchive">
    <PageHeader
      class="personal-settings-header"
      eyebrow="Your space, your way"
      :title="t('settings')"
      description="Choose how your archive feels and how much information fits on screen. Changes are saved in this browser immediately."
    />

    <section class="personal-settings-grid grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
      <div class="space-y-3">
        <div class="panel personal-settings-panel overflow-hidden">
          <div class="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
            <span class="settings-icon settings-icon-coral"><Palette class="h-5 w-5" /></span>
            <div>
              <h2 class="font-bold">Interface style</h2>
              <p class="mt-0.5 text-sm text-ink-500">Change the navigation, typography, panels and overall rhythm of your archive.</p>
            </div>
          </div>
          <div class="grid gap-3 p-4 sm:grid-cols-2">
            <button
              v-for="option in PERSONAL_UI_STYLES"
              :key="option.id"
              class="theme-choice text-left"
              :class="uiStyle === option.id ? 'theme-choice-active' : ''"
              type="button"
              :aria-pressed="uiStyle === option.id"
              @click="uiStyle = option.id"
            >
              <span class="theme-preview" :class="`theme-preview-${option.id}`">
                <span class="theme-preview-rail">
                  <i class="theme-preview-logo" />
                  <i class="theme-preview-nav" />
                  <i class="theme-preview-nav" />
                  <i class="theme-preview-nav" />
                </span>
                <span class="theme-preview-page">
                  <i class="theme-preview-title" />
                  <span class="theme-preview-panels"><i /><i /></span>
                  <i class="theme-preview-line" />
                </span>
              </span>
              <span class="mt-3 flex items-start justify-between gap-2">
                <span><strong class="block">{{ option.name }}</strong><small class="mt-0.5 block text-ink-500">{{ option.description }}</small></span>
                <span v-if="uiStyle === option.id" class="theme-choice-check"><Check class="h-3.5 w-3.5" /></span>
              </span>
            </button>
          </div>
        </div>

        <div class="panel personal-settings-panel overflow-hidden">
          <div class="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
            <span class="settings-icon settings-icon-lilac"><Palette class="h-5 w-5" /></span>
            <div>
              <h2 class="font-bold">Workspace palette</h2>
              <p class="mt-0.5 text-sm text-ink-500">Colour the main workspace, cards and text while keeping your selected navigation style.</p>
            </div>
          </div>
          <div class="palette-choice-grid p-4">
            <button
              v-for="option in PERSONAL_UI_PALETTES"
              :key="option.id"
              class="palette-choice"
              :class="uiPalette === option.id ? 'palette-choice-active' : ''"
              :style="{
                '--palette-page': option.page,
                '--palette-surface': option.surface,
                '--palette-text': option.text,
                '--palette-border': option.border
              }"
              type="button"
              :aria-pressed="uiPalette === option.id"
              @click="uiPalette = option.id"
            >
              <span class="palette-preview" aria-hidden="true">
                <i class="palette-preview-title" />
                <span class="palette-preview-grid"><i /><i /></span>
                <i class="palette-preview-line" />
              </span>
              <span class="min-w-0 flex-1">
                <strong class="block truncate">{{ option.name }}</strong>
                <small class="mt-0.5 block leading-4">{{ option.description }}</small>
              </span>
              <span v-if="uiPalette === option.id" class="palette-choice-check"><Check class="h-3.5 w-3.5" /></span>
            </button>
          </div>
        </div>

        <div class="panel personal-settings-panel overflow-hidden">
          <div class="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
            <span class="settings-icon settings-icon-aqua"><Palette class="h-5 w-5" /></span>
            <div>
              <h2 class="font-bold">Theme colour</h2>
              <p class="mt-0.5 text-sm text-ink-500">Choose the accent used for actions, selections, links and the archive mark.</p>
            </div>
          </div>
          <div class="accent-choice-grid p-4">
            <button
              v-for="option in PERSONAL_UI_ACCENTS"
              :key="option.id"
              class="accent-choice"
              :class="uiAccent === option.id ? 'accent-choice-active' : ''"
              :style="{ '--accent-swatch': option.color }"
              type="button"
              :aria-pressed="uiAccent === option.id"
              @click="uiAccent = option.id"
            >
              <span class="accent-swatch"><Check v-if="uiAccent === option.id" class="h-3.5 w-3.5" /></span>
              <span>{{ option.name }}</span>
            </button>
          </div>
        </div>

        <div class="panel personal-settings-panel overflow-hidden">
          <div class="flex items-start gap-3 border-b border-ink-100 px-5 py-4">
            <span class="settings-icon settings-icon-aqua"><Rows3 class="h-5 w-5" /></span>
            <div>
              <h2 class="font-bold">Layout spacing</h2>
              <p class="mt-0.5 text-sm text-ink-500">Control the space between tools and content modules.</p>
            </div>
          </div>
          <div class="grid gap-2 p-4 sm:grid-cols-2">
            <button class="density-choice" :class="uiDensity === 'compact' ? 'density-choice-active' : ''" type="button" :aria-pressed="uiDensity === 'compact'" @click="uiDensity = 'compact'">
              <span><strong>Efficient</strong><small>More content on screen</small></span><span class="density-lines density-lines-tight"><i /><i /><i /></span>
            </button>
            <button class="density-choice" :class="uiDensity === 'comfortable' ? 'density-choice-active' : ''" type="button" :aria-pressed="uiDensity === 'comfortable'" @click="uiDensity = 'comfortable'">
              <span><strong>Comfortable</strong><small>More breathing room</small></span><span class="density-lines"><i /><i /><i /></span>
            </button>
          </div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="panel personal-settings-panel p-4">
          <div class="mb-3 flex items-center gap-3">
            <span class="settings-icon settings-icon-yellow"><ShieldCheck class="h-5 w-5" /></span>
            <h2 class="font-bold">Your account</h2>
          </div>
          <dl class="divide-y divide-ink-100 text-sm">
            <div class="flex justify-between gap-4 py-2.5"><dt class="text-ink-500">Name</dt><dd class="font-semibold">{{ auth.user?.name }}</dd></div>
            <div class="flex justify-between gap-4 py-2.5"><dt class="text-ink-500">Username</dt><dd class="max-w-[13rem] truncate font-semibold">{{ auth.user?.email }}</dd></div>
            <div class="flex justify-between gap-4 py-2.5"><dt class="text-ink-500">Role</dt><dd class="font-semibold">{{ auth.user?.role }}</dd></div>
          </dl>
        </div>

        <div class="panel personal-settings-panel p-4">
          <div class="mb-3 flex items-center gap-3">
            <span class="settings-icon settings-icon-aqua"><Database class="h-5 w-5" /></span>
            <h2 class="font-bold">Private storage</h2>
          </div>
          <div class="space-y-2.5 text-sm">
            <p class="status-row"><span class="status-dot" />Document storage connected</p>
            <p class="status-row"><span class="status-dot" />Backup storage connected</p>
            <p class="status-row"><span class="status-dot" />Secure sessions active</p>
          </div>
        </div>
      </div>
    </section>
  </template>

  <template v-else>
  <PageHeader
    eyebrow="System configuration"
    :title="t('settings')"
    description="Workspace controls, role behavior, workflow templates, and audit visibility."
  />

  <section class="grid gap-3 xl:grid-cols-[0.8fr_1.2fr]">
    <div class="space-y-3">
      <div class="panel p-5">
        <div class="mb-4 flex items-center gap-3">
          <ShieldCheck class="h-5 w-5 text-accent-700" />
          <h2 class="font-semibold">Current session</h2>
        </div>
        <dl class="space-y-3 text-sm">
          <div class="flex justify-between gap-4">
            <dt class="text-ink-500">Name</dt>
            <dd class="font-semibold">{{ auth.user?.name }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-500">{{ t("email") }}</dt>
            <dd class="font-semibold">{{ auth.user?.email }}</dd>
          </div>
          <div class="flex justify-between gap-4">
            <dt class="text-ink-500">{{ t("role") }}</dt>
            <dd class="font-semibold">{{ auth.user?.role }}</dd>
          </div>
        </dl>
      </div>

      <div class="panel p-5">
        <h2 class="mb-4 font-semibold">System connections</h2>
        <div class="space-y-3 text-sm">
          <p><span class="font-semibold">Database connection</span> is configured for this workspace.</p>
          <p><span class="font-semibold">Document storage</span> is connected for private {{ labels.lowerSingular }} files.</p>
          <p><span class="font-semibold">Backup storage</span> is connected for packages, manifests, and table exports.</p>
          <p><span class="font-semibold">Secure sessions</span> are configured for assigned-account access.</p>
        </div>
      </div>

      <form class="panel space-y-4 p-5" @submit.prevent="savePbxSettings">
        <div class="flex items-start gap-3">
          <PhoneCall class="mt-1 h-5 w-5 text-accent-700" />
          <div>
            <h2 class="font-semibold">PBX caller popup</h2>
            <p class="mt-1 text-sm text-ink-500">
              Limit CRM popups to MD3-owned inbound numbers, destinations, ring groups, or extensions.
            </p>
          </div>
        </div>

        <label class="flex items-center gap-3 rounded-md border border-ink-200 px-3 py-2 text-sm">
          <input v-model="pbxForm.isEnabled" type="checkbox" :disabled="!canEditSettings" />
          <span>
            <span class="block font-semibold">Enable caller popup</span>
            <span class="block text-ink-500">No popup appears until at least one allowed DID or destination is configured.</span>
          </span>
        </label>

        <div class="grid gap-3 md:grid-cols-2">
          <label class="text-sm">
            <span class="font-semibold">Allowed inbound numbers / DIDs</span>
            <textarea
              v-model="pbxForm.allowedDidsText"
              class="input mt-1 min-h-24"
              :disabled="!canEditSettings"
              placeholder="One per line, e.g. 12125551234"
            />
          </label>
          <label class="text-sm">
            <span class="font-semibold">Allowed destinations / extensions</span>
            <textarea
              v-model="pbxForm.allowedDestinationsText"
              class="input mt-1 min-h-24"
              :disabled="!canEditSettings"
              placeholder="Ring group, queue, or extension, e.g. 600"
            />
          </label>
        </div>

        <details class="rounded-md border border-ink-200 p-3 text-sm">
          <summary class="cursor-pointer font-semibold">Advanced ignore rules</summary>
          <div class="mt-3 grid gap-3 md:grid-cols-2">
            <label>
              <span class="font-semibold">Ignored inbound numbers / DIDs</span>
              <textarea v-model="pbxForm.ignoredDidsText" class="input mt-1 min-h-20" :disabled="!canEditSettings" />
            </label>
            <label>
              <span class="font-semibold">Ignored destinations / extensions</span>
              <textarea v-model="pbxForm.ignoredDestinationsText" class="input mt-1 min-h-20" :disabled="!canEditSettings" />
            </label>
          </div>
        </details>

        <div class="grid gap-3 md:grid-cols-2">
          <label class="flex items-center gap-3 rounded-md border border-ink-200 px-3 py-2 text-sm">
            <input v-model="pbxForm.showUnknownCallers" type="checkbox" :disabled="!canEditSettings" />
            <span class="font-semibold">Show unknown callers</span>
          </label>
          <label class="text-sm">
            <span class="font-semibold">Popup retention seconds</span>
            <input
              v-model.number="pbxForm.popupRetentionSeconds"
              class="input mt-1"
              type="number"
              min="5"
              max="600"
              :disabled="!canEditSettings"
            />
          </label>
        </div>

        <p v-if="pbxError" class="text-sm font-semibold text-legal-red">{{ pbxError }}</p>
        <p v-if="pbxMessage" class="text-sm font-semibold text-accent-700">{{ pbxMessage }}</p>
        <button class="btn-primary" type="submit" :disabled="!canEditSettings || savingPbxSettings">
          <Save class="h-4 w-4" />
          {{ savingPbxSettings ? "Saving..." : "Save PBX settings" }}
        </button>
      </form>

      <form class="panel space-y-4 p-5" @submit.prevent="createGmailToken">
        <div class="flex items-start gap-3">
          <KeyRound class="mt-1 h-5 w-5 text-accent-700" />
          <div>
            <h2 class="font-semibold">Gmail extension tokens</h2>
            <p class="mt-1 text-sm text-ink-500">
              Generate bearer tokens for the MD3 Gmail Chrome Extension. Raw tokens are shown once and stored only as hashes.
            </p>
          </div>
        </div>

        <div v-if="newGmailToken" class="rounded-md border border-accent-200 bg-accent-50 p-3 text-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="font-semibold text-accent-900">New token</p>
              <p class="mt-1 text-xs text-accent-900">Copy this token now. MD3 cannot show it again after you leave this page.</p>
            </div>
            <button class="btn-secondary h-9 px-3 bg-white" type="button" @click="copyNewGmailToken">
              <Copy class="h-4 w-4" />
              Copy token
            </button>
          </div>
          <code class="mt-2 block break-all rounded bg-white px-3 py-2 text-xs text-ink-800">{{ newGmailToken }}</code>
        </div>

        <p v-if="gmailTokenError" class="text-sm font-semibold text-legal-red">{{ gmailTokenError }}</p>
        <p v-if="gmailTokenMessage" class="text-sm font-semibold text-accent-700">{{ gmailTokenMessage }}</p>

        <div v-if="isGmailTokenFormOpen" class="rounded-md border border-ink-200 bg-white p-3">
          <label class="text-sm">
            <span class="font-semibold">Token name</span>
            <input
              v-model="gmailTokenForm.name"
              class="input mt-1"
              :disabled="!canEditSettings || creatingGmailToken"
              placeholder="e.g. Qing Chrome extension"
              required
              autofocus
            />
          </label>
          <p class="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Use a name that identifies the browser, computer, or employee. The raw token is shown once.
          </p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="btn-primary" type="submit" :disabled="!canEditSettings || creatingGmailToken">
              <Plus class="h-4 w-4" />
              {{ creatingGmailToken ? "Creating..." : "Create token" }}
            </button>
            <button class="btn-secondary" type="button" :disabled="creatingGmailToken" @click="cancelGmailTokenForm">
              <X class="h-4 w-4" />
              Cancel
            </button>
          </div>
        </div>

        <button v-else class="btn-primary" type="button" :disabled="!canEditSettings" @click="openGmailTokenForm">
          <Plus class="h-4 w-4" />
          Create extension token
        </button>

        <div class="divide-y divide-ink-100 rounded-md border border-ink-200">
          <article v-if="!gmailExtensionTokens.length" class="px-3 py-4 text-sm text-ink-500">
            No Gmail extension tokens yet.
          </article>
          <article
            v-for="token in gmailExtensionTokens"
            :key="token.tokenId"
            class="flex flex-col gap-3 px-3 py-3 text-sm md:flex-row md:items-center md:justify-between"
          >
            <div>
              <p class="font-semibold">{{ token.name }}</p>
              <p class="mt-1 text-xs text-ink-500">
                {{ token.scopes.join(", ") }} · created {{ formatDateTime(token.createdAt) }}
                <span v-if="token.lastUsedAt"> · last used {{ formatDateTime(token.lastUsedAt) }}</span>
                <span v-if="token.revokedAt"> · revoked {{ formatDateTime(token.revokedAt) }}</span>
              </p>
            </div>
            <button
              class="btn-secondary h-9 px-3 text-red-700"
              type="button"
              :disabled="!canEditSettings || Boolean(token.revokedAt) || revokingGmailTokenId === token.tokenId"
              @click="revokeGmailToken(token)"
            >
              <Trash2 class="h-4 w-4" />
              {{ token.revokedAt ? "Revoked" : revokingGmailTokenId === token.tokenId ? "Revoking..." : "Revoke" }}
            </button>
          </article>
        </div>
      </form>
    </div>

    <div class="space-y-3">
      <div class="panel overflow-hidden">
        <div class="border-b border-ink-200 px-5 py-4">
          <div class="flex items-center gap-3">
            <ListChecks class="h-5 w-5 text-accent-700" />
            <h2 class="font-semibold">Workflow templates</h2>
          </div>
          <p class="mt-1 text-sm text-ink-500">
            {{ labels.typeLabel }} templates define the required document categories and default checklist tasks used by readiness checks.
          </p>
        </div>
        <div v-if="workflowError" class="px-5 py-6 text-sm text-ink-500">{{ workflowError }}</div>
        <div v-else class="divide-y divide-ink-100">
          <article v-for="caseType in visibleCaseTypes" :key="caseType.code" class="px-5 py-4 text-sm">
            <div class="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <h3 class="font-semibold">{{ caseType.name }}</h3>
                <p class="mt-1 text-ink-500">{{ caseType.description }}</p>
              </div>
              <span
                class="w-fit rounded-full px-3 py-1 text-xs font-semibold"
                :class="caseType.closingReadinessEnabled ? 'bg-accent-50 text-accent-800' : 'bg-ink-100 text-ink-600'"
              >
                {{ caseType.closingReadinessEnabled ? "Readiness enabled" : "Informational" }}
              </span>
            </div>
            <div class="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <p class="text-xs font-semibold uppercase text-ink-500">Required document categories</p>
                <p class="mt-1 text-ink-700">
                  {{ caseType.requiredDocumentCategories.length ? caseType.requiredDocumentCategories.join(", ") : "None required" }}
                </p>
              </div>
              <div>
                <p class="text-xs font-semibold uppercase text-ink-500">Default checklist</p>
                <p class="mt-1 text-ink-700">{{ caseType.checklist.length }} tasks created when a new {{ labels.lowerSingular }} is saved.</p>
              </div>
            </div>
          </article>
        </div>
      </div>

      <div class="panel overflow-hidden">
        <div class="border-b border-ink-200 px-5 py-4">
          <h2 class="font-semibold">{{ t("auditLogs") }}</h2>
          <p class="mt-1 text-sm text-ink-500">Visible to Admin. Other roles receive a permission error.</p>
        </div>
        <div v-if="auditError" class="px-5 py-6 text-sm text-ink-500">{{ auditError }}</div>
        <div v-else class="divide-y divide-ink-100">
          <article v-for="log in auditLogs" :key="log.auditLogId" class="px-5 py-4 text-sm">
            <div class="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
              <p class="font-semibold">{{ log.action }}</p>
              <p class="text-xs text-ink-500">{{ log.createdAt }}</p>
            </div>
            <p class="mt-1 text-ink-500">{{ log.userName }} · {{ log.entityType }} · {{ log.entityId }}</p>
          </article>
        </div>
      </div>
    </div>
  </section>
  </template>
</template>
