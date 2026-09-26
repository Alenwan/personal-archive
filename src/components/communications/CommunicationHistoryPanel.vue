<script setup lang="ts">
import { Ban, BriefcaseBusiness, Building2, CheckCircle2, Clock, ExternalLink, HardDrive, Inbox, Plus, RotateCcw, UserRound } from "lucide-vue-next";
import { computed, ref } from "vue";
import { RouterLink } from "vue-router";
import { workItemPath } from "../../businessTemplate";
import {
  communicationBodyIsTruncated,
  communicationLooksLikeTestRecord,
  communicationSenderLabel,
  displayCommunicationBody,
  emailAddressList,
  emailAddressListText,
  emailThreadMessageSenderLabel,
  metadataString,
  parseGmailThreadMessages,
  previewCommunicationBody,
  threadMessagePreview,
  threadPreviewMessages
} from "../../shared/communicationDisplay";
import { formatDateTime, formatDateTimeIfValid } from "../../shared/format";
import type { CommunicationRecord, CommunicationStatus } from "../../shared/types";

const BODY_PREVIEW_LENGTH = 520;

const props = withDefaults(
  defineProps<{
    communications: CommunicationRecord[];
    title?: string;
    description?: string;
    emptyText?: string;
    maxHeightClass?: string;
    showServiceLink?: boolean;
    focusId?: string;
    canManage?: boolean;
    inboxLink?: string;
    logLabel?: string;
  }>(),
  {
    title: "Communications",
    description: "Related calls, emails, SMS, updates, decisions, and internal notes.",
    emptyText: "No communications recorded yet.",
    maxHeightClass: "max-h-[560px]",
    showServiceLink: true,
    focusId: "",
    canManage: false,
    inboxLink: "/communications",
    logLabel: ""
  }
);

const emit = defineEmits<{
  (event: "status-change", communication: CommunicationRecord, status: CommunicationStatus): void;
  (event: "log"): void;
}>();

const showArchived = ref(false);
const showTestRecords = ref(false);

const sortedCommunications = computed(() =>
  props.communications.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.createdAt.localeCompare(a.createdAt))
);

const testCommunications = computed(() => sortedCommunications.value.filter(communicationLooksLikeTestRecord));

const focusedTestRecordVisible = computed(() => testCommunications.value.some((communication) => communication.communicationId === props.focusId));

const dayToDayCommunications = computed(() => {
  if (showTestRecords.value) return sortedCommunications.value;
  return sortedCommunications.value.filter(
    (communication) => !communicationLooksLikeTestRecord(communication) || communication.communicationId === props.focusId
  );
});

function toggleTestRecords() {
  showTestRecords.value = !showTestRecords.value;
}

const archivedCommunications = computed(() => dayToDayCommunications.value.filter((communication) => communication.status === "Ignored / Spam"));

const workingCommunications = computed(() => dayToDayCommunications.value.filter((communication) => communication.status !== "Ignored / Spam"));

const archivedExpanded = computed(
  () => showArchived.value || archivedCommunications.value.some((communication) => communication.communicationId === props.focusId)
);

const visibleCommunications = computed(() => (archivedExpanded.value ? dayToDayCommunications.value : workingCommunications.value));

function statusClass(status: CommunicationStatus) {
  if (status === "Needs follow-up") return "bg-amber-100 text-amber-900";
  if (status === "Linked") return "bg-teal-100 text-teal-900";
  if (status === "Ignored / Spam") return "bg-red-100 text-red-900";
  if (status === "New") return "bg-blue-100 text-blue-900";
  return "bg-ink-100 text-ink-700";
}

function statusLabel(status: CommunicationStatus) {
  if (status === "Ignored / Spam") return "Archived";
  return status;
}

