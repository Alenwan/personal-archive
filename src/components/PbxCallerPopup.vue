<script setup lang="ts">
import {
  BriefcaseBusiness,
  Building2,
  HardDrive,
  MessageSquare,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  UserRound,
  X
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { workItemPath } from "../businessTemplate";
import type { PbxCallEvent, PbxCallMatchedEntity, PbxCallMatchedService } from "../shared/types";

const router = useRouter();
const route = useRoute();
const calls = ref<PbxCallEvent[]>([]);
let stream: EventSource | null = null;
let staleSweep: number | null = null;
const DISMISSED_CALLS_STORAGE_KEY = "md3-platform.dismissed-pbx-calls";
const COMMUNICATION_DRAFT_STORAGE_PREFIX = "md3-platform.communication-draft.";
const MANUAL_DISMISS_RETENTION_MS = 60 * 60 * 1000;

const visibleCalls = computed(() => calls.value.slice(0, 3));

function statusLabel(call: PbxCallEvent) {
  if (call.status === "ringing") return "Incoming call";
  if (call.status === "answered") return "Call answered";
  if (call.status === "missed") return "Missed call";
  if (call.status === "ended") return "Call ended";
  return "PBX call";
}

function statusIcon(call: PbxCallEvent) {
  if (call.status === "missed") return PhoneMissed;
  if (call.status === "ringing") return PhoneIncoming;
  return PhoneCall;
}

function statusClass(call: PbxCallEvent) {
  if (call.status === "missed") return "bg-legal-red/10 text-legal-red";
  if (call.status === "answered") return "bg-accent-50 text-accent-700";
  return "bg-teal-50 text-teal-800";
}

function callerNameLooksUnknown(name: string) {
  const normalized = name.trim().toLowerCase();
  return !normalized || normalized === "unknown" || normalized === "<unknown>" || normalized === "anonymous" || normalized === "unavailable";
}

function callTitle(call: PbxCallEvent) {
  const matchedContact = call.matches.find((match) => match.type === "contact");
  if (matchedContact) return matchedContact.label;
  const matchedEntity = call.matches[0];
  if (matchedEntity) return matchedEntity.label;
  if (call.callerName && !callerNameLooksUnknown(call.callerName)) return call.callerName;
  return call.displayCallerNumber || "Unknown caller";
}

function callRetentionMs(call: PbxCallEvent) {
  return (Number(call.metadata?.popupRetentionSeconds) || 30) * 1000;
}

function callTimestamp(call: PbxCallEvent) {
  const value = call.updatedAt || call.endedAt || call.answeredAt || call.startedAt;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Date.now() : timestamp;
}

function callIsStale(call: PbxCallEvent) {
  return Date.now() - callTimestamp(call) > callRetentionMs(call);
}

function readDismissedCalls() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISMISSED_CALLS_STORAGE_KEY) || "{}") as Record<string, number>;
    const now = Date.now();
    const active = Object.fromEntries(Object.entries(parsed).filter(([, expiresAt]) => Number(expiresAt) > now));
    if (Object.keys(active).length !== Object.keys(parsed).length) {
      window.localStorage.setItem(DISMISSED_CALLS_STORAGE_KEY, JSON.stringify(active));
    }
    return active;
  } catch {
    return {};
  }
}

function storageKey(prefix: string, value: unknown): string {
  const text = String(value ?? "").trim();
  return text ? `${prefix}:${text}` : "";
}

function communicationIdForCall(call: PbxCallEvent) {
  return typeof call.metadata?.communicationId === "string" ? call.metadata.communicationId : "";
}

function callIdentityKeys(call: PbxCallEvent): string[] {
  const keys = [
    call.callId,
    storageKey("call", call.callId),
    storageKey("linked", call.linkedId),
    storageKey("unique", call.uniqueId),
    storageKey("communication", communicationIdForCall(call)),
    storageKey("fingerprint", [call.normalizedCallerNumber || call.callerNumber, call.destination, call.startedAt].filter(Boolean).join("|"))
  ];
  return [...new Set(keys.filter(Boolean))];
}

function callWasDismissed(call: PbxCallEvent) {
  const dismissed = readDismissedCalls();
  return callIdentityKeys(call).some((key) => Boolean(dismissed[key]));
}

function rememberDismissedCall(call: PbxCallEvent) {
  const dismissed = readDismissedCalls();
  const expiresAt = Date.now() + MANUAL_DISMISS_RETENTION_MS;
  for (const key of callIdentityKeys(call)) {
    dismissed[key] = expiresAt;
  }
  window.localStorage.setItem(DISMISSED_CALLS_STORAGE_KEY, JSON.stringify(dismissed));
}

function callsShareIdentity(first: PbxCallEvent, second: PbxCallEvent) {
  const keys = new Set(callIdentityKeys(first));
  return callIdentityKeys(second).some((key) => keys.has(key));
}

