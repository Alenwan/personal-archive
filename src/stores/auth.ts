import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { client } from "../api/client";
import type { PublicUser } from "../shared/types";
import { announceSessionChange, SESSION_CHANGE_KEY, setRequestUserId } from "../shared/sessionIdentity";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<PublicUser | null>(null);
  const loading = ref(false);
  const error = ref("");
  const sessionUncertain = ref(false);
  let sessionVersion = 0;
  if (typeof window !== "undefined") window.addEventListener("storage", (event) => {
    if (event.key === SESSION_CHANGE_KEY || event.key === null) { sessionVersion++; sessionUncertain.value = true; }
  });

  function requireCurrentSession(version: number) {
    if (version !== sessionVersion) throw new Error("The session changed during verification. Verify the account again before continuing.");
  }

  const isAuthenticated = computed(() => Boolean(user.value));
  const mustChangePassword = computed(() => Boolean(user.value?.mustChangePassword));
  const isReadOnly = computed(() => user.value?.role === "ReadOnly");
  const canMutate = computed(() => user.value?.capabilities?.canMutate ?? (Boolean(user.value) && user.value?.mutationAllowed !== false));
  const canDeleteDocuments = computed(() => user.value?.capabilities?.canDeleteDocuments ?? (canMutate.value && (user.value?.role === "Admin" || user.value?.role === "Manager")));
  const canEditDocuments = computed(() => user.value?.capabilities?.canEditDocuments ?? (canMutate.value && (user.value?.role === "Admin" || user.value?.role === "Manager")));
  const canEditCases = computed(() => user.value?.capabilities?.canEditCases ?? (canMutate.value && (user.value?.role === "Admin" || user.value?.role === "Manager")));
  const canArchiveCases = computed(() => user.value?.capabilities?.canArchiveCases ?? canEditCases.value);
  const canManageContacts = computed(() => user.value?.capabilities?.canManageContacts ?? (canMutate.value && (user.value?.role === "Admin" || user.value?.role === "Manager")));
  const canDeleteContacts = computed(() => user.value?.capabilities?.canDeleteContacts ?? canManageContacts.value);
  const canManageOrganizations = computed(() => user.value?.capabilities?.canManageOrganizations ?? canManageContacts.value);
  const canDeleteOrganizations = computed(() => user.value?.capabilities?.canDeleteOrganizations ?? canManageContacts.value);
  const canManageAssets = computed(() => user.value?.capabilities?.canManageAssets ?? (canMutate.value && (user.value?.role === "Admin" || user.value?.role === "Manager")));
  const canRevealCredentials = computed(() => user.value?.capabilities?.canRevealCredentials ?? canManageAssets.value);
  const canCreateTasks = computed(() => user.value?.capabilities?.canCreateTasks ?? (canMutate.value && (user.value?.role === "Admin" || user.value?.role === "Manager")));
  const canUpdateTasks = computed(() => user.value?.capabilities?.canUpdateTasks ?? (canMutate.value && user.value?.role !== "ReadOnly"));
  const canAddNotes = computed(() => user.value?.capabilities?.canAddNotes ?? (canMutate.value && user.value?.role !== "ReadOnly"));
  const canUpload = computed(() => user.value?.capabilities?.canUpload ?? (canMutate.value && user.value?.role !== "ReadOnly"));
  const canManageBackups = computed(() => user.value?.capabilities?.canManageBackups ?? (canMutate.value && user.value?.role === "Admin"));
  const canManageSettings = computed(() => user.value?.capabilities?.canManageSettings ?? (canMutate.value && user.value?.role === "Admin"));

  async function loadSession() {
    const version = ++sessionVersion;
    loading.value = true;
    try {
      const response = await client.session();
      requireCurrentSession(version);
      user.value = response.user;
      setRequestUserId(response.user?.userId ?? null);
      sessionUncertain.value = false;
    } finally {
      loading.value = false;
    }
  }

  async function login(email: string, password: string) {
    const version = ++sessionVersion;
    loading.value = true;
    error.value = "";
    try {
      const response = await client.login(email, password);
      requireCurrentSession(version);
      user.value = response.user;
      setRequestUserId(response.user.userId);
      sessionUncertain.value = false;
      announceSessionChange();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Login failed";
      throw err;
    } finally {
      loading.value = false;
    }
  }

  async function logout() {
    const version = ++sessionVersion;
    await client.logout().catch(() => undefined);
    requireCurrentSession(version);
    user.value = null;
    setRequestUserId(null);
    sessionUncertain.value = true;
    announceSessionChange();
  }

  async function changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
    const version = ++sessionVersion;
    loading.value = true;
    error.value = "";
    try {
      const response = await client.changePassword({ currentPassword, newPassword, confirmPassword });
      requireCurrentSession(version);
      user.value = response.user;
      setRequestUserId(response.user.userId);
      sessionUncertain.value = false;
      announceSessionChange();
    } catch (err) {
      error.value = err instanceof Error ? err.message : "Password change failed";
      throw err;
    } finally {
      loading.value = false;
    }
  }

  return {
    user,
    sessionUncertain,
    loading,
    error,
    isAuthenticated,
    mustChangePassword,
    isReadOnly,
    canMutate,
    canDeleteDocuments,
    canEditDocuments,
    canEditCases,
    canArchiveCases,
    canManageContacts,
    canDeleteContacts,
    canManageOrganizations,
    canDeleteOrganizations,
    canManageAssets,
    canRevealCredentials,
    canCreateTasks,
    canUpdateTasks,
    canAddNotes,
    canUpload,
    canManageBackups,
    canManageSettings,
    loadSession,
    login,
    changePassword,
    logout
  };
});
