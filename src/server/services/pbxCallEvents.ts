import type { PbxCallEvent } from "../../shared/types";

type PbxCallEventListener = (event: PbxCallEvent) => void;

const listeners = new Set<PbxCallEventListener>();
const recentEvents: PbxCallEvent[] = [];
const MAX_RECENT_EVENTS = 30;

export function publishPbxCallEvent(event: PbxCallEvent): void {
  recentEvents.unshift(event);
  recentEvents.splice(MAX_RECENT_EVENTS);
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribePbxCallEvents(listener: PbxCallEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function listRecentPbxCallEvents(): PbxCallEvent[] {
  return [...recentEvents];
}
