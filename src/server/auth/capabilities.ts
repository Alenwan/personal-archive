import type { AppCapabilities, PublicUser } from "../../shared/types";
import { can } from "./permissions";

export function buildCapabilities(user: PublicUser | null | undefined): AppCapabilities {
  const canMutate = Boolean(user) && user?.mutationAllowed !== false;
  const role = user?.role;
  const canManageContacts = canMutate && (role === "Admin" || role === "Manager");
  const canEditCases = canMutate && (role === "Admin" || role === "Manager");
  const canManageAssets = canMutate && (role === "Admin" || role === "Manager");
  const canManageSettings = canMutate && can(user, "settings", "settings");

  return {
    canMutate,
    canDeleteDocuments: canMutate && can(user, "delete", "document"),
    canEditDocuments: canMutate && (role === "Admin" || role === "Manager"),
    canEditCases,
    canArchiveCases: canEditCases,
    canManageContacts,
    canDeleteContacts: canManageContacts,
    canManageOrganizations: canManageContacts,
    canDeleteOrganizations: canManageContacts,
    canManageAssets,
    canRevealCredentials: canManageAssets,
    canCreateTasks: canMutate && (role === "Admin" || role === "Manager"),
    canUpdateTasks: canMutate && role !== "ReadOnly",
    canAddNotes: canMutate && role !== "ReadOnly",
    canUpload: canMutate && role !== "ReadOnly",
    canManageBackups: canMutate && role === "Admin",
    canManageSettings
  };
}
