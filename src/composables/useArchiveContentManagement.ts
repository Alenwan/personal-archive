import { ref } from "vue";
import { useAuthStore } from "../stores/auth";
import { useBusinessTemplate } from "../businessTemplate";

/** UI affordance only: every mutation is reauthorized by the repository. */
export function useArchiveContentManagement() {
  const auth = useAuthStore();
  const { template } = useBusinessTemplate();
  const verifiedUntil = ref<string | null>(null);
  function setManagementExpiry(until: string | null) { verifiedUntil.value = until; }
  function canManageContent(ownerUserId?: string | null) {
    if (!template.value.personalArchive) return true;
    if (!auth.user || auth.sessionUncertain) return false;
    return ownerUserId === auth.user.userId || (auth.user.role === "Admin" && Boolean(verifiedUntil.value && Date.parse(verifiedUntil.value) > Date.now()));
  }
  function managementLabel(ownerUserId?: string | null) {
    return !ownerUserId ? "Management owner unresolved" : ownerUserId === auth.user?.userId ? "Managed by you" : "Managed by another member";
  }
  return { canManageContent, setManagementExpiry, managementLabel, template };
}
