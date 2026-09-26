<script setup lang="ts">
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FileArchive,
  Play,
  RefreshCw
} from "lucide-vue-next";
import { computed, onMounted, ref, watch } from "vue";
import { client } from "../api/client";
import { useBusinessTemplate } from "../businessTemplate";
import PageHeader from "../components/PageHeader.vue";
import { useI18n } from "../i18n";
import type {
  BackupDestination,
  BackupRun,
  BackupRunRequest,
  BackupRunStatus,
  BackupScope,
  BackupSettings,
  DatabaseRecoveryStatus,
  DatabaseSnapshotListResult,
  DatabaseTableExportResult
} from "../shared/types";
import { useAuthStore } from "../stores/auth";

const DEFAULT_BACKUP_JOB_ID = "80000000-0000-4000-8000-000000000001";

const defaultSettings: BackupSettings = {
  backupJobId: DEFAULT_BACKUP_JOB_ID,
  name: "Primary backup plan",
  destination: "r2-manifest",
  schedule: "daily",
  scope: "all-cases",
  includeMetadata: true,
  includeDocuments: true,
  includeAuditLogs: true,
  includeRelationshipMap: true,
  folderByCaseAndCategory: true,
  checksumManifest: true,
  isEnabled: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  updatedBy: null,
  updatedByName: null
};

type StatusMessageTone = "running" | "warning" | "success";
type BackupTabId = "case-files" | "database";

const destinationOptions: BackupDestination[] = ["r2-manifest", "google-drive", "manual-export"];
const scopeOptions: BackupScope[] = ["all-cases", "closed-cases", "updated-since-last-run"];
const { t } = useI18n();
const { labels } = useBusinessTemplate();
const auth = useAuthStore();
const loading = ref(true);
const running = ref(false);
const runningMode = ref<"dry-run" | "backup" | null>(null);
const creatingDatabaseSnapshot = ref(false);
const creatingDatabaseTableExport = ref(false);
const errorMessage = ref("");
const statusMessage = ref("");
const databaseSnapshotMessage = ref("");
const databaseSnapshotError = ref("");
const databaseTableExportMessage = ref("");
const databaseTableExportError = ref("");
const activeTab = ref<BackupTabId>("case-files");
const settings = ref<BackupSettings>({ ...defaultSettings });
const runs = ref<BackupRun[]>([]);
const databaseRecovery = ref<DatabaseRecoveryStatus | null>(null);
const databaseSnapshots = ref<DatabaseSnapshotListResult | null>(null);
const latestDatabaseTableExport = ref<DatabaseTableExportResult | null>(null);
const backupTabs = computed<{ id: BackupTabId; label: string }[]>(() => [
  { id: "case-files", label: `${labels.value.singular} Files & Records` },
  { id: "database", label: "Database Restore Points" }
]);

