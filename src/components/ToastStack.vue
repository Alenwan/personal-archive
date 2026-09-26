<script setup lang="ts">
import { AlertCircle, CheckCircle2, Info, X } from "lucide-vue-next";
import { useToastStore, type ToastVariant } from "../stores/toasts";

const toasts = useToastStore();

function tone(variant: ToastVariant) {
  if (variant === "success") return "border-emerald-200 bg-emerald-50 text-emerald-900";
  if (variant === "error") return "border-red-200 bg-red-50 text-red-900";
  return "border-blue-200 bg-blue-50 text-blue-900";
}
</script>

<template>
  <div class="pointer-events-none fixed right-4 top-4 z-[80] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-3">
    <div
      v-for="toast in toasts.items"
      :key="toast.id"
      class="pointer-events-auto rounded-lg border p-4 shadow-soft"
      :class="tone(toast.variant)"
      role="status"
      aria-live="polite"
    >
      <div class="flex items-start gap-3">
        <CheckCircle2 v-if="toast.variant === 'success'" class="mt-0.5 h-5 w-5 shrink-0" />
        <AlertCircle v-else-if="toast.variant === 'error'" class="mt-0.5 h-5 w-5 shrink-0" />
        <Info v-else class="mt-0.5 h-5 w-5 shrink-0" />
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">{{ toast.title }}</p>
          <p v-if="toast.message" class="mt-1 text-sm opacity-80">{{ toast.message }}</p>
        </div>
        <button class="rounded p-1 opacity-70 transition hover:bg-black/5 hover:opacity-100" type="button" @click="toasts.remove(toast.id)">
          <X class="h-4 w-4" />
          <span class="sr-only">Dismiss notification</span>
        </button>
      </div>
    </div>
  </div>
</template>
