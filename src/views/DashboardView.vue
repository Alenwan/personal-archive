<script setup lang="ts">
import { Activity, CalendarClock, FileUp, FolderKanban } from "lucide-vue-next";
import { onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { client } from "../api/client";
import { useBusinessTemplate, workItemPath } from "../businessTemplate";
import MyWorkQueue from "../components/dashboard/MyWorkQueue.vue";
import PageHeader from "../components/PageHeader.vue";
import StatusBadge from "../components/StatusBadge.vue";
import { useI18n } from "../i18n";
import { formatDate, formatDateTime } from "../shared/format";
import type { DashboardStats } from "../shared/types";

const { t } = useI18n();
const { labels } = useBusinessTemplate();
const stats = ref<DashboardStats | null>(null);
const statsError = ref("");

async function loadStats() {
  statsError.value = "";
  try {
    stats.value = await client.dashboard();
  } catch (error) {
    statsError.value = error instanceof Error ? error.message : "Unable to load Dashboard totals.";
  }
}

onMounted(loadStats);
</script>

<template>
  <PageHeader
    eyebrow="Operations"
    :title="t('dashboard')"
    :description="`A current view of ${labels.lowerPlural}, upcoming target dates, recent document activity, and status distribution.`"
  />

  <div class="flex flex-col gap-3">
    <section v-if="stats" class="order-2 grid grid-cols-2 gap-3 md:order-1 md:grid-cols-4">
      <div class="panel p-4 md:p-5">
        <div class="mb-2 flex items-start justify-between gap-2 md:mb-4">
          <p class="text-sm font-medium text-ink-500">Total {{ labels.lowerPlural }}</p>
          <FolderKanban class="h-5 w-5 shrink-0 text-accent-700" />
        </div>
        <p class="text-2xl font-semibold md:text-3xl">{{ stats.totalCases }}</p>
      </div>
      <div class="panel p-4 md:p-5">
        <div class="mb-2 flex items-start justify-between gap-2 md:mb-4">
          <p class="text-sm font-medium text-ink-500">Active {{ labels.lowerPlural }}</p>
          <Activity class="h-5 w-5 shrink-0 text-legal-green" />
        </div>
        <p class="text-2xl font-semibold md:text-3xl">{{ stats.activeCases }}</p>
      </div>
      <div class="panel p-4 md:p-5">
        <div class="mb-2 flex items-start justify-between gap-2 md:mb-4">
          <p class="text-sm font-medium text-ink-500">{{ labels.targetDateLabel }} soon</p>
          <CalendarClock class="h-5 w-5 shrink-0 text-legal-red" />
        </div>
        <p class="text-2xl font-semibold md:text-3xl">{{ stats.closingSoon }}</p>
      </div>
      <div class="panel p-4 md:p-5">
        <div class="mb-2 flex items-start justify-between gap-2 md:mb-4">
          <p class="text-sm font-medium text-ink-500">Pending {{ labels.lowerPlural }}</p>
          <FileUp class="h-5 w-5 shrink-0 text-legal-gold" />
        </div>
        <p class="text-2xl font-semibold md:text-3xl">{{ stats.pendingCases }}</p>
      </div>
    </section>
    <section v-else-if="statsError" class="panel order-2 flex flex-col gap-3 border-red-200 bg-red-50 p-4 text-sm text-red-900 md:order-1 sm:flex-row sm:items-center sm:justify-between" role="alert">
      <span>{{ statsError }}</span>
      <button class="btn-secondary h-9 border-red-200 bg-white px-3" type="button" @click="loadStats">Retry totals</button>
    </section>
    <section v-else class="order-2 grid grid-cols-2 gap-3 md:order-1 md:grid-cols-4" aria-label="Loading Dashboard totals">
      <div v-for="index in 4" :key="index" class="panel animate-pulse p-4 md:p-5">
        <div class="mb-3 h-4 w-2/3 rounded bg-ink-100"></div>
        <div class="h-8 w-12 rounded bg-ink-100"></div>
      </div>
    </section>

    <MyWorkQueue class="order-1 md:order-2" />

    <section v-if="stats" class="order-3 grid min-w-0 gap-3 xl:grid-cols-[1.4fr_0.9fr]">
      <div class="panel min-w-0 overflow-hidden">
        <div class="border-b border-ink-200 px-5 py-4">
          <h2 class="font-semibold">{{ t("recentlyUpdated") }}</h2>
        </div>
        <div class="overflow-x-auto">
          <table class="min-w-[820px] w-full text-left text-sm">
            <thead class="bg-ink-50 text-xs uppercase text-ink-500">
              <tr>
                <th class="px-5 py-3">{{ labels.singular }}</th>
                <th class="px-5 py-3">{{ labels.locationSummaryLabel }}</th>
                <th class="px-5 py-3">{{ t("status") }}</th>
                <th class="px-5 py-3">{{ labels.targetDateLabel }}</th>
                <th class="px-5 py-3">{{ t("updated") }}</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-ink-100">
              <tr v-for="caseRecord in stats.recentlyUpdatedCases" :key="caseRecord.caseId" class="hover:bg-ink-50">
                <td class="px-5 py-4 font-semibold">
                  <RouterLink class="text-accent-700 hover:text-accent-900" :to="workItemPath(caseRecord.caseId)">
                    {{ caseRecord.caseNumber }}
                  </RouterLink>
                </td>
                <td class="px-5 py-4">
                  <p class="font-medium">{{ caseRecord.propertyAddress }}</p>
                  <p class="text-xs text-ink-500">{{ caseRecord.city }}, {{ caseRecord.state }}</p>
                </td>
                <td class="px-5 py-4"><StatusBadge :status="caseRecord.status" /></td>
                <td class="px-5 py-4">{{ formatDate(caseRecord.closingDate) }}</td>
                <td class="px-5 py-4 text-ink-500">{{ formatDateTime(caseRecord.updatedAt) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="min-w-0 space-y-3">
        <div class="panel p-5">
          <h2 class="mb-4 font-semibold">{{ labels.plural }} by status</h2>
          <div class="space-y-3">
            <div v-for="item in stats.casesByStatus" :key="item.status" class="flex items-center justify-between">
              <StatusBadge :status="item.status" />
              <span class="font-semibold">{{ item.count }}</span>
            </div>
          </div>
        </div>

        <div class="panel p-5">
          <h2 class="mb-4 font-semibold">{{ t("recentUploads") }}</h2>
          <div class="space-y-4">
            <div v-for="doc in stats.recentUploads" :key="doc.documentId" class="border-b border-ink-100 pb-3 last:border-0">
              <p class="truncate text-sm font-semibold">{{ doc.originalFileName }}</p>
              <p class="mt-1 text-xs text-ink-500">{{ doc.category }} · {{ formatDateTime(doc.uploadedAt) }}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
