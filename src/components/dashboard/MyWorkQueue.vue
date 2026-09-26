<script setup lang="ts">
import {
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  ListChecks,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  RotateCcw,
  UserRound,
  Wrench
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import { client } from "../../api/client";
import { workItemPath } from "../../businessTemplate";
import { formatDate } from "../../shared/format";
import type { MyWorkFilters, MyWorkItem, MyWorkQueue, MyWorkSource, MyWorkState, PublicUser } from "../../shared/types";
import { useAuthStore } from "../../stores/auth";
import { useToastStore } from "../../stores/toasts";

const auth = useAuthStore();
const toasts = useToastStore();
const queue = ref<MyWorkQueue | null>(null);
const users = ref<PublicUser[]>([]);
const loading = ref(true);
const error = ref("");
const busyKey = ref("");
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

const filters = reactive({
  source: "" as MyWorkSource | "",
  owner: "attention",
  state: "" as MyWorkState | "",
  dateFrom: "",
  dateTo: ""
});

const sourceOptions = computed(() => [
  { value: "" as const, label: "All", icon: Wrench, count: Object.values(queue.value?.summary.bySource ?? {}).reduce((sum, count) => sum + count, 0) },
  { value: "discussion" as const, label: "Discussions", icon: MessageSquare, count: queue.value?.summary.bySource.discussion ?? 0 },
  { value: "task" as const, label: "Tasks", icon: ListChecks, count: queue.value?.summary.bySource.task ?? 0 },
  { value: "communication" as const, label: "Follow-ups", icon: PhoneCall, count: queue.value?.summary.bySource.communication ?? 0 },
  { value: "service" as const, label: "Services", icon: CalendarClock, count: queue.value?.summary.bySource.service ?? 0 }
]);

const stateOptions: Array<{ value: MyWorkState | ""; label: string }> = [
  { value: "", label: "Any state" },
  { value: "overdue", label: "Overdue" },
  { value: "due-today", label: "Due today" },
  { value: "due-soon", label: "Due soon" },
  { value: "needs-action", label: "Needs action" },
  { value: "unread", label: "Unread" },
  { value: "blocked", label: "Blocked" },
  { value: "unscheduled", label: "No due date" }
];

const hasActiveFilters = computed(
  () => filters.source || filters.owner !== "attention" || filters.state || filters.dateFrom || filters.dateTo
);

function filterPayload(): MyWorkFilters {
  return {
    source: filters.source,
    owner: filters.owner,
    state: filters.state,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  };
}

async function loadQueue(showLoading = false) {
  if (showLoading || !queue.value) loading.value = true;
  error.value = "";
  try {
    queue.value = await client.myWork(filterPayload());
  } catch (loadError) {
    error.value = loadError instanceof Error ? loadError.message : "Unable to load My Work.";
  } finally {
    loading.value = false;
  }
}

function queueReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => void loadQueue(), 180);
}

function resetFilters() {
  filters.source = "";
  filters.owner = "attention";
  filters.state = "";
  filters.dateFrom = "";
  filters.dateTo = "";
}

function sourceLabel(source: MyWorkSource): string {
  if (source === "discussion") return "Discussion";
  if (source === "task") return "Task";
  if (source === "communication") return "Follow-up";
  return "Service target";
}

function sourceIcon(source: MyWorkSource) {
  if (source === "discussion") return MessageSquare;
  if (source === "task") return ListChecks;
  if (source === "communication") return PhoneCall;
  return CalendarClock;
}

function sourcePath(item: MyWorkItem): string {
  if (item.source === "discussion") return `/discussions?q=${encodeURIComponent(item.sourceId)}`;
  if (item.source === "communication") return `/communications?view=followUp&focus=${encodeURIComponent(item.sourceId)}`;
  if (item.source === "task" && item.caseId) return workItemPath(item.caseId, "tab=tasks");
  if (item.caseId) return workItemPath(item.caseId);
  return "/dashboard";
}

function stateLabel(state: MyWorkState): string {
  const labels: Record<MyWorkState, string> = {
    overdue: "Overdue",
    "due-today": "Due today",
    "due-soon": "Due soon",
    "needs-action": "Needs action",
    unread: "Unread",
    blocked: "Blocked",
    open: "Open",
    unscheduled: "No due date"
  };
  return labels[state];
}

function stateClass(state: MyWorkState): string {
  if (state === "overdue" || state === "blocked") return "bg-red-50 text-red-800 border-red-200";
  if (state === "due-today" || state === "needs-action") return "bg-amber-50 text-amber-800 border-amber-200";
  if (state === "unread") return "bg-blue-50 text-blue-800 border-blue-200";
  if (state === "due-soon") return "bg-accent-50 text-accent-800 border-accent-200";
  return "bg-ink-50 text-ink-700 border-ink-200";
}

function canMutate(item: MyWorkItem): boolean {
  if (item.source === "task") return auth.canUpdateTasks;
  if (item.source === "discussion" || item.source === "communication") return auth.canAddNotes;
  return false;
}

