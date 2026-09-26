<script setup lang="ts">
import type { CaseStatus, TaskStatus } from "../shared/types";

defineProps<{ status: CaseStatus | TaskStatus | string }>();

const styles: Record<string, string> = {
  New: "bg-ink-100 text-ink-700",
  Active: "bg-accent-100 text-accent-800",
  Pending: "bg-amber-100 text-amber-800",
  "Closing Soon": "bg-rose-100 text-rose-800",
  Closed: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-red-100 text-red-800",
  "On Hold": "bg-slate-100 text-slate-700",
  Open: "bg-ink-100 text-ink-700",
  "In Progress": "bg-blue-100 text-blue-800",
  Blocked: "bg-red-100 text-red-800",
  Done: "bg-emerald-100 text-emerald-800"
};
</script>

<template>
  <span class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold" :class="styles[status] || styles.New">
    {{ status }}
  </span>
</template>

