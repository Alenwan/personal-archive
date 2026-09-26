<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { KNOWLEDGE_STATUSES, KNOWLEDGE_TYPES, type CaseRecord, type DocumentRecord, type KnowledgeInput, type KnowledgeItem, type ManagedAsset } from "../../shared/types";

const props = defineProps<{
  initial?: KnowledgeItem | null;
  services: CaseRecord[];
  assets: ManagedAsset[];
  documents: DocumentRecord[];
  defaultSourceServiceId?: string;
  saving?: boolean;
  submitLabel?: string;
  showCancel?: boolean;
  personalMode?: boolean;
}>();

const emit = defineEmits<{
  save: [input: KnowledgeInput];
  cancel: [];
}>();

const form = reactive({
  title: "",
  type: "Reference",
  status: "Draft",
  component: "",
  summary: "",
  body: "",
  keywordsText: "",
  credentialReference: "",
  sourceServiceId: "",
  assetId: "",
  documentId: "",
  lastVerifiedAt: ""
});

const serviceOptions = computed(() =>
  props.services.map((service) => ({
    id: service.caseId,
    label: `${service.caseNumber} - ${service.propertyAddress}`
  }))
);

const assetOptions = computed(() =>
  props.assets.map((asset) => ({
    id: asset.assetId,
    label: [asset.name, asset.assetType, asset.caseNumber].filter(Boolean).join(" · ")
  }))
);

const documentOptions = computed(() =>
  props.documents.map((document) => ({
    id: document.documentId,
    label: [document.originalFileName, document.category, document.caseNumber].filter(Boolean).join(" · ")
  }))
);

function knowledgeTypeLabel(type: string) {
  if (!props.personalMode) return type;
  return ({
    Runbook: "Checklist",
    Troubleshooting: "Problem note",
    "Install guide": "Guide",
    "Configuration note": "Reference note",
    "Service lesson": "Reading note",
    Reference: "Reference"
  } as Record<string, string>)[type] ?? type;
}

function resetFromInitial() {
  const item = props.initial;
  const serviceLink = item?.links.find((link) => link.entityType === "service");
  const assetLink = item?.links.find((link) => link.entityType === "asset");
  const documentLink = item?.links.find((link) => link.entityType === "document");
  Object.assign(form, {
    title: item?.title ?? "",
    type: item?.type ?? "Reference",
    status: item?.status ?? "Draft",
    component: item?.component ?? "",
    summary: item?.summary ?? "",
    body: item?.body ?? "",
    keywordsText: item?.keywords.join(", ") ?? "",
    credentialReference: item?.credentialReference ?? "",
    sourceServiceId: item?.sourceServiceId ?? serviceLink?.entityId ?? props.defaultSourceServiceId ?? "",
    assetId: assetLink?.entityId ?? "",
    documentId: documentLink?.entityId ?? "",
    lastVerifiedAt: item?.lastVerifiedAt ?? ""
  });
}

function submit() {
  const keywords = form.keywordsText
    .split(",")
    .map((keyword) => keyword.trim())
    .filter(Boolean);
  const links: KnowledgeInput["links"] = [];
  const preservedLinks =
    props.initial?.links
      .filter((link) => {
        if (link.entityType === "discussion") return true;
        if (link.entityType === "credential") return true;
        if (link.entityType === "document" && link.relationship === "discussion attachment") return link.entityId !== form.documentId;
        if (link.entityType === "asset" && link.relationship === "discussion context") return link.entityId !== form.assetId;
        return false;
      })
      .map((link) => ({
        entityType: link.entityType,
        entityId: link.entityId,
        relationship: link.relationship
      })) ?? [];
  if (form.sourceServiceId) links.push({ entityType: "service", entityId: form.sourceServiceId, relationship: "source" });
  if (form.assetId) links.push({ entityType: "asset", entityId: form.assetId, relationship: "related" });
  if (form.documentId) links.push({ entityType: "document", entityId: form.documentId, relationship: "related" });
  links.push(...preservedLinks);
  emit("save", {
    title: form.title.trim(),
    type: form.type as KnowledgeInput["type"],
    status: form.status as KnowledgeInput["status"],
    component: form.component.trim(),
    summary: form.summary.trim(),
    body: form.body.trim(),
    keywords,
    credentialReference: form.credentialReference.trim(),
    sourceServiceId: form.sourceServiceId || null,
    lastVerifiedAt: form.lastVerifiedAt || null,
    links
  });
}

watch(() => [props.initial, props.defaultSourceServiceId], resetFromInitial, { immediate: true });
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <div class="grid gap-3 md:grid-cols-2">
      <label class="block md:col-span-2">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Title</span>
        <input
          v-model="form.title"
          class="input"
          required
          :placeholder="personalMode ? 'Example: Notes from this month’s insurance review' : 'Example: Debian PBX deployment runbook'"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Type</span>
        <select v-model="form.type" class="input">
          <option v-for="type in KNOWLEDGE_TYPES" :key="type" :value="type">{{ knowledgeTypeLabel(type) }}</option>
        </select>
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Status</span>
        <select v-model="form.status" class="input">
          <option v-for="status in KNOWLEDGE_STATUSES" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <label v-if="!personalMode" class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Component</span>
        <input v-model="form.component" class="input" placeholder="PBX, WireGuard, Docker, Network..." />
      </label>
      <label v-if="!personalMode" class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Last verified</span>
        <input v-model="form.lastVerifiedAt" class="input" type="date" />
      </label>
      <label class="block md:col-span-2">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Summary</span>
        <textarea
          v-model="form.summary"
          class="input min-h-20"
          :placeholder="personalMode ? 'A short summary for quick scanning.' : 'Short operational summary for quick scanning.'"
        />
      </label>
      <label class="block md:col-span-2">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Body</span>
        <textarea
          v-model="form.body"
          class="input min-h-56 font-mono text-sm leading-6"
          :placeholder="personalMode ? 'Write in Markdown. Use # and ## headings to create the reading outline.' : 'Steps, commands, checks, decisions, rollback notes...'"
        />
      </label>
      <label class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Keywords</span>
        <input v-model="form.keywordsText" class="input" :placeholder="personalMode ? 'insurance, family, 2026' : 'pbx, sip, docker'" />
      </label>
      <label v-if="!personalMode" class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Credential reference</span>
        <input v-model="form.credentialReference" class="input" placeholder="Credential label only, no secret" />
      </label>
      <label v-if="!personalMode" class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Linked service</span>
        <select v-model="form.sourceServiceId" class="input">
          <option value="">No service link</option>
          <option v-for="service in serviceOptions" :key="service.id" :value="service.id">{{ service.label }}</option>
        </select>
      </label>
      <label v-if="!personalMode" class="block">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Linked asset</span>
        <select v-model="form.assetId" class="input">
          <option value="">No asset link</option>
          <option v-for="asset in assetOptions" :key="asset.id" :value="asset.id">{{ asset.label }}</option>
        </select>
      </label>
      <label class="block md:col-span-2">
        <span class="mb-1 block text-xs font-semibold uppercase text-ink-500">Linked document</span>
        <select v-model="form.documentId" class="input">
          <option value="">No document link</option>
          <option v-for="document in documentOptions" :key="document.id" :value="document.id">{{ document.label }}</option>
        </select>
      </label>
    </div>
    <div class="flex flex-wrap justify-end gap-2">
      <button v-if="showCancel" class="btn-secondary" type="button" @click="emit('cancel')">Cancel</button>
      <button class="btn-primary" type="submit" :disabled="saving || !form.title.trim()">
        {{ submitLabel || "Save knowledge" }}
      </button>
    </div>
  </form>
</template>