function completionLabel(item: MyWorkItem): string {
  if (item.source === "task") return "Complete";
  if (item.source === "discussion") return "Resolve";
  return "Reviewed";
}

async function completeItem(item: MyWorkItem) {
  if (!canMutate(item) || busyKey.value) return;
  busyKey.value = item.key;
  try {
    if (item.source === "task" && item.caseId) {
      await client.updateTask(item.caseId, item.sourceId, { status: "Done" });
    } else if (item.source === "discussion") {
      await client.updateServiceDiscussionMessage(item.sourceId, { threadStatus: "resolved" });
    } else if (item.source === "communication") {
      await client.updateCommunication(item.sourceId, {
        status: item.caseId ? "Linked" : "Logged",
        followUpAssignedTo: null,
        followUpDueDate: null
      });
    }
    toasts.success(`${sourceLabel(item.source)} updated`, `${item.title} was removed from the active queue.`);
    await loadQueue();
  } catch (actionError) {
    toasts.error("Unable to update work item", actionError instanceof Error ? actionError.message : "Update failed");
  } finally {
    busyKey.value = "";
  }
}

async function reassign(item: MyWorkItem, ownerUserId: string) {
  if (!canMutate(item) || busyKey.value || (item.ownerUserId ?? "") === ownerUserId) return;
  busyKey.value = item.key;
  const assignedTo = ownerUserId || null;
  try {
    if (item.source === "task" && item.caseId) {
      await client.updateTask(item.caseId, item.sourceId, { assignedTo });
    } else if (item.source === "discussion") {
      await client.updateServiceDiscussionMessage(item.sourceId, { threadOwnerUserId: assignedTo });
    } else if (item.source === "communication") {
      await client.updateCommunication(item.sourceId, { followUpAssignedTo: assignedTo });
    }
    toasts.success("Owner updated", ownerUserId ? "The work item was reassigned." : "The work item is now unassigned.");
    await loadQueue();
  } catch (actionError) {
    toasts.error("Unable to reassign work", actionError instanceof Error ? actionError.message : "Reassignment failed");
  } finally {
    busyKey.value = "";
  }
}

watch(filters, queueReload, { deep: true });

onMounted(async () => {
  const [, loadedUsers] = await Promise.all([loadQueue(true), client.users().catch(() => [])]);
  users.value = loadedUsers;
});

onBeforeUnmount(() => {
  if (reloadTimer) clearTimeout(reloadTimer);
});
</script>

