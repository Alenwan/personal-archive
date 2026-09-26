import { defineStore } from "pinia";
import { ref } from "vue";

export type ToastVariant = "success" | "error" | "info";

export interface ToastItem {
  id: string;
  title: string;
  message?: string;
  variant: ToastVariant;
}

export const useToastStore = defineStore("toasts", () => {
  const items = ref<ToastItem[]>([]);

  function createToastId() {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof globalThis.crypto?.getRandomValues === "function") {
      globalThis.crypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function remove(id: string) {
    items.value = items.value.filter((item) => item.id !== id);
  }

  function push(input: Omit<ToastItem, "id">) {
    const id = createToastId();
    items.value = [...items.value, { id, ...input }];
    window.setTimeout(() => remove(id), 4500);
  }

  function success(title: string, message?: string) {
    push({ title, message, variant: "success" });
  }

  function error(title: string, message?: string) {
    push({ title, message, variant: "error" });
  }

  function info(title: string, message?: string) {
    push({ title, message, variant: "info" });
  }

  return { items, push, success, error, info, remove };
});
