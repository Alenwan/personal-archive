import type { PublicUser, UserRole } from "../../shared/types";
import { HTTPException } from "hono/http-exception";

export type PermissionAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "upload"
  | "download"
  | "audit"
  | "settings";

const rolePermissions: Record<UserRole, PermissionAction[]> = {
  Admin: ["view", "create", "edit", "delete", "upload", "download", "audit", "settings"],
  Manager: ["view", "create", "edit", "delete", "upload", "download"],
  Staff: ["view", "upload", "download"],
  ReadOnly: ["view", "download"]
};

export function can(user: PublicUser | null | undefined, action: PermissionAction, resource?: string): boolean {
  if (!user) return false;
  if (resource === "document" && action === "delete") {
    return user.role === "Admin" || user.role === "Manager";
  }
  if (resource === "audit" && action === "view") {
    return user.role === "Admin";
  }
  if (resource === "settings" && action !== "view") {
    return user.role === "Admin";
  }
  if (user.role === "Staff") {
    if (action === "create" && resource === "note") return true;
    if (action === "edit" && resource === "task") return true;
    return rolePermissions.Staff.includes(action);
  }
  return rolePermissions[user.role]?.includes(action) ?? false;
}

export function requirePermission(user: PublicUser, action: PermissionAction, resource?: string): void {
  if (!can(user, action, resource)) {
    const reason = resource ? `${action} ${resource}` : action;
    throw new HTTPException(403, { message: `Role ${user.role} cannot ${reason}.` });
  }
}