<template>
  <section class="panel overflow-hidden" aria-labelledby="my-work-heading">
    <div class="flex flex-col gap-3 border-b border-ink-200 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
      <div class="flex min-w-0 items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent-50 text-accent-800">
          <CircleAlert class="h-5 w-5" />
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h2 id="my-work-heading" class="font-semibold text-ink-950">My Work</h2>
            <span v-if="queue" class="text-xs text-ink-500">{{ queue.summary.total }} visible</span>
          </div>
          <p class="mt-0.5 text-sm text-ink-500">Assigned, unread, overdue, and time-sensitive work from the original records.</p>
        </div>
      </div>
      <button class="btn-secondary h-9 self-start px-3" type="button" :disabled="loading" title="Refresh My Work" @click="loadQueue(true)">
        <RefreshCw class="h-4 w-4" :class="loading ? 'animate-spin' : ''" />
        Refresh
      </button>
    </div>

    <div class="border-b border-ink-200 bg-ink-50/60 px-4 py-3">
      <div class="flex gap-2 overflow-x-auto pb-1" aria-label="Filter My Work by source">
        <button
          v-for="option in sourceOptions"
          :key="option.label"
          class="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition"
          :class="filters.source === option.value ? 'border-accent-700 bg-accent-700 text-white' : 'border-ink-200 bg-white text-ink-700 hover:border-accent-300'"
          type="button"
          @click="filters.source = option.value"
        >
          <component :is="option.icon" class="h-4 w-4" />
          {{ option.label }}
          <span :class="filters.source === option.value ? 'text-white/75' : 'text-ink-400'">{{ option.count }}</span>
        </button>
      </div>

      <div class="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(180px,1fr)_minmax(170px,0.8fr)_minmax(150px,0.65fr)_minmax(150px,0.65fr)_auto]">
        <label class="min-w-0">
          <span class="sr-only">Owner</span>
          <select v-model="filters.owner" class="input min-w-0">
            <option value="attention">My attention</option>
            <option value="unassigned">Unassigned</option>
            <option value="all">All staff</option>
            <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
          </select>
        </label>
        <label class="min-w-0">
          <span class="sr-only">Workflow state</span>
          <select v-model="filters.state" class="input min-w-0">
            <option v-for="option in stateOptions" :key="option.value || 'all'" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <label class="min-w-0">
          <span class="sr-only">Date from</span>
          <input v-model="filters.dateFrom" class="input min-w-0" type="date" :max="filters.dateTo || undefined" title="Relevant date from" />
        </label>
        <label class="min-w-0">
          <span class="sr-only">Date to</span>
          <input v-model="filters.dateTo" class="input min-w-0" type="date" :min="filters.dateFrom || undefined" title="Relevant date to" />
        </label>
        <button v-if="hasActiveFilters" class="btn-secondary h-10 px-3" type="button" title="Reset My Work filters" @click="resetFilters">
          <RotateCcw class="h-4 w-4" />
          Reset
        </button>
      </div>
    </div>

    <div v-if="error" class="m-4 flex flex-col gap-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <span>{{ error }}</span>
      <button class="btn-secondary h-9 border-red-200 bg-white px-3" type="button" @click="loadQueue(true)">Retry</button>
    </div>

    <div v-else-if="loading && !queue" class="divide-y divide-ink-100" aria-label="Loading My Work">
      <div v-for="index in 4" :key="index" class="grid animate-pulse gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_12rem_10rem]">
        <div class="space-y-2"><div class="h-4 w-2/3 rounded bg-ink-100"></div><div class="h-3 w-1/2 rounded bg-ink-100"></div></div>
        <div class="h-9 rounded bg-ink-100"></div>
        <div class="h-9 rounded bg-ink-100"></div>
      </div>
    </div>

    <div v-else-if="queue && !queue.items.length" class="px-4 py-10 text-center">
      <CheckCircle2 class="mx-auto h-8 w-8 text-emerald-600" />
      <h3 class="mt-3 font-semibold text-ink-950">{{ hasActiveFilters ? "No matching work" : "Queue clear" }}</h3>
      <p class="mt-1 text-sm text-ink-500">{{ hasActiveFilters ? "Adjust or reset the current filters." : "There is no assigned, overdue, unread, or time-sensitive work right now." }}</p>
      <button v-if="hasActiveFilters" class="btn-secondary mt-4 h-9 px-3" type="button" @click="resetFilters">Reset filters</button>
    </div>

    <div v-else-if="queue" class="divide-y divide-ink-100">
      <article
        v-for="item in queue.items"
        :key="item.key"
        class="grid min-w-0 gap-3 px-4 py-3 transition hover:bg-ink-50/70 xl:grid-cols-[minmax(0,1fr)_minmax(150px,0.22fr)_minmax(170px,0.25fr)_auto] xl:items-center"
      >
        <div class="flex min-w-0 items-start gap-3">
          <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-50 text-accent-800">
            <component :is="sourceIcon(item.source)" class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <span class="text-xs font-semibold uppercase text-ink-500">{{ sourceLabel(item.source) }}</span>
              <span v-for="state in item.states.filter((value) => value !== 'open').slice(0, 2)" :key="state" class="rounded-full border px-2 py-0.5 text-xs font-semibold" :class="stateClass(state)">
                {{ stateLabel(state) }}
              </span>
              <span v-if="item.priority && item.priority !== 'Normal'" class="rounded-full border border-ink-200 bg-white px-2 py-0.5 text-xs font-semibold text-ink-700">{{ item.priority }}</span>
            </div>
            <RouterLink class="mt-1 block truncate font-semibold text-ink-950 hover:text-accent-800" :to="sourcePath(item)">{{ item.title }}</RouterLink>
            <p class="mt-0.5 line-clamp-1 text-sm text-ink-500">{{ item.summary }}</p>
            <p v-if="item.caseNumber || item.caseTitle" class="mt-1 truncate text-xs text-ink-500">{{ [item.caseNumber, item.caseTitle].filter(Boolean).join(" · ") }}</p>
          </div>
        </div>

        <div class="min-w-0 text-sm">
          <p class="text-xs font-semibold uppercase text-ink-400">Relevant date</p>
          <p class="mt-1 font-medium" :class="item.states.includes('overdue') ? 'text-red-700' : 'text-ink-800'">{{ formatDate(item.relevantDate) }}</p>
        </div>

        <div class="min-w-0">
          <label v-if="canMutate(item)" class="block">
            <span class="sr-only">Owner for {{ item.title }}</span>
            <select class="input min-w-0" :value="item.ownerUserId ?? ''" :disabled="busyKey === item.key" @change="reassign(item, ($event.target as HTMLSelectElement).value)">
              <option value="">Unassigned</option>
              <option v-for="user in users" :key="user.userId" :value="user.userId">{{ user.name }}</option>
            </select>
          </label>
          <div v-else class="flex items-center gap-2 text-sm text-ink-600">
            <UserRound class="h-4 w-4" />
            <span class="truncate">{{ item.ownerScope === "shared" ? "Shared" : item.ownerUserName || "Unassigned" }}</span>
          </div>
        </div>

        <div class="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
          <button v-if="canMutate(item)" class="btn-secondary h-9 px-3" type="button" :disabled="Boolean(busyKey)" :title="`${completionLabel(item)} ${item.title}`" @click="completeItem(item)">
            <CheckCircle2 class="h-4 w-4" />
            {{ completionLabel(item) }}
          </button>
          <RouterLink class="btn-secondary h-9 px-3" :to="sourcePath(item)" :title="`Open ${sourceLabel(item.source)}`">
            <ExternalLink class="h-4 w-4" />
            Open
          </RouterLink>
        </div>
      </article>
    </div>
  </section>
</template>