const currentDestinationLabel = computed(() => labelForDestination(settings.value.destination));
const currentScopeLabel = computed(() => labelForScope(settings.value.scope));
const currentEnabledIncludes = computed(() =>
  [
    settings.value.includeMetadata ? "Metadata" : "",
    settings.value.includeDocuments ? "Documents" : "",
    settings.value.includeAuditLogs ? "Audit logs" : "",
    settings.value.includeRelationshipMap ? "Relationship map" : ""
  ].filter(Boolean)
);
const currentArchiveRules = computed(() =>
  [
    settings.value.folderByCaseAndCategory ? `Folder by ${labels.value.lowerSingular} and category` : "",
    settings.value.checksumManifest ? "Checksum manifest" : ""
  ].filter(Boolean)
);
const hasSelectedBackupContent = computed(() => currentEnabledIncludes.value.length > 0);
const latestRun = computed(() => runs.value[0] ?? null);
const latestManifestRun = computed(() => runs.value.find((run) => Boolean(run.manifestObjectKey)) ?? null);
const statusMessageTone = computed<StatusMessageTone>(() => {
  if (running.value) return "running";
  const lowerMessage = statusMessage.value.toLowerCase();
  if (lowerMessage.includes("failed") || lowerMessage.includes("needs review")) return "warning";
  return "success";
});
const statusMessageClass = computed(() => {
  const classes: Record<StatusMessageTone, string> = {
    running: "border-blue-200 bg-blue-50 text-blue-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    success: "border-emerald-200 bg-emerald-50 text-emerald-800"
  };
  return classes[statusMessageTone.value];
});
const actualBackupDestinationSupported = computed(() => settings.value.destination === "r2-manifest");
const actualBackupButtonLabel = computed(() => {
  if (settings.value.destination === "r2-manifest") return "Run secure backup now";
  return "Run backup";
});
const actualBackupButtonTitle = computed(() => {
  if (!auth.canManageBackups) return "Only Admin can run backups";
  if (!hasSelectedBackupContent.value) return "Select at least one backup content type";
  if (settings.value.destination === "google-drive") return "Google Drive backup is not configured for this workspace yet";
  if (settings.value.destination === "r2-manifest") return "Create a real backup package in the private backup area";
  return "Manual export package is not implemented yet";
});
const backupHealth = computed(() => {
  if (running.value) {
    return runningMode.value === "dry-run" ? "Readiness check running" : "Backup running";
  }
  if (!latestRun.value) return "No run yet";
  if (latestRun.value.status === "failed" || latestRun.value.failedItems > 0) return "Needs review";
  if (latestRun.value.status === "attention") return "Needs review";
  if (latestRun.value.status === "dry-run") return "Readiness checked";
  return "Ready";
});
const databaseRecoveryConnectionLabel = computed(() => {
  if (!databaseRecovery.value) return "Loading";
  if (databaseRecovery.value.connected) return "Connected";
  if (databaseRecovery.value.configured) return "Needs attention";
  return "Not configured";
});
const databaseRecoveryConnectionClass = computed(() => {
  if (!databaseRecovery.value) return "bg-ink-50 text-ink-600";
  if (databaseRecovery.value.connected) return "bg-emerald-50 text-emerald-700";
  if (databaseRecovery.value.configured) return "bg-amber-50 text-amber-700";
  return "bg-ink-50 text-ink-600";
});
const visibleDatabaseSnapshots = computed(() => databaseSnapshots.value?.snapshots.slice(0, 5) ?? []);
const latestDatabaseSnapshot = computed(() => databaseSnapshots.value?.snapshots[0] ?? null);
const databaseSnapshotLimitReached = computed(() => {
  const message = databaseSnapshotError.value.toLowerCase();
  return message.includes("snapshot limit") || message.includes("snapshots_limit_exceeded");
});
const canCreateDatabaseSnapshot = computed(
  () => auth.canManageBackups && Boolean(databaseRecovery.value?.connected) && !creatingDatabaseSnapshot.value && !databaseSnapshotLimitReached.value
);
const databaseSnapshotButtonTitle = computed(() => {
  if (!auth.canManageBackups) return "Only Admin can create database restore points";
  if (!databaseRecovery.value?.connected) return "Connect the database recovery service before creating restore points";
  if (databaseSnapshotLimitReached.value) return "Restore point limit reached. Delete an older restore point first.";
  return "Create a database restore point";
});
const canCreateDatabaseTableExport = computed(() => auth.canManageBackups && !creatingDatabaseTableExport.value);

function labelForDestination(value: BackupDestination) {
  if (value === "google-drive") return "Google Drive archive";
  if (value === "r2-manifest") return "Secure backup package";
  return "Manual export package";
}

function isBackupDestinationDisabled(value: BackupDestination) {
  return value !== "r2-manifest";
}

function backupDestinationUnavailableReason(value: BackupDestination) {
  if (value === "google-drive") return "Not configured for this workspace";
  if (value === "manual-export") return "Planning option only";
  return "";
}

function labelForScope(value: BackupScope) {
  if (value === "all-cases") return `All ${labels.value.lowerPlural}`;
  if (value === "closed-cases") return `Closed ${labels.value.lowerPlural}`;
  return "Updated since last run";
}

function labelForStatus(value: BackupRunStatus) {
  if (value === "completed") return "Completed";
  if (value === "dry-run") return "Readiness checked";
  if (value === "failed") return "Failed";
  return "Needs review";
}

function labelForMode(run: Pick<BackupRun, "mode" | "destination">) {
  if (run.mode === "r2-manifest") return "Secure package backup";
  if (run.mode === "dry-run") return "Readiness check";
  if (run.destination === "google-drive") return "Google Drive backup";
  return "Planned integration";
}

function statusClass(value: BackupRunStatus) {
  if (value === "completed") return "bg-emerald-50 text-emerald-700";
  if (value === "dry-run") return "bg-blue-50 text-blue-700";
  if (value === "failed") return "bg-red-50 text-red-700";
  return "bg-amber-50 text-amber-700";
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not completed";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "Size pending";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function displayRestorePointName(value?: string | null) {
  return (value || "Manual restore point").replace(/snapshot/gi, "restore point");
}

function backupRunSettings(source: BackupSettings = settings.value): Omit<BackupRunRequest, "dryRun"> {
  return {
    destination: source.destination,
    scope: source.scope,
    includeMetadata: source.includeMetadata,
    includeDocuments: source.includeDocuments,
    includeAuditLogs: source.includeAuditLogs,
    includeRelationshipMap: source.includeRelationshipMap,
    folderByCaseAndCategory: source.folderByCaseAndCategory,
    checksumManifest: source.checksumManifest
  };
}