function mergeCall(event: PbxCallEvent) {
  if (callWasDismissed(event) || callIsStale(event)) return;
  const existingIndex = calls.value.findIndex((call) => callsShareIdentity(call, event));
  const next = existingIndex === -1 ? [event, ...calls.value] : calls.value.map((call, index) => (index === existingIndex ? event : call));
  calls.value = next.slice(0, 8);
  window.setTimeout(() => {
    const current = calls.value.find((call) => callsShareIdentity(call, event));
    if (current?.eventId === event.eventId) removeCall(event);
  }, callRetentionMs(event));
}

function removeCall(callToRemove: PbxCallEvent) {
  calls.value = calls.value.filter((call) => !callsShareIdentity(call, callToRemove));
}

function pruneStaleCalls() {
  calls.value = calls.value.filter((call) => !callWasDismissed(call) && !callIsStale(call));
}

function dismiss(call: PbxCallEvent) {
  rememberDismissedCall(call);
  removeCall(call);
}

function openMatch(call: PbxCallEvent, match: PbxCallMatchedEntity) {
  dismiss(call);
  if (match.type === "contact") void router.push(`/contacts/${match.id}`);
  if (match.type === "organization") void router.push(`/organizations/${match.id}`);
  if (match.type === "asset") void router.push(`/managed-assets/${match.id}`);
}

function openService(call: PbxCallEvent, service: PbxCallMatchedService, tab = "") {
  dismiss(call);
  void router.push(workItemPath(service.caseId, tab));
}

function openContacts(call: PbxCallEvent) {
  dismiss(call);
  void router.push("/contacts");
}

function openServices(call: PbxCallEvent) {
  dismiss(call);
  void router.push("/services");
}

function serviceSuggestionTitle(service: PbxCallMatchedService) {
  return [service.caseNumber, service.title].filter(Boolean).join(" · ");
}

function preferredDraftCaseId(services: PbxCallMatchedService[]) {
  const currentServiceId = ["service-detail", "case-detail"].includes(String(route.name)) ? String(route.params.id ?? "") : "";
  if (services.some((service) => service.caseId === currentServiceId)) return currentServiceId;
  return services.length === 1 ? services[0].caseId : null;
}

function savedCommunicationText(call: PbxCallEvent) {
  if (!communicationIdForCall(call)) return "";
  if (call.status === "missed") return "Missed call saved in Communications";
  if (call.status === "answered") return "Answered call saved in Communications";
  if (call.status === "ended") return "Call saved in Communications";
  return "Call record is being saved";
}

function dismissTitle(call: PbxCallEvent) {
  return communicationIdForCall(call) ? "Hide popup; the call stays in Communications" : "Hide popup";
}

function logCall(call: PbxCallEvent) {
  const existingCommunicationId = communicationIdForCall(call);
  if (existingCommunicationId) {
    dismiss(call);
    void router.push(
      `/communications?view=all&communicationType=Call&source=${encodeURIComponent("Asterisk / PBX")}&focus=${encodeURIComponent(existingCommunicationId)}`
    );
    return;
  }
  const contactMatch = call.matches.find((match) => match.type === "contact");
  const organizationMatch = call.matches.find((match) => match.type === "organization");
  const assetMatch = call.matches.find((match) => match.type === "asset");
  const draftId = crypto.randomUUID();
  const title = callTitle(call);
  sessionStorage.setItem(
    `${COMMUNICATION_DRAFT_STORAGE_PREFIX}${draftId}`,
    JSON.stringify({
      caseId: preferredDraftCaseId(call.services),
      contactId: contactMatch?.id ?? null,
      partyOrganizationId: organizationMatch?.id ?? null,
      assetId: assetMatch?.id ?? null,
      communicationType: "Call",
      direction: "Inbound",
      source: "Asterisk / PBX",
      status: call.services.length === 1 ? "Linked" : "New",
      externalProvider: call.externalProvider,
      externalReference: call.callId,
      subject: `Inbound call from ${title}`,
      body: "",
      occurredAt: call.startedAt || call.updatedAt,
      sourceMetadata: {
        callId: call.callId,
        linkedId: call.linkedId,
        uniqueId: call.uniqueId,
        callerNumber: call.displayCallerNumber || call.callerNumber,
        rawCallerNumber: call.callerNumber,
        callerName: call.callerName,
        destination: call.destination,
        extension: call.extension,
        channel: call.channel,
        status: call.status,
        possibleServices: call.services.map((service) => ({
          caseId: service.caseId,
          caseNumber: service.caseNumber,
          title: service.title
        }))
      },
      draftNotice: call.services.length > 1
        ? "Prepared from PBX call. Multiple possible services were found, so the service is intentionally left for you to choose."
        : "Prepared from PBX call."
    })
  );
  dismiss(call);
  void router.push(`/communications?draft=${draftId}`);
}

async function loadRecentCalls() {
  try {
    const response = await fetch("/api/pbx/calls/recent", { credentials: "include" });
    if (!response.ok) return;
    const recent = (await response.json()) as PbxCallEvent[];
    for (const event of recent.slice().reverse()) mergeCall(event);
  } catch (error) {
    console.error("Unable to load recent PBX calls", error);
  }
}

