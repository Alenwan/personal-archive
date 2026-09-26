import assert from "node:assert/strict";
import test from "node:test";
import { createPinia, setActivePinia } from "pinia";
import { client } from "../src/api/client";
import { useAuthStore } from "../src/stores/auth";
import { activeRequestUserId, SESSION_CHANGE_KEY, setRequestUserId } from "../src/shared/sessionIdentity";
import { installLocalStorage } from "./helpers/browserStorage";
installLocalStorage();
const events = new EventTarget();
Object.defineProperty(globalThis, "window", { value: events, configurable: true });

test("a late session response cannot undo a cross-tab account-change warning", async () => {
  setActivePinia(createPinia());
  const auth = useAuthStore(), original = client.session;
  let complete!: (value: Awaited<ReturnType<typeof client.session>>) => void;
  client.session = () => new Promise((resolve) => { complete = resolve; });
  try {
    const pending = auth.loadSession();
    const event = new Event("storage");
    Object.defineProperty(event, "key", { value: SESSION_CHANGE_KEY });
    events.dispatchEvent(event);
    complete({ user: null });
    await assert.rejects(pending, /session changed/);
    assert.equal(auth.sessionUncertain, true);
  } finally { client.session = original; setRequestUserId(null); }
});

test("a response from before logout cannot restore the logged-out identity", async () => {
  setActivePinia(createPinia());
  const auth = useAuthStore(), original = client.session, logout = client.logout;
  let complete!: (value: Awaited<ReturnType<typeof client.session>>) => void;
  client.session = () => new Promise((resolve) => { complete = resolve; });
  client.logout = async () => ({ ok: true });
  try {
    const pending = auth.loadSession();
    await auth.logout();
    complete({ user: null });
    await assert.rejects(pending, /session changed/);
    assert.equal(auth.user, null);
    assert.equal(auth.sessionUncertain, true);
    assert.equal(activeRequestUserId(), "");
  } finally { client.session = original; client.logout = logout; setRequestUserId(null); }
});