function backupRunRequest(dryRun: boolean): BackupRunRequest {
  return {
    dryRun,
    ...backupRunSettings()
  };
}

function confirmBackupRun(): boolean {
  const lines = [
    "Run this backup now?",
    "",
    `Destination: ${currentDestinationLabel.value}`,
    `Scope: ${currentScopeLabel.value}`,
    `Includes: ${currentEnabledIncludes.value.join(", ") || "Nothing selected"}`,
    `Archive rules: ${currentArchiveRules.value.join(", ") || "None"}`,
    "",
    "This will create backup files and a manifest. Continue?"
  ];
  return window.confirm(lines.join("\n"));
}

function fallbackDatabaseRecoveryStatus(error: unknown): DatabaseRecoveryStatus {
  return {
    provider: "managed-database",
    configured: false,
    connected: false,
    source: "local-config",
    checkedAt: new Date().toISOString(),
    message: "Database recovery status could not be loaded.",
    missingEnv: [],
    error: error instanceof Error ? error.message : "Unable to load database recovery status."
  };
}

function fallbackDatabaseSnapshots(error: unknown): DatabaseSnapshotListResult {
  return {
    provider: "managed-database",
    configured: false,
    connected: false,
    snapshots: [],
    checkedAt: new Date().toISOString(),
    message: "Database restore points could not be loaded.",
    missingEnv: [],
    error: error instanceof Error ? error.message : "Unable to load database restore points."
  };
}

function friendlyDatabaseSnapshotError(error: unknown): string {
  const message = error instanceof Error ? error.message : "Failed to create database restore point.";
  if (message.includes("SNAPSHOTS_LIMIT_EXCEEDED") || message.toLowerCase().includes("snapshot limit")) {
    return "Restore point limit reached. This database can only keep a limited number of manual restore points. Delete an older restore point in the database admin console, or upgrade the database plan, before creating another one.";
  }
  return message.replaceAll("Neon", "Database recovery service").replaceAll("PostgreSQL", "database");
}

async function refreshDatabaseRecoveryData() {
  const [recoveryStatus, snapshotList] = await Promise.all([
    client.databaseRecoveryStatus().catch(fallbackDatabaseRecoveryStatus),
    client.databaseSnapshots().catch(fallbackDatabaseSnapshots)
  ]);
  databaseRecovery.value = recoveryStatus;
  databaseSnapshots.value = snapshotList;
}

async function loadBackups() {
  loading.value = true;
  errorMessage.value = "";
  try {
    const [loadedSettings, loadedRuns, recoveryStatus, snapshotList] = await Promise.all([
      client.backupSettings(),
      client.backupRuns(20),
      client.databaseRecoveryStatus().catch(fallbackDatabaseRecoveryStatus),
      client.databaseSnapshots().catch(fallbackDatabaseSnapshots)
    ]);
    settings.value = loadedSettings;
    runs.value = loadedRuns;
    databaseRecovery.value = recoveryStatus;
    databaseSnapshots.value = snapshotList;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Failed to load backup center.";
  } finally {
    loading.value = false;
  }
}

async function createSnapshot() {
  if (!canCreateDatabaseSnapshot.value) return;
  const confirmed = window.confirm(
    "Create a database restore point for the current workspace? This creates a recovery point only; it will not restore or delete any data."
  );
  if (!confirmed) return;

  creatingDatabaseSnapshot.value = true;
  databaseSnapshotMessage.value = "";
  databaseSnapshotError.value = "";
  try {
    const result = await client.createDatabaseSnapshot();
    databaseSnapshotMessage.value = `${displayRestorePointName(result.snapshotName)} was requested successfully. It may take a short time to appear.`;
    await refreshDatabaseRecoveryData();
  } catch (error) {
    databaseSnapshotError.value = friendlyDatabaseSnapshotError(error);
    await refreshDatabaseRecoveryData();
  } finally {
    creatingDatabaseSnapshot.value = false;
  }
}

async function createDatabaseTableExport() {
  if (!canCreateDatabaseTableExport.value) return;
  const confirmed = window.confirm(
    "Export current business records to a private JSON archive? This creates an offline backup copy, but it is not a one-click restore."
  );
  if (!confirmed) return;

  creatingDatabaseTableExport.value = true;
  databaseTableExportMessage.value = "";
  databaseTableExportError.value = "";
  latestDatabaseTableExport.value = null;
  try {
    const result = await client.createDatabaseTableExport();
    latestDatabaseTableExport.value = result;
    databaseTableExportMessage.value = `${result.rowCount} records across ${result.tableCount} data groups were exported to the private backup area.`;
  } catch (error) {
    databaseTableExportError.value = error instanceof Error ? error.message : "Failed to export business records.";
  } finally {
    creatingDatabaseTableExport.value = false;
  }
}

