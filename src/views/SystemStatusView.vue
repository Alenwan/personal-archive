<script setup lang="ts">
import {
  Activity,
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock3,
  Cpu,
  Database,
  Files,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { client } from "../api/client";
import type { SystemStatus, SystemStatusState, SystemStatusStorageMetric } from "../shared/types";

const status = ref<SystemStatus | null>(null);
const loading = ref(true);
const refreshing = ref(false);
const errorMessage = ref("");
const autoRefreshEnabled = ref(true);
const pageVisible = ref(true);
const secondsUntilRefresh = ref(60);

const autoRefreshIntervalSeconds = 60;
const autoRefreshPreferenceKey = "personal-archive:system-status:auto-refresh";
let nextAutoRefreshAt = Date.now() + autoRefreshIntervalSeconds * 1000;
let autoRefreshTimer: number | undefined;

type RefreshMode = "initial" | "auto" | "manual";

const overallLabel = computed(() => {
  if (!status.value) return "Checking server";
  return status.value.overallStatus === "healthy" ? "All core services healthy" : "Review recommended";
});

const diskProgressStyle = computed(() => ({
  width: `${Math.min(100, Math.max(0, status.value?.disk.usagePercent ?? 0))}%`
}));

const memoryProgressStyle = computed(() => ({
  width: `${Math.min(100, Math.max(0, status.value?.memory.usagePercent ?? 0))}%`
}));

const autoRefreshLabel = computed(() => {
  if (!autoRefreshEnabled.value) return "Paused";
  if (!pageVisible.value) return "Paused in background";
  if (refreshing.value) return "Updating now";
  return `Next in ${secondsUntilRefresh.value}s`;
});

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "Unavailable";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${units[unitIndex]}`;
}

function formatDuration(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDateTime(value?: string | null): string {
  if (!value) return "No completed backup yet";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function statusLabel(value: SystemStatusState): string {
  if (value === "healthy") return "Healthy";
  if (value === "attention") return "Attention";
  return "Unavailable";
}

function storageDetail(metric: SystemStatusStorageMetric, objectLabel: string): string {
  if (metric.status !== "healthy") return "Status unavailable";
  if (metric.objectCount === null || metric.objectCount === undefined) return "Connected";
  return `${metric.objectCount.toLocaleString()} ${metric.objectCount === 1 ? objectLabel : `${objectLabel}s`}`;
}

function resetAutoRefreshDeadline() {
  nextAutoRefreshAt = Date.now() + autoRefreshIntervalSeconds * 1000;
  secondsUntilRefresh.value = autoRefreshIntervalSeconds;
}

function tickAutoRefresh() {
  if (!autoRefreshEnabled.value || !pageVisible.value) return;
  secondsUntilRefresh.value = Math.max(0, Math.ceil((nextAutoRefreshAt - Date.now()) / 1000));
  if (secondsUntilRefresh.value === 0 && !loading.value && !refreshing.value) {
    resetAutoRefreshDeadline();
    void loadStatus("auto");
  }
}

function handleVisibilityChange() {
  pageVisible.value = !document.hidden;
  if (pageVisible.value) tickAutoRefresh();
}

async function loadStatus(mode: RefreshMode = "initial") {
  if (status.value) refreshing.value = true;
  else loading.value = true;
  try {
    status.value = await client.systemStatus({ refreshStorage: mode === "manual" });
    errorMessage.value = "";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "System status is unavailable.";
  } finally {
    loading.value = false;
    refreshing.value = false;
    resetAutoRefreshDeadline();
  }
}

watch(autoRefreshEnabled, (enabled) => {
  window.localStorage.setItem(autoRefreshPreferenceKey, enabled ? "true" : "false");
  if (enabled) {
    resetAutoRefreshDeadline();
    tickAutoRefresh();
  }
});

onMounted(() => {
  autoRefreshEnabled.value = window.localStorage.getItem(autoRefreshPreferenceKey) !== "false";
  pageVisible.value = !document.hidden;
  document.addEventListener("visibilitychange", handleVisibilityChange);
  autoRefreshTimer = window.setInterval(tickAutoRefresh, 1000);
  resetAutoRefreshDeadline();
  void loadStatus();
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  if (autoRefreshTimer !== undefined) window.clearInterval(autoRefreshTimer);
});
</script>

<template>
  <section class="system-status-page">
    <header class="status-page-header">
      <div>
        <p class="status-eyebrow"><Activity /> SERVER OVERVIEW</p>
        <h1>System status</h1>
        <p>Server capacity, private storage, backups, and core service health.</p>
      </div>
      <div class="status-header-actions">
        <label class="auto-refresh-control">
          <input v-model="autoRefreshEnabled" type="checkbox" />
          <span class="auto-refresh-switch" aria-hidden="true"><span /></span>
          <span class="auto-refresh-copy"><strong>Auto refresh</strong><small>{{ autoRefreshLabel }}</small></span>
        </label>
        <span v-if="status" class="updated-at">Updated {{ formatDateTime(status.generatedAt) }}</span>
        <button type="button" :disabled="loading || refreshing" @click="loadStatus('manual')">
          <RefreshCw :class="{ spinning: refreshing }" />
          {{ refreshing ? "Refreshing…" : "Refresh" }}
        </button>
      </div>
    </header>

    <div v-if="errorMessage && status" class="status-stale-warning" role="status">
      <AlertTriangle />
      <span><strong>Latest refresh failed.</strong> Showing the last successful snapshot from {{ formatDateTime(status.generatedAt) }}.</span>
    </div>

    <div v-if="errorMessage && !status" class="status-error" role="alert">
      <AlertTriangle />
      <div>
        <strong>System status could not be loaded</strong>
        <span>{{ errorMessage }}</span>
      </div>
      <button type="button" @click="loadStatus('manual')">Try again</button>
    </div>

    <div v-else-if="loading || !status" class="status-loading" aria-live="polite">
      <RefreshCw class="spinning" /> Checking server and storage…
    </div>

    <template v-else>
      <section class="capacity-overview" :class="`is-${status.overallStatus}`">
        <div class="capacity-copy">
          <p class="overall-state">
            <CheckCircle2 v-if="status.overallStatus === 'healthy'" />
            <AlertTriangle v-else />
            {{ overallLabel }}
          </p>
          <h2>Server disk</h2>
          <p>{{ formatBytes(status.disk.availableBytes) }} available of {{ formatBytes(status.disk.totalBytes) }}</p>
        </div>
        <div class="capacity-number">
          <strong>{{ status.disk.usagePercent.toFixed(1) }}%</strong>
          <span>used</span>
        </div>
        <div class="capacity-track" aria-hidden="true"><span :style="diskProgressStyle" /></div>
        <div class="capacity-legend">
          <span>{{ formatBytes(status.disk.usedBytes) }} used</span>
          <span>Attention at 85%</span>
        </div>
      </section>

      <div class="status-detail-grid">
        <section class="status-section storage-section">
          <div class="section-heading">
            <div><HardDrive /><span><strong>Storage</strong><small>Tracked data inside Personal Archive</small></span></div>
            <small class="storage-freshness">
              <span class="storage-freshness-wide">Objects updated {{ formatDateTime(status.storage.objectUsageUpdatedAt) }}</span>
              <span class="storage-freshness-compact">Updated {{ formatTime(status.storage.objectUsageUpdatedAt) }}</span>
            </small>
          </div>
          <div class="storage-list">
            <div class="storage-row">
              <Database />
              <div><strong>PostgreSQL</strong><span>Metadata, notes, and writing</span></div>
              <div><strong>{{ formatBytes(status.storage.database.bytes) }}</strong><span>{{ statusLabel(status.storage.database.status) }}</span></div>
            </div>
            <div class="storage-row">
              <Files />
              <div><strong>Document storage</strong><span>Archive and private objects</span></div>
              <div><strong>{{ formatBytes(status.storage.documents.bytes) }}</strong><span>{{ storageDetail(status.storage.documents, "object") }}</span></div>
            </div>
            <div class="storage-row">
              <Archive />
              <div><strong>Backup storage</strong><span>Protected backup packages</span></div>
              <div><strong>{{ formatBytes(status.storage.backups.bytes) }}</strong><span>{{ storageDetail(status.storage.backups, "object") }}</span></div>
            </div>
          </div>
        </section>

        <section class="status-section runtime-section">
          <div class="section-heading">
            <div><Server /><span><strong>Runtime</strong><small>Current server resources</small></span></div>
          </div>
          <div class="runtime-grid">
            <div><Clock3 /><span>Server uptime</span><strong>{{ formatDuration(status.runtime.serverUptimeSeconds) }}</strong></div>
            <div><Activity /><span>App uptime</span><strong>{{ formatDuration(status.runtime.applicationUptimeSeconds) }}</strong></div>
            <div><Cpu /><span>CPU / 1m load</span><strong>{{ status.runtime.cpuCount }} / {{ status.runtime.loadAverage[0].toFixed(2) }}</strong></div>
            <div><MemoryStick /><span>Memory used</span><strong>{{ status.memory.usagePercent.toFixed(1) }}%</strong></div>
          </div>
          <div class="memory-meter">
            <div><span>Memory</span><strong>{{ formatBytes(status.memory.usedBytes) }} of {{ formatBytes(status.memory.totalBytes) }}</strong></div>
            <div class="memory-track" aria-hidden="true"><span :style="memoryProgressStyle" /></div>
          </div>
        </section>
      </div>

      <section class="status-section services-section">
        <div class="section-heading services-heading">
          <div><Activity /><span><strong>Core services</strong><small>Live connectivity checks</small></span></div>
          <span>{{ status.services.filter((service) => service.status === 'healthy').length }}/{{ status.services.length }} healthy</span>
        </div>
        <div class="services-list">
          <div v-for="service in status.services" :key="service.id" class="service-row">
            <span class="service-dot" :class="`is-${service.status}`" />
            <strong>{{ service.label }}</strong>
            <span>{{ service.detail }}</span>
            <em :class="`is-${service.status}`">{{ statusLabel(service.status) }}</em>
          </div>
        </div>
      </section>

      <section class="backup-summary">
        <div><Archive /><span><strong>Latest application backup</strong><small>{{ formatDateTime(status.latestBackup?.completedAt) }}</small></span></div>
        <template v-if="status.latestBackup">
          <span>{{ status.latestBackup.itemCount.toLocaleString() }} items</span>
          <span :class="status.latestBackup.failedItems ? 'has-warning' : ''">
            {{ status.latestBackup.failedItems ? `${status.latestBackup.failedItems} failed` : "No failed items" }}
          </span>
        </template>
        <span v-else>Run a backup from Backups to establish history.</span>
      </section>
    </template>
  </section>
</template>

<style scoped>
.system-status-page {
  --status-ink: var(--personal-text, #20201d);
  --status-muted: var(--personal-muted, #6a6f69);
  --status-line: var(--personal-border, #deded7);
  --status-surface: var(--personal-surface, #fff);
  --status-raised: var(--personal-surface-raised, #fff);
  --status-accent: var(--personal-accent, #397f75);
  --status-accent-strong: var(--personal-accent-strong, #245e56);
  --status-accent-soft: var(--personal-accent-soft, #dff0ec);
  width: min(100%, 96rem);
  margin: 0 auto;
  color: var(--status-ink);
}
.status-page-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 1.5rem; padding: .2rem 0 1rem; border-bottom: 1px solid var(--status-line); }
.status-eyebrow { display: flex; align-items: center; gap: .4rem; color: var(--status-accent-strong); font-size: .67rem; font-weight: 850; letter-spacing: .12em; }
.status-eyebrow svg { width: .8rem; height: .8rem; }
.status-page-header h1 { margin-top: .18rem; font-size: clamp(1.8rem, 3vw, 2.45rem); font-weight: 850; letter-spacing: -.045em; }
.status-page-header > div:first-child > p:last-child { margin-top: .16rem; color: var(--status-muted); font-size: .82rem; }
.status-header-actions { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: .65rem .8rem; color: var(--status-muted); font-size: .68rem; }
.auto-refresh-control { position: relative; display: inline-flex; align-items: center; gap: .5rem; cursor: pointer; user-select: none; }
.auto-refresh-control input { position: absolute; width: 1px; height: 1px; overflow: hidden; opacity: 0; }
.auto-refresh-switch { display: flex; width: 2rem; height: 1.12rem; align-items: center; border: 1px solid var(--status-line); border-radius: 999px; background: color-mix(in srgb, var(--status-line) 52%, transparent); padding: .12rem; transition: border-color 140ms ease, background-color 140ms ease; }
.auto-refresh-switch > span { width: .7rem; height: .7rem; border-radius: 50%; background: var(--status-raised); box-shadow: 0 1px 3px color-mix(in srgb, var(--status-ink) 24%, transparent); transition: transform 160ms ease; }
.auto-refresh-control input:checked + .auto-refresh-switch { border-color: color-mix(in srgb, var(--status-accent) 64%, var(--status-line)); background: var(--status-accent); }
.auto-refresh-control input:checked + .auto-refresh-switch > span { transform: translateX(.76rem); }
.auto-refresh-control input:focus-visible + .auto-refresh-switch { outline: 2px solid color-mix(in srgb, var(--status-accent) 45%, transparent); outline-offset: 2px; }
.auto-refresh-copy { display: grid; min-width: 4.6rem; line-height: 1.08; }
.auto-refresh-copy strong { color: var(--status-ink); font-size: .67rem; font-weight: 800; }
.auto-refresh-copy small { margin-top: .14rem; color: var(--status-muted); font-size: .58rem; }
.updated-at { white-space: nowrap; }
.status-header-actions button, .status-error button { display: inline-flex; min-height: 2.35rem; align-items: center; gap: .45rem; border: 1px solid var(--status-line); border-radius: .6rem; background: var(--status-raised); padding: 0 .8rem; color: var(--status-ink); font-size: .74rem; font-weight: 780; transition: border-color 140ms ease, background-color 140ms ease, transform 140ms ease; }
.status-header-actions button:hover:not(:disabled), .status-error button:hover { border-color: var(--status-accent); background: var(--status-accent-soft); transform: translateY(-1px); }
.status-header-actions button:disabled { cursor: wait; opacity: .62; }
.status-header-actions svg { width: .85rem; height: .85rem; }
.status-error, .status-loading { min-height: 16rem; display: flex; align-items: center; justify-content: center; gap: .75rem; color: var(--status-muted); }
.status-error { min-height: auto; justify-content: flex-start; margin-top: 1rem; border: 1px solid color-mix(in srgb, #c86a4a 46%, var(--status-line)); border-radius: .75rem; background: color-mix(in srgb, #c86a4a 9%, var(--status-surface)); padding: 1rem; }
.status-error > svg { width: 1.2rem; color: #c86a4a; }
.status-error div { display: grid; flex: 1; gap: .1rem; }
.status-error span { color: var(--status-muted); font-size: .75rem; }
.status-stale-warning { display: flex; align-items: center; gap: .5rem; margin-top: .75rem; border-left: 2px solid #b47a24; padding: .42rem .65rem; color: var(--status-muted); font-size: .67rem; }
.status-stale-warning svg { width: .85rem; height: .85rem; flex: 0 0 auto; color: #b47a24; }
.status-stale-warning strong { color: var(--status-ink); }
.status-stale-warning + .capacity-overview { margin-top: .7rem; }
.status-loading svg { width: 1rem; }
.spinning { animation: status-spin .8s linear infinite; }

.capacity-overview { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .8rem 2rem; margin-top: 1rem; border: 1px solid var(--status-line); border-radius: .9rem; background: var(--status-surface); padding: 1.15rem 1.25rem 1rem; animation: status-rise 220ms ease-out both; }
.capacity-copy h2 { margin-top: .45rem; font-size: 1.15rem; font-weight: 820; }
.capacity-copy > p:last-child { margin-top: .08rem; color: var(--status-muted); font-size: .75rem; }
.overall-state { display: inline-flex; align-items: center; gap: .38rem; color: var(--status-accent-strong); font-size: .7rem; font-weight: 800; }
.overall-state svg { width: .9rem; height: .9rem; }
.capacity-overview.is-attention .overall-state { color: #b47a24; }
.capacity-number { display: flex; align-items: baseline; align-self: center; gap: .38rem; }
.capacity-number strong { font-size: clamp(2.2rem, 5vw, 3.35rem); font-weight: 860; letter-spacing: -.065em; line-height: .9; }
.capacity-number span { color: var(--status-muted); font-size: .72rem; font-weight: 720; }
.capacity-track { grid-column: 1 / -1; height: .72rem; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--status-line) 62%, transparent); }
.capacity-track span { display: block; width: 0; height: 100%; border-radius: inherit; background: var(--status-accent); transition: width 480ms cubic-bezier(.2,.8,.2,1); }
.capacity-overview.is-attention .capacity-track span { background: #b47a24; }
.capacity-legend { grid-column: 1 / -1; display: flex; justify-content: space-between; color: var(--status-muted); font-size: .66rem; }

.status-detail-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(21rem, .85fr); gap: 1rem; margin-top: 1rem; }
.status-section { border: 1px solid var(--status-line); border-radius: .8rem; background: var(--status-surface); animation: status-rise 260ms ease-out both; }
.runtime-section { animation-delay: 35ms; }
.section-heading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; min-height: 3.5rem; padding: .75rem 1rem; border-bottom: 1px solid var(--status-line); }
.section-heading > div { display: flex; align-items: center; gap: .65rem; }
.section-heading svg { width: 1rem; height: 1rem; color: var(--status-accent-strong); }
.section-heading > div > span { display: grid; gap: .05rem; }
.section-heading strong { font-size: .82rem; font-weight: 820; }
.section-heading small { color: var(--status-muted); font-size: .64rem; }
.section-heading > .storage-freshness { text-align: right; font-size: .58rem; font-weight: 650; }
.storage-freshness-compact { display: none; }
.storage-list { padding: .15rem 1rem .25rem; }
.storage-row { display: grid; grid-template-columns: 1.65rem minmax(0, 1fr) auto; align-items: center; gap: .65rem; min-height: 4.3rem; border-bottom: 1px solid var(--status-line); }
.storage-row:last-child { border-bottom: 0; }
.storage-row > svg { width: 1rem; height: 1rem; color: var(--status-accent); }
.storage-row > div { display: grid; gap: .08rem; }
.storage-row > div:last-child { min-width: 7rem; text-align: right; }
.storage-row strong { font-size: .76rem; }
.storage-row span { color: var(--status-muted); font-size: .64rem; }
.runtime-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.runtime-grid > div { min-height: 5rem; display: grid; grid-template-columns: 1.2rem 1fr; align-content: center; gap: .1rem .45rem; padding: .7rem 1rem; border-right: 1px solid var(--status-line); border-bottom: 1px solid var(--status-line); }
.runtime-grid > div:nth-child(2n) { border-right: 0; }
.runtime-grid > div:nth-last-child(-n+2) { border-bottom: 0; }
.runtime-grid svg { grid-row: 1 / 3; width: .9rem; height: .9rem; color: var(--status-accent); }
.runtime-grid span { color: var(--status-muted); font-size: .62rem; }
.runtime-grid strong { font-size: .8rem; }
.memory-meter { display: grid; gap: .45rem; border-top: 1px solid var(--status-line); padding: .7rem 1rem .85rem; }
.memory-meter > div:first-child { display: flex; justify-content: space-between; color: var(--status-muted); font-size: .64rem; }
.memory-meter strong { color: var(--status-ink); }
.memory-track { height: .35rem; overflow: hidden; border-radius: 999px; background: color-mix(in srgb, var(--status-line) 62%, transparent); }
.memory-track span { display: block; height: 100%; border-radius: inherit; background: color-mix(in srgb, var(--status-accent) 72%, var(--status-muted)); transition: width 480ms ease; }

.services-section { margin-top: 1rem; animation-delay: 70ms; }
.services-heading > span { display: block; color: var(--status-muted); font-size: .66rem; }
.services-list { padding: 0 1rem; }
.service-row { display: grid; grid-template-columns: .6rem 10rem minmax(0, 1fr) auto; align-items: center; gap: .65rem; min-height: 3.3rem; border-bottom: 1px solid var(--status-line); }
.service-row:last-child { border-bottom: 0; }
.service-row strong { font-size: .75rem; }
.service-row > a { color: var(--status-ink); font-size: .75rem; font-weight: 780; }
.service-row > a:hover { color: var(--status-accent-strong); text-decoration: underline; }
.service-row > span:nth-child(3) { color: var(--status-muted); font-size: .68rem; }
.service-row em { border-radius: 999px; padding: .18rem .48rem; background: color-mix(in srgb, #2e9a6d 12%, transparent); color: #2e8a63; font-size: .6rem; font-style: normal; font-weight: 800; }
.service-row em.is-attention { background: color-mix(in srgb, #b47a24 14%, transparent); color: #a06a1c; }
.service-row em.is-unavailable { background: color-mix(in srgb, #b34f48 14%, transparent); color: #a1433d; }
.service-dot { width: .46rem; height: .46rem; border-radius: 50%; background: #2e9a6d; box-shadow: 0 0 0 .23rem color-mix(in srgb, #2e9a6d 13%, transparent); }
.service-dot.is-attention { background: #b47a24; box-shadow: 0 0 0 .23rem color-mix(in srgb, #b47a24 13%, transparent); }
.service-dot.is-unavailable { background: #b34f48; box-shadow: 0 0 0 .23rem color-mix(in srgb, #b34f48 13%, transparent); }

.backup-summary { display: flex; align-items: center; gap: 1rem; margin-top: 1rem; border-top: 1px solid var(--status-line); padding: 1rem .2rem .1rem; color: var(--status-muted); font-size: .68rem; animation: status-rise 300ms ease-out both; }
.backup-summary > div { min-width: 0; display: flex; flex: 1; align-items: center; gap: .65rem; }
.backup-summary svg { width: 1rem; color: var(--status-accent); }
.backup-summary div span { display: grid; }
.backup-summary strong { color: var(--status-ink); font-size: .76rem; }
.backup-summary small { color: var(--status-muted); }
.backup-summary > span { white-space: nowrap; }
.backup-summary .has-warning { color: #b47a24; font-weight: 780; }

@keyframes status-spin { to { transform: rotate(360deg); } }
@keyframes status-rise { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) {
  .capacity-overview, .status-section, .backup-summary { animation: none; }
  .capacity-track span, .memory-track span, .auto-refresh-switch, .auto-refresh-switch > span { transition: none; }
}
@media (max-width: 900px) {
  .status-detail-grid { grid-template-columns: 1fr; }
  .service-row { grid-template-columns: .6rem 8rem minmax(0, 1fr) auto; }
}
@media (max-width: 640px) {
  .status-page-header { align-items: flex-start; flex-direction: column; }
  .status-header-actions { width: 100%; justify-content: flex-start; }
  .status-header-actions button { margin-left: auto; }
  .updated-at { order: 3; width: 100%; }
  .storage-freshness-wide { display: none; }
  .storage-freshness-compact { display: block; white-space: nowrap; }
  .capacity-overview { grid-template-columns: 1fr; }
  .capacity-number { grid-row: 2; }
  .capacity-track, .capacity-legend { grid-column: 1; }
  .service-row { grid-template-columns: .6rem minmax(0, 1fr) auto; padding: .55rem 0; }
  .service-row > span:nth-child(3) { grid-column: 2 / -1; }
  .backup-summary { align-items: flex-start; flex-wrap: wrap; }
}
</style>
