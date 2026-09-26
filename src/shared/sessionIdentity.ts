// This marker contains no token or content. It only tells other tabs that the
// cookie may have changed; they must reauthenticate before resuming an editor.
export const SESSION_CHANGE_KEY = "personal-archive.session-change.v1";
let currentUserId = "";
export function activeRequestUserId() { return currentUserId; }
export function setRequestUserId(userId: string | null) { currentUserId = userId || ""; }
export function announceSessionChange(): void {
  try { localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID()); } catch { /* Request identity still guards server mutations. */ }
}