function downloadDatabaseTableExport() {
  if (!latestDatabaseTableExport.value) return;
  window.location.href = latestDatabaseTableExport.value.downloadUrl;
}

async function runBackup(dryRun: boolean) {
  if (!auth.canManageBackups || !hasSelectedBackupContent.value) return;
  if (!dryRun) {
    if (!actualBackupDestinationSupported.value) return;
    if (!confirmBackupRun()) return;
  }
  running.value = true;
  runningMode.value = dryRun ? "dry-run" : "backup";
  errorMessage.value = "";
  const activeDestination = currentDestinationLabel.value;
  statusMessage.value = dryRun
    ? "Readiness check is validating the selected scope and contents. No backup files are being written."
    : `${activeDestination} backup is running. Metadata, manifest, and selected document files are being packaged now.`;
  try {
    const run = await client.runBackup(backupRunRequest(dryRun));
    runs.value = [run, ...runs.value.filter((item) => item.backupRunId !== run.backupRunId)].slice(0, 20);
    if (dryRun) {
      statusMessage.value = "Readiness check completed. No backup files were written.";
    } else if (run.destination === "google-drive") {
      statusMessage.value = "Google Drive backup package created and recorded in the database.";
    } else if (run.destination === "r2-manifest") {
      statusMessage.value = "Secure backup package created and recorded in the database.";
    } else {
      statusMessage.value = "Backup manifest recorded in the database.";
    }
  } catch (error) {
    statusMessage.value = "";
    errorMessage.value = error instanceof Error ? error.message : "Failed to run backup.";
  } finally {
    running.value = false;
    runningMode.value = null;
  }
}

function downloadLatestManifest() {
  if (!latestManifestRun.value) return;
  window.location.href = client.backupManifestUrl(latestManifestRun.value.backupRunId);
}

function downloadManifest(run: BackupRun) {
  window.location.href = client.backupManifestUrl(run.backupRunId);
}

onMounted(() => {
  void loadBackups();
});

watch(
  () => JSON.stringify(backupRunSettings()),
  () => {
    statusMessage.value = "";
    errorMessage.value = "";
  }
);
</script>