function todayDate(): string {
  return new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function isFollowUpOverdue(communication: CommunicationRecord): boolean {
  return communication.status === "Needs follow-up" && Boolean(communication.followUpDueDate && communication.followUpDueDate < todayDate());
}

function followUpSummary(communication: CommunicationRecord): string {
  return [
    communication.followUpAssignedToName ? `Owner: ${communication.followUpAssignedToName}` : "No owner",
    communication.followUpDueDate ? `Due: ${communication.followUpDueDate}` : "No due date"
  ].join(" · ");
}

function sourceMetadataText(communication: CommunicationRecord) {
  const callerNumber = typeof communication.sourceMetadata?.callerNumber === "string" ? communication.sourceMetadata.callerNumber : "";
  const destination = typeof communication.sourceMetadata?.destination === "string" ? communication.sourceMetadata.destination : "";
  return [callerNumber, destination].filter(Boolean).join(" -> ");
}

function senderLabel(communication: CommunicationRecord): string {
  return communicationSenderLabel(communication);
}

function messageSenderLabel(communication: CommunicationRecord, rawSender: string): string {
  return emailThreadMessageSenderLabel(communication, rawSender);
}

function emailHeaderRows(communication: CommunicationRecord) {
  const emailDate = metadataString(communication, "date");
  return [
    ["From", emailAddressListText(emailAddressList(communication, "from"))],
    ["To", emailAddressListText(emailAddressList(communication, "to"))],
    ["Cc", emailAddressListText(emailAddressList(communication, "cc"))],
    ["Date", emailDate ? formatDateTimeIfValid(emailDate) : formatDateTime(communication.occurredAt)]
  ].filter(([, value]) => value);
}

function callDetailRows(communication: CommunicationRecord) {
  return [
    ["Caller", metadataString(communication, "callerNumber")],
    ["Destination", metadataString(communication, "destination")],
    ["Extension", metadataString(communication, "extension")],
    ["Call status", metadataString(communication, "status")],
    ["Call ID", metadataString(communication, "callId")]
  ].filter(([, value]) => value);
}

function displayBody(communication: CommunicationRecord): string {
  return displayCommunicationBody(communication);
}

function previewBody(communication: CommunicationRecord): string {
  return previewCommunicationBody(communication, BODY_PREVIEW_LENGTH);
}

function bodyIsTruncated(communication: CommunicationRecord): boolean {
  return communicationBodyIsTruncated(communication, BODY_PREVIEW_LENGTH);
}

function createdByLabel(communication: CommunicationRecord) {
  return communication.createdByName || (communication.source === "Asterisk / PBX" ? "PBX" : "Unknown User");
}

function resolvedStatus(communication: CommunicationRecord): CommunicationStatus {
  return communication.caseId ? "Linked" : "Logged";
}

function nextActionText(communication: CommunicationRecord): string {
  if (communication.status === "Ignored / Spam") {
    return "Archived here, not deleted. Restore it if this should return to the working history.";
  }
  if (communication.status === "Needs follow-up") {
    const followUp = followUpSummary(communication);
    return communication.caseId
      ? `Follow-up is open. ${followUp}. Mark reviewed after the work is handled.`
      : `Follow-up is open. ${followUp}. Mark reviewed after handling it, or link it from Communications if a service becomes clear.`;
  }
  if (communication.caseId) {
    return "Filed to a service. Open in Communications if the service link needs to change.";
  }
  if (communication.status === "New") {
    return "Review this record, then mark reviewed, follow up, archive it, or open it to link more context.";
  }
  return "Reviewed and kept in this history.";
}

function setStatus(communication: CommunicationRecord, status: CommunicationStatus) {
  emit("status-change", communication, status);
}

function inboxFocusLink(communicationId: string): string {
  const baseLink = props.inboxLink || "/communications";
  try {
    const url = new URL(baseLink, window.location.origin);
    url.searchParams.set("focus", communicationId);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    const separator = baseLink.includes("?") ? "&" : "?";
    return `${baseLink}${separator}focus=${encodeURIComponent(communicationId)}`;
  }
}

function emailThreadSummary(communication: CommunicationRecord): string {
  const count = parseGmailThreadMessages(communication).length;
  if (count === 1) return "1 email message";
  return `${count} message thread`;
}

function readFullLabel(communication: CommunicationRecord): string {
  const count = parseGmailThreadMessages(communication).length;
  if (count === 1) return "Read full email";
  if (count > 1) return "Read full thread";
  return "Read full record";
}
</script>

<template>
  <div class="panel overflow-hidden">
    <div class="flex flex-wrap items-start justify-between gap-2 border-b border-ink-100 p-4">
      <div>
        <h2 class="font-semibold">{{ title }}</h2>
        <p class="mt-1 text-sm text-ink-500">{{ description }}</p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <span class="rounded-full bg-accent-50 px-3 py-1 text-sm font-semibold text-accent-800">
          {{ workingCommunications.length }}
        </span>
        <span v-if="archivedCommunications.length" class="text-xs font-semibold text-ink-500">
          {{ archivedCommunications.length }} archived
        </span>
        <button v-if="canManage && logLabel" class="btn-primary h-9 px-3 text-sm" type="button" @click="emit('log')">
          <Plus class="h-4 w-4" />
          {{ logLabel }}
        </button>
        <RouterLink v-if="inboxLink" class="btn-secondary h-9 px-3 text-sm" :to="inboxLink">
          <Inbox class="h-4 w-4" />
          Open in Communications
        </RouterLink>
      </div>
    </div>

    <div v-if="testCommunications.length" class="border-b border-ink-100 bg-ink-50 px-4 py-2 text-sm">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <span class="text-ink-500">
          {{ testCommunications.length }} smoke/test {{ testCommunications.length === 1 ? "record is" : "records are" }}
          {{ showTestRecords ? "shown." : focusedTestRecordVisible ? "showing only the focused record." : "hidden from this working history." }}
        </span>
        <button class="font-semibold text-accent-800 hover:underline" type="button" @click="toggleTestRecords">
          {{ showTestRecords ? "Hide test records" : "Show test records" }}
        </button>
      </div>
    </div>

    <div :class="['overflow-y-auto p-4', maxHeightClass]">
      <div v-if="visibleCommunications.length" class="space-y-3">
        <article
          v-for="communication in visibleCommunications"
          :key="communication.communicationId"
          class="rounded-md border border-ink-200 p-3"
          :class="focusId === communication.communicationId ? 'ring-2 ring-accent-600' : ''"
        >
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <span class="rounded-full bg-accent-50 px-2.5 py-1 text-xs font-semibold uppercase text-accent-900">
                  {{ communication.communicationType }}
                </span>
                <span class="rounded-full bg-ink-100 px-2.5 py-1 text-xs font-semibold text-ink-700">
                  {{ communication.direction }}
                </span>
                <span :class="['rounded-full px-2.5 py-1 text-xs font-semibold', statusClass(communication.status)]">
                  {{ statusLabel(communication.status) }}
                </span>
                <span v-if="communication.source !== 'Manual'" class="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-semibold text-purple-900">
                  {{ communication.source }}
                </span>
                <span
                  v-if="communication.status === 'Needs follow-up'"
                  class="rounded-full px-2.5 py-1 text-xs font-semibold"
                  :class="isFollowUpOverdue(communication) ? 'bg-red-100 text-red-900' : 'bg-amber-100 text-amber-900'"
                >
                  {{ followUpSummary(communication) }}
                </span>
              </div>
              <p v-if="communication.source === 'Gmail'" class="mt-3 text-sm font-semibold text-ink-600">{{ senderLabel(communication) }}</p>
              <h3 :class="['font-semibold text-ink-950', communication.source === 'Gmail' ? 'mt-1' : 'mt-3']">{{ communication.subject }}</h3>
              <p v-if="sourceMetadataText(communication)" class="mt-1 text-sm font-semibold text-ink-500">{{ sourceMetadataText(communication) }}</p>
            </div>
            <p class="text-right text-xs leading-5 text-ink-500">
              {{ formatDateTime(communication.occurredAt) }}<br />
              {{ createdByLabel(communication) }}
            </p>
          </div>

          <div class="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-ink-600">
            <RouterLink
              v-if="showServiceLink && communication.caseId"
              class="rounded-full bg-teal-50 px-2.5 py-1 text-teal-900 hover:underline"
              :to="workItemPath(communication.caseId, 'tab=communications')"
            >
              <BriefcaseBusiness class="mr-1 inline h-3.5 w-3.5" />
              {{ communication.caseNumber }} · {{ communication.caseTitle }}
            </RouterLink>
            <RouterLink v-if="communication.contactId" class="rounded-full bg-ink-50 px-2.5 py-1 hover:underline" :to="`/contacts/${communication.contactId}`">
              <UserRound class="mr-1 inline h-3.5 w-3.5" />
              {{ communication.contactName }}
            </RouterLink>
            <RouterLink
              v-if="communication.partyOrganizationId"
              class="rounded-full bg-ink-50 px-2.5 py-1 hover:underline"
              :to="`/organizations/${communication.partyOrganizationId}`"
            >
              <Building2 class="mr-1 inline h-3.5 w-3.5" />
              {{ communication.partyOrganizationName }}
            </RouterLink>
            <RouterLink v-if="communication.assetId" class="rounded-full bg-ink-50 px-2.5 py-1 hover:underline" :to="`/managed-assets/${communication.assetId}`">
              <HardDrive class="mr-1 inline h-3.5 w-3.5" />
              {{ communication.assetName }}
            </RouterLink>
            <span v-if="communication.supportingDocumentName" class="rounded-full bg-ink-50 px-2.5 py-1">{{ communication.supportingDocumentName }}</span>
            <span v-if="communication.externalProvider" class="rounded-full bg-ink-50 px-2.5 py-1">{{ communication.externalProvider }}</span>
            <span v-if="communication.externalReference" class="rounded-full bg-ink-50 px-2.5 py-1">{{ communication.externalReference }}</span>
          </div>

          <details v-if="communication.source === 'Gmail' && emailHeaderRows(communication).length" class="mt-3 rounded-md border border-ink-100 bg-ink-50/60">
            <summary class="cursor-pointer px-3 py-2 text-xs font-semibold text-ink-600">Email details</summary>
            <div
              v-for="row in emailHeaderRows(communication)"
              :key="row[0]"
              class="grid gap-1 border-t border-ink-100 px-3 py-2 text-xs sm:grid-cols-[4rem_1fr]"
            >
              <span class="font-semibold text-ink-500">{{ row[0] }}</span>
              <span class="break-words text-ink-700">{{ row[1] }}</span>
            </div>
          </details>

          <div
            v-else-if="communication.source === 'Asterisk / PBX' && callDetailRows(communication).length"
            class="mt-3 grid gap-2 rounded-md border border-ink-100 bg-ink-50/60 p-3 text-xs sm:grid-cols-2"
          >
            <div v-for="row in callDetailRows(communication)" :key="row[0]">
              <span class="block font-semibold uppercase text-ink-500">{{ row[0] }}</span>
              <span class="mt-0.5 block break-words text-ink-800">{{ row[1] }}</span>
            </div>
          </div>

          <div v-if="threadPreviewMessages(communication).length" class="mt-3 rounded-md border border-ink-100 bg-white">
            <div class="flex flex-wrap items-center justify-between gap-2 border-b border-ink-100 px-3 py-2">
              <span class="text-xs font-semibold uppercase text-accent-700">
                {{ emailThreadSummary(communication) }}
              </span>
              <span v-if="parseGmailThreadMessages(communication).length > threadPreviewMessages(communication).length" class="text-xs text-ink-500">
                Showing latest {{ threadPreviewMessages(communication).length }}
              </span>
            </div>
            <div class="divide-y divide-ink-100">
              <div v-for="message in threadPreviewMessages(communication)" :key="message.key" class="px-3 py-2">
                <div class="flex flex-wrap items-start justify-between gap-2">
                  <p class="text-xs font-semibold text-ink-700" :title="message.from">
                    Message {{ message.index }} · {{ messageSenderLabel(communication, message.from) }}
                  </p>
                  <p class="text-xs text-ink-500">{{ formatDateTimeIfValid(message.timestamp) }}</p>
                </div>
                <p class="mt-1 text-sm leading-6 text-ink-700">{{ threadMessagePreview(message) || "No message body." }}</p>
              </div>
            </div>
          </div>
          <p v-else-if="displayBody(communication)" class="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-700">{{ previewBody(communication) }}</p>
          <RouterLink
            v-if="bodyIsTruncated(communication)"
            class="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-accent-800 hover:underline"
            :to="inboxFocusLink(communication.communicationId)"
          >
            <Inbox class="h-4 w-4" />
            {{ readFullLabel(communication) }}
          </RouterLink>
          <a
            v-if="communication.externalUrl"
            class="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-accent-800 hover:underline"
            :href="communication.externalUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink class="h-4 w-4" />
            {{ communication.source === "Gmail" ? "Open in Gmail" : "Open external record" }}
          </a>

          <p v-if="communication.status === 'Ignored / Spam'" class="mt-3 rounded-md border border-red-100 bg-red-50 p-3 text-sm text-red-900">
            This record is archived in Communications, not deleted. Restore it if this should stay in the working history.
          </p>

          <div v-if="canManage || inboxLink" class="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-3">
            <p v-if="canManage" class="basis-full text-xs leading-5 text-ink-500">
              {{ nextActionText(communication) }}
            </p>
            <button
              v-if="canManage && communication.status !== 'Needs follow-up' && communication.status !== 'Ignored / Spam'"
              class="btn-secondary h-9 px-3"
              type="button"
              @click="setStatus(communication, 'Needs follow-up')"
            >
              <Clock class="h-4 w-4" />
              Follow up
            </button>
            <button
              v-if="canManage && communication.status !== resolvedStatus(communication)"
              class="btn-secondary h-9 px-3"
              type="button"
              @click="setStatus(communication, resolvedStatus(communication))"
            >
              <RotateCcw v-if="communication.status === 'Ignored / Spam'" class="h-4 w-4" />
              <CheckCircle2 v-else class="h-4 w-4" />
              {{ communication.status === "Ignored / Spam" ? "Restore" : "Mark reviewed" }}
            </button>
            <button
              v-if="canManage && communication.status !== 'Ignored / Spam'"
              class="btn-secondary h-9 px-3 text-legal-red hover:border-red-200 hover:bg-red-50"
              type="button"
              @click="setStatus(communication, 'Ignored / Spam')"
            >
              <Ban class="h-4 w-4" />
              Archive
            </button>
            <RouterLink v-if="inboxLink" class="btn-secondary h-9 px-3" :to="inboxFocusLink(communication.communicationId)">
              <Inbox class="h-4 w-4" />
              Open in Communications
            </RouterLink>
          </div>
        </article>

        <div
          v-if="archivedCommunications.length"
          class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-600"
        >
          <span>
            {{
              archivedExpanded
                ? `${archivedCommunications.length} archived ${archivedCommunications.length === 1 ? "record is" : "records are"} shown.`
                : `${archivedCommunications.length} archived ${archivedCommunications.length === 1 ? "record is" : "records are"} hidden from the working history.`
            }}
          </span>
          <button class="font-semibold text-accent-800 hover:underline" type="button" @click="showArchived = !showArchived">
            {{ archivedExpanded ? "Hide archived" : "Show archived" }}
          </button>
        </div>
      </div>

      <div
        v-else-if="archivedCommunications.length"
        class="rounded-md border border-ink-200 bg-ink-50 p-5 text-sm text-ink-600"
      >
        <p>
          {{ archivedCommunications.length }} archived
          {{ archivedCommunications.length === 1 ? "record is" : "records are" }} hidden from this working history.
        </p>
        <button class="mt-3 font-semibold text-accent-800 hover:underline" type="button" @click="showArchived = true">
          Show archived
        </button>
      </div>

      <div v-else class="rounded-md border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">
        {{ emptyText }}
      </div>
    </div>
  </div>
</template>