onMounted(() => {
  staleSweep = window.setInterval(pruneStaleCalls, 5_000);
  void loadRecentCalls();
  stream = new EventSource("/api/pbx/calls/stream", { withCredentials: true });
  stream.addEventListener("call", (message) => {
    try {
      mergeCall(JSON.parse((message as MessageEvent<string>).data) as PbxCallEvent);
    } catch (error) {
      console.error("Unable to parse PBX call event", error);
    }
  });
});

onBeforeUnmount(() => {
  if (staleSweep) window.clearInterval(staleSweep);
  staleSweep = null;
  stream?.close();
  stream = null;
});
</script>

<template>
  <div v-if="visibleCalls.length" class="fixed right-4 top-20 z-50 w-[min(28rem,calc(100vw-2rem))] space-y-3">
    <article
      v-for="call in visibleCalls"
      :key="call.callId"
      class="rounded-lg border border-ink-200 bg-white shadow-soft"
    >
      <div class="flex items-start gap-3 border-b border-ink-100 p-4">
        <div :class="['grid h-10 w-10 shrink-0 place-items-center rounded-md', statusClass(call)]">
          <component :is="statusIcon(call)" class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase text-accent-700">{{ statusLabel(call) }}</p>
              <h2 class="truncate text-lg font-semibold text-ink-900">
                {{ callTitle(call) }}
              </h2>
            </div>
            <button class="btn-secondary h-8 w-8 p-0" type="button" :title="dismissTitle(call)" @click="dismiss(call)">
              <X class="h-4 w-4" />
            </button>
          </div>
          <p class="mt-1 text-sm text-ink-600">
            {{ call.displayCallerNumber || call.callerNumber || "No caller ID" }}
            <span v-if="call.destination"> · to {{ call.destination }}</span>
            <span v-if="call.extension"> · ext {{ call.extension }}</span>
          </p>
          <p v-if="savedCommunicationText(call)" class="mt-1 text-xs font-semibold text-accent-700">
            {{ savedCommunicationText(call) }}
          </p>
        </div>
      </div>

      <div class="space-y-3 p-4">
        <div v-if="call.matches.length" class="space-y-2">
          <button
            v-for="match in call.matches.slice(0, 3)"
            :key="`${match.type}-${match.id}-${match.matchedField}`"
            class="flex w-full items-center gap-3 rounded-md border border-ink-200 px-3 py-2 text-left transition hover:bg-ink-50"
            type="button"
            @click="openMatch(call, match)"
          >
            <UserRound v-if="match.type === 'contact'" class="h-4 w-4 text-accent-700" />
            <Building2 v-else-if="match.type === 'organization'" class="h-4 w-4 text-accent-700" />
            <HardDrive v-else class="h-4 w-4 text-accent-700" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-semibold text-ink-900">{{ match.label }}</span>
              <span class="block truncate text-xs text-ink-500">{{ match.matchedField }} · {{ match.matchedValue }}</span>
            </span>
          </button>
        </div>
        <div v-else class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Unknown caller. Create or update a contact, organization, or asset to match this number.
        </div>

        <div class="flex flex-wrap gap-2">
          <button class="btn-secondary px-3 py-2 text-sm" type="button" @click="logCall(call)">
            <MessageSquare v-if="communicationIdForCall(call)" class="h-4 w-4" />
            <PhoneCall v-else class="h-4 w-4" />
            {{ communicationIdForCall(call) ? "Review call" : "Log call" }}
          </button>
          <button v-if="!call.matches.length" class="btn-secondary px-3 py-2 text-sm" type="button" @click="openContacts(call)">
            <UserRound class="h-4 w-4" />
            Contacts
          </button>
          <button v-if="!call.services.length" class="btn-secondary px-3 py-2 text-sm" type="button" @click="openServices(call)">
            <BriefcaseBusiness class="h-4 w-4" />
            Services
          </button>
        </div>
        <div v-if="call.services.length" class="rounded-md border border-ink-100 bg-ink-50/70 p-3">
          <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p class="text-xs font-semibold uppercase text-ink-600">Possible services</p>
            <p class="text-xs text-ink-500">Optional suggestions. The call is already kept in Communications.</p>
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="service in call.services.slice(0, 3)"
              :key="service.caseId"
              class="btn-secondary max-w-full px-3 py-2 text-left text-sm"
              type="button"
              :title="serviceSuggestionTitle(service)"
              @click="openService(call, service)"
            >
              <BriefcaseBusiness class="h-4 w-4 shrink-0" />
              <span class="min-w-0">
                <span class="block truncate font-semibold">{{ service.caseNumber }}</span>
                <span v-if="service.title" class="block max-w-[13rem] truncate text-xs font-medium text-ink-500">
                  {{ service.title }}
                </span>
              </span>
            </button>
          </div>
        </div>
        <p v-if="communicationIdForCall(call)" class="text-xs text-ink-500">
          Closing this popup only hides the notification. The call remains in Communications for review or follow-up.
        </p>
      </div>
    </article>
  </div>
</template>