<template>
  <PageHeader
    eyebrow="Archive and continuity"
    :title="t('backups')"
    :description="`Protect ${labels.lowerSingular} files, business records, and database restore points from one admin screen.`"
  >
    <div class="flex flex-wrap gap-2">
      <button class="btn-secondary" type="button" :disabled="!latestManifestRun" @click="downloadLatestManifest">
        <Download class="h-4 w-4" />
        Download latest manifest
      </button>
    </div>
  </PageHeader>

  <div v-if="errorMessage && activeTab === 'database'" class="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">
    {{ errorMessage }}
  </div>

  <section class="mb-3 grid gap-3 xl:grid-cols-4">
    <div class="panel p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <p class="text-xs font-semibold uppercase text-ink-500">Backup health</p>
          <p class="mt-2 text-2xl font-semibold">{{ backupHealth }}</p>
        </div>
        <RefreshCw v-if="running" class="h-5 w-5 animate-spin text-blue-700" />
        <CheckCircle2 v-else-if="backupHealth === 'Ready'" class="h-5 w-5 text-emerald-700" />
        <AlertTriangle v-else class="h-5 w-5 text-amber-700" />
      </div>
      <p class="mt-3 text-sm text-ink-500">
        Latest run: {{ running ? "In progress" : latestRun ? formatDateTime(latestRun.completedAt) : "None" }}
      </p>
    </div>

    <div class="panel p-4">
      <p class="text-xs font-semibold uppercase text-ink-500">Latest file package</p>
      <div class="mt-3 flex items-center gap-3">
        <FileArchive class="h-5 w-5 text-accent-700" />
        <p class="font-semibold">{{ latestManifestRun ? labelForDestination(latestManifestRun.destination) : "No package yet" }}</p>
      </div>
      <p class="mt-3 text-sm text-ink-500">
        {{ latestManifestRun ? `Created ${formatDateTime(latestManifestRun.completedAt)}` : "Run a manual backup to create the first manifest." }}
      </p>
    </div>

    <div class="panel p-4">
      <p class="text-xs font-semibold uppercase text-ink-500">Latest restore point</p>
      <div class="mt-3 flex items-center gap-3">
        <Database class="h-5 w-5 text-accent-700" />
        <p class="font-semibold">{{ latestDatabaseSnapshot ? "Restore point available" : databaseRecoveryConnectionLabel }}</p>
      </div>
      <p class="mt-3 text-sm text-ink-500">
        {{ latestDatabaseSnapshot?.createdAt ? formatDateTime(latestDatabaseSnapshot.createdAt) : "Create a database restore point before major testing." }}
      </p>
    </div>

    <div class="panel p-4">
      <p class="text-xs font-semibold uppercase text-ink-500">Primary storage</p>
      <div class="mt-3 flex items-center gap-3">
        <Cloud class="h-5 w-5 text-accent-700" />
        <p class="font-semibold">Private file storage</p>
      </div>
      <p class="mt-3 text-sm text-ink-500">Private files and manual backup packages stay in protected storage for this workspace.</p>
    </div>
  </section>

  <div class="mb-5 overflow-x-auto border-b border-ink-200">
    <nav class="flex min-w-max gap-1">
      <button
        v-for="tab in backupTabs"
        :key="tab.id"
        class="border-b-2 px-3 py-2 text-sm font-semibold transition"
        :class="activeTab === tab.id ? 'border-accent-700 text-accent-800' : 'border-transparent text-ink-500 hover:text-ink-900'"
        type="button"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>
  </div>

  <section v-if="activeTab === 'case-files'" class="space-y-5">
    <section class="panel overflow-hidden">
      <div class="border-b border-ink-200 px-5 py-4">
        <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 class="font-semibold">Create a file and record backup</h2>
            <p class="mt-1 text-sm text-ink-500">
              Choose the destination, scope, and contents for this manual run. Nothing is saved as a hidden plan.
            </p>
          </div>
          <span class="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Current selection
          </span>
        </div>
      </div>

      <div class="space-y-3 p-4">
        <div>
          <div class="flex items-baseline gap-2">
            <span class="text-xs font-semibold uppercase text-accent-800">Step 1</span>
            <label class="text-sm font-semibold">Choose backup destination</label>
          </div>
          <div class="mt-3 grid gap-2 md:grid-cols-3">
            <label
              v-for="destination in destinationOptions"
              :key="destination"
              class="rounded-md border p-3 text-sm transition"
              :class="[
                settings.destination === destination ? 'border-accent-500 bg-accent-50' : 'border-ink-200 bg-white',
                isBackupDestinationDisabled(destination) ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:border-ink-300'
              ]"
            >
              <input
                v-model="settings.destination"
                class="sr-only"
                type="radio"
                :value="destination"
                :disabled="!auth.canManageBackups || running || isBackupDestinationDisabled(destination)"
              />
              <span class="flex items-center justify-between gap-2">
                <span class="font-semibold">{{ labelForDestination(destination) }}</span>
                <span
                  v-if="backupDestinationUnavailableReason(destination)"
                  class="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-semibold text-ink-500"
                >
                  Disabled
                </span>
              </span>
              <span class="mt-1 block text-xs text-ink-500">
                {{
                  destination === "r2-manifest"
                    ? "Private backup package."
                    : destination === "google-drive"
                      ? backupDestinationUnavailableReason(destination)
                      : "Records an export plan only."
                }}
              </span>
            </label>
          </div>
        </div>

        <div class="grid gap-3 lg:grid-cols-[0.8fr_1.2fr]">
          <label class="block">
            <span class="text-xs font-semibold uppercase text-accent-800">Step 2</span>
            <span class="mt-1 block text-sm font-semibold">Choose scope</span>
            <select v-model="settings.scope" class="input mt-2" :disabled="!auth.canManageBackups || running">
              <option v-for="scope in scopeOptions" :key="scope" :value="scope">
                {{ labelForScope(scope) }}
              </option>
            </select>
          </label>

          <div class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
            Automatic scheduling is separate. This workspace currently runs manual backups only; local deployment can add timed backup jobs later.
          </div>
        </div>

        <fieldset>
          <legend>
            <span class="text-xs font-semibold uppercase text-accent-800">Step 3</span>
            <span class="mt-1 block text-sm font-semibold">Choose what to include</span>
          </legend>
          <div class="mt-3 grid gap-2 md:grid-cols-2">
            <label class="flex items-center gap-3 rounded-md border border-ink-200 p-3 text-sm">
              <input v-model="settings.includeMetadata" class="h-4 w-4" type="checkbox" :disabled="!auth.canManageBackups || running" />
              {{ labels.singular }} metadata
            </label>
            <label class="flex items-center gap-3 rounded-md border border-ink-200 p-3 text-sm">
              <input v-model="settings.includeDocuments" class="h-4 w-4" type="checkbox" :disabled="!auth.canManageBackups || running" />
              Document file copies
            </label>
            <label class="flex items-center gap-3 rounded-md border border-ink-200 p-3 text-sm">
              <input v-model="settings.includeAuditLogs" class="h-4 w-4" type="checkbox" :disabled="!auth.canManageBackups || running" />
              Audit logs
            </label>
            <label class="flex items-center gap-3 rounded-md border border-ink-200 p-3 text-sm">
              <input v-model="settings.includeRelationshipMap" class="h-4 w-4" type="checkbox" :disabled="!auth.canManageBackups || running" />
              Relationship map
            </label>
          </div>
          <p v-if="!hasSelectedBackupContent" class="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-800">
            Select at least one content type before checking or running a backup.
          </p>
        </fieldset>

        <fieldset>
          <legend class="text-sm font-semibold">Archive rules</legend>
          <div class="mt-2 grid gap-2 md:grid-cols-2">
            <label class="flex items-center gap-3 rounded-md border border-ink-200 p-3 text-sm">
              <input v-model="settings.folderByCaseAndCategory" class="h-4 w-4" type="checkbox" :disabled="!auth.canManageBackups || running" />
              Folder by {{ labels.lowerSingular }} and category
            </label>
            <label class="flex items-center gap-3 rounded-md border border-ink-200 p-3 text-sm">
              <input v-model="settings.checksumManifest" class="h-4 w-4" type="checkbox" :disabled="!auth.canManageBackups || running" />
              Include checksum manifest
            </label>
          </div>
        </fieldset>

        <div class="rounded-md border border-ink-200 bg-ink-50 p-4">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div class="flex items-baseline gap-2">
                <span class="text-xs font-semibold uppercase text-accent-800">Step 4</span>
                <h3 class="font-semibold">Review and run</h3>
              </div>
              <dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <dt class="text-ink-500">Destination</dt>
                  <dd class="mt-1 font-semibold">{{ currentDestinationLabel }}</dd>
                </div>
                <div>
                  <dt class="text-ink-500">Scope</dt>
                  <dd class="mt-1 font-semibold">{{ currentScopeLabel }}</dd>
                </div>
                <div>
                  <dt class="text-ink-500">Includes</dt>
                  <dd class="mt-1 font-semibold">{{ currentEnabledIncludes.join(", ") || "Nothing selected" }}</dd>
                </div>
                <div>
                  <dt class="text-ink-500">Rules</dt>
                  <dd class="mt-1 font-semibold">{{ currentArchiveRules.join(", ") || "None" }}</dd>
                </div>
              </dl>
            </div>

            <div class="flex shrink-0 flex-wrap gap-2">
              <button
                class="btn-secondary"
                type="button"
                :disabled="!auth.canManageBackups || running || !hasSelectedBackupContent"
                :title="auth.canManageBackups ? 'Check backup readiness without writing files' : 'Only Admin can run backups'"
                @click="runBackup(true)"
              >
                <RefreshCw v-if="running && runningMode === 'dry-run'" class="h-4 w-4 animate-spin" />
                <Play v-else class="h-4 w-4" />
                Check readiness
              </button>
              <button
                class="btn-primary"
                type="button"
                :disabled="!auth.canManageBackups || running || !hasSelectedBackupContent || !actualBackupDestinationSupported"
                :title="actualBackupButtonTitle"
                @click="runBackup(false)"
              >
                <RefreshCw v-if="running && runningMode === 'backup'" class="h-4 w-4 animate-spin" />
                <FileArchive v-else class="h-4 w-4" />
                {{ actualBackupButtonLabel }}
              </button>
            </div>
          </div>

          <p v-if="!actualBackupDestinationSupported" class="mt-4 rounded-md border border-amber-200 bg-white p-3 text-sm font-semibold text-amber-800">
            Choose the secure backup package to create real backup files from this screen. Other destinations can be enabled after configuration.
          </p>
          <div v-if="statusMessage" class="mt-4 flex items-start gap-2 rounded-md border bg-white p-3 text-sm font-semibold" :class="statusMessageClass">
            <RefreshCw v-if="statusMessageTone === 'running'" class="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
            <CheckCircle2 v-else-if="statusMessageTone === 'success'" class="mt-0.5 h-4 w-4 shrink-0" />
            <AlertTriangle v-else class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ statusMessage }}</span>
          </div>
          <div v-else-if="errorMessage" class="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-white p-3 text-sm font-semibold text-red-700">
            <AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
            <span>{{ errorMessage }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="panel overflow-hidden">
      <div class="border-b border-ink-200 px-5 py-4">
        <h2 class="font-semibold">Backup history</h2>
        <p class="mt-1 text-sm text-ink-500">Completed runs, readiness checks, and downloadable manifests.</p>
      </div>
      <div class="overflow-x-auto">
        <table class="min-w-[1080px] w-full text-left text-sm">
          <thead class="bg-ink-50 text-xs uppercase text-ink-500">
            <tr>
              <th class="px-5 py-3">Status</th>
              <th class="px-5 py-3">Destination</th>
              <th class="px-5 py-3">Scope</th>
              <th class="px-5 py-3">Completed</th>
              <th class="px-5 py-3">{{ labels.plural }}</th>
              <th class="px-5 py-3">Documents</th>
              <th class="px-5 py-3">Metadata rows</th>
              <th class="px-5 py-3">Items</th>
              <th class="px-5 py-3">Message</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-ink-100">
            <tr v-if="loading">
              <td class="px-5 py-8 text-ink-500" colspan="9">Loading backup history...</td>
            </tr>
            <tr v-else-if="runs.length === 0">
              <td class="px-5 py-8 text-ink-500" colspan="9">No backup runs yet. Check readiness or run a backup to create the first record.</td>
            </tr>
            <template v-else>
              <tr v-for="run in runs" :key="run.backupRunId" class="hover:bg-ink-50">
                <td class="px-5 py-4">
                  <span class="inline-flex rounded-full px-3 py-1 text-xs font-semibold" :class="statusClass(run.status)">
                    {{ labelForStatus(run.status) }}
                  </span>
                  <p class="mt-1 text-xs text-ink-500">{{ labelForMode(run) }}</p>
                </td>
                <td class="px-5 py-4 font-semibold">{{ labelForDestination(run.destination) }}</td>
                <td class="px-5 py-4">{{ labelForScope(run.scope) }}</td>
                <td class="px-5 py-4">{{ formatDateTime(run.completedAt) }}</td>
                <td class="px-5 py-4">{{ run.caseCount }}</td>
                <td class="px-5 py-4">{{ run.documentCount }}</td>
                <td class="px-5 py-4">{{ run.metadataRows }}</td>
                <td class="px-5 py-4">
                  <span>{{ run.itemCount }}</span>
                  <span v-if="run.failedItems" class="ml-2 text-red-700">({{ run.failedItems }} failed)</span>
                </td>
                <td class="px-5 py-4">
                  <p>{{ run.message }}</p>
                  <button
                    v-if="run.manifestObjectKey"
                    class="mt-2 text-sm font-semibold text-accent-800 hover:underline"
                    type="button"
                    @click="downloadManifest(run)"
                  >
                    Download {{ run.manifestFileName || "manifest" }}
                  </button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </section>

  <section v-if="activeTab === 'database'" class="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
    <div class="panel p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">Database recovery status</h2>
          <p class="mt-1 text-sm text-ink-500">Live recovery information for the production database.</p>
        </div>
        <span class="rounded-full px-3 py-1 text-xs font-semibold" :class="databaseRecoveryConnectionClass">
          {{ databaseRecoveryConnectionLabel }}
        </span>
      </div>

      <dl class="mt-5 space-y-3 text-sm">
        <div class="flex justify-between gap-4">
          <dt class="text-ink-500">Database</dt>
          <dd class="text-right font-semibold">{{ databaseRecovery?.connected ? "Production database" : "Not connected" }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-ink-500">Restore window</dt>
          <dd class="text-right font-semibold">{{ databaseRecovery?.restoreWindowLabel || "Not available" }}</dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-ink-500">Checked</dt>
          <dd class="text-right font-semibold">{{ databaseRecovery?.checkedAt ? formatDateTime(databaseRecovery.checkedAt) : "Not checked" }}</dd>
        </div>
      </dl>

      <p class="mt-5 rounded-md bg-ink-50 p-3 text-sm leading-6 text-ink-500">
        {{ databaseRecovery?.message || "Database recovery status is loading." }}
      </p>

      <div class="mt-4 rounded-md border border-ink-100 bg-ink-50 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-semibold">Create a manual restore point</p>
            <p class="mt-1 text-sm leading-6 text-ink-500">Creates a database recovery point. It does not restore, delete, or change live data.</p>
            <p class="mt-2 text-xs leading-5 text-ink-500">
              Some database plans may allow only a small number of manual restore points. If creation is blocked, remove an older restore point in the database admin console first.
            </p>
          </div>
          <button
            class="btn-secondary shrink-0"
            type="button"
            :disabled="!canCreateDatabaseSnapshot"
            :title="databaseSnapshotButtonTitle"
            @click="createSnapshot"
          >
            <RefreshCw v-if="creatingDatabaseSnapshot" class="h-4 w-4 animate-spin" />
            <Database v-else class="h-4 w-4" />
            {{ creatingDatabaseSnapshot ? "Creating..." : "Create restore point" }}
          </button>
        </div>
        <p v-if="databaseSnapshotMessage" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          {{ databaseSnapshotMessage }}
        </p>
        <p v-if="databaseSnapshotError" class="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
          {{ databaseSnapshotError }}
        </p>
        <p v-if="databaseSnapshotLimitReached" class="mt-3 text-xs leading-5 text-ink-500">
          The restore point list on the right is still valid. To make a newer restore point, remove an older one in the database admin console first.
        </p>
        <p v-if="databaseRecovery?.missingEnv.length" class="mt-3 text-xs text-ink-500">
          Missing: {{ databaseRecovery.missingEnv.join(", ") }}
        </p>
        <p v-if="databaseRecovery?.error" class="mt-3 text-xs text-amber-700">
          {{ databaseRecovery.error }}
        </p>
      </div>

      <div class="mt-4 rounded-md border border-ink-100 bg-ink-50 p-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="font-semibold">Export business records</p>
            <p class="mt-1 text-sm leading-6 text-ink-500">
              Writes a JSON archive of current business records to the private backup area. Use this as an offline data copy.
            </p>
          </div>
          <button
            class="btn-secondary shrink-0"
            type="button"
            :disabled="!canCreateDatabaseTableExport"
            :title="auth.canManageBackups ? 'Export current business records as JSON' : 'Only Admin can export business records'"
            @click="createDatabaseTableExport"
          >
            <RefreshCw v-if="creatingDatabaseTableExport" class="h-4 w-4 animate-spin" />
            <FileArchive v-else class="h-4 w-4" />
            {{ creatingDatabaseTableExport ? "Exporting..." : "Export records" }}
          </button>
        </div>
        <div v-if="databaseTableExportMessage" class="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
          <p>{{ databaseTableExportMessage }}</p>
          <button
            v-if="latestDatabaseTableExport"
            class="mt-2 text-sm font-semibold text-accent-800 hover:underline"
            type="button"
            @click="downloadDatabaseTableExport"
          >
            Download {{ latestDatabaseTableExport.fileName }} ({{ formatBytes(latestDatabaseTableExport.sizeBytes) }})
          </button>
        </div>
        <p v-if="databaseTableExportError" class="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-700">
          {{ databaseTableExportError }}
        </p>
        <p class="mt-3 text-xs leading-5 text-ink-500">
          This JSON archive is separate from database restore points. It is useful for inspection and offline backup, but not a one-click database restore.
        </p>
      </div>
    </div>

    <div class="panel p-5">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">Available restore points</h2>
          <p class="mt-1 text-sm text-ink-500">
            Read-only list of database restore points. Restore and delete actions stay in the database admin console for now.
          </p>
        </div>
        <span class="shrink-0 rounded-full bg-ink-50 px-3 py-1 text-xs font-semibold text-ink-600">
          {{ databaseSnapshots?.snapshots.length ?? 0 }} found
        </span>
      </div>

      <div v-if="visibleDatabaseSnapshots.length" class="mt-4 space-y-3">
        <div
          v-for="snapshot in visibleDatabaseSnapshots"
          :key="snapshot.snapshotId"
          class="rounded-md border border-ink-100 bg-ink-50 p-4"
        >
          <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p class="font-semibold">{{ displayRestorePointName(snapshot.snapshotName) }}</p>
            </div>
            <p class="text-sm font-semibold text-ink-500">
              {{ formatBytes(snapshot.fullSizeBytes ?? snapshot.diffSizeBytes) }}
            </p>
          </div>
          <div class="mt-3 grid gap-2 text-sm text-ink-500 sm:grid-cols-2">
            <p>Created: {{ snapshot.createdAt ? formatDateTime(snapshot.createdAt) : "Pending" }}</p>
            <p>Expires: {{ snapshot.expiresAt ? formatDateTime(snapshot.expiresAt) : "Never" }}</p>
          </div>
        </div>
      </div>
      <p v-else class="mt-4 rounded-md bg-ink-50 p-3 text-sm leading-6 text-ink-500">
        {{ databaseSnapshots?.message || "No restore points loaded yet." }}
      </p>
      <p v-if="databaseSnapshots?.error" class="mt-3 text-xs text-amber-700">
        {{ databaseSnapshots.error }}
      </p>
    </div>
  </section>
</template>
