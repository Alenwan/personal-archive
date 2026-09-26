import net from "node:net";
import type { AppEnv } from "../src/server/env";
import { createRepository } from "../src/server/repositories/factory";
import type { AppRepository } from "../src/server/repositories/types";
import { buildMatchedPbxCallEvent } from "../src/server/services/pbxCallMatcher";
import { publishPbxCallEvent } from "../src/server/services/pbxCallEvents";
import { normalizePhoneNumber, phoneDigits, phoneNumbersMatch } from "../src/shared/phoneNumbers";
import type {
  CommunicationRecord,
  CommunicationStatus,
  PbxCallDirection,
  PbxCallEvent,
  PbxCallStatus,
  PbxSettings,
  PublicUser
} from "../src/shared/types";

interface AmiFrame {
  [key: string]: string;
}

interface TrackedCall {
  callId: string;
  linkedId: string;
  uniqueId: string;
  status: PbxCallStatus;
  direction: PbxCallDirection;
  callerNumber: string;
  callerName: string;
  destination: string;
  extension: string;
  channel: string;
  startedAt: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  updatedAt: string;
  lastPublishedSignature: string;
}

const CALL_EVENTS = new Set([
  "Newchannel",
  "Newcallerid",
  "Newstate",
  "DialBegin",
  "DialEnd",
  "BridgeEnter",
  "BridgeLeave",
  "Hangup",
  "Cdr",
  "CEL"
]);
const SYSTEM_AUDIT_USER_EMAIL = "system@md3-platform.local";

function envBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").trim().toLowerCase());
}

function envNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(String(value ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseFrame(raw: string): AmiFrame {
  const frame: AmiFrame = {};
  for (const line of raw.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (key) frame[key] = value;
  }
  return frame;
}

function pick(frame: AmiFrame, keys: string[]): string {
  for (const key of keys) {
    if (frame[key]) return frame[key];
  }
  return "";
}

function sendAction(socket: net.Socket, fields: Record<string, string>): void {
  socket.write(`${Object.entries(fields).map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
}

function frameCallId(frame: AmiFrame): string {
  return pick(frame, ["Linkedid", "DestLinkedid", "Uniqueid", "DestUniqueid", "Channel"]) || `unknown-${Date.now()}`;
}

function likelyExternalNumber(...values: string[]): string {
  for (const value of values) {
    const normalized = normalizePhoneNumber(value);
    if (normalized.isLikelyPhoneNumber) return normalized.digits;
  }
  return "";
}

function likelyExtension(...values: string[]): string {
  for (const value of values) {
    const normalized = normalizePhoneNumber(value);
    if (normalized.isLikelyExtension) return normalized.digits;
  }
  return "";
}

function callDirection(callerNumber: string, extension: string, destination: string): PbxCallDirection {
  if (normalizePhoneNumber(callerNumber).isLikelyPhoneNumber) return "Inbound";
  if (normalizePhoneNumber(destination).isLikelyPhoneNumber) return "Outbound";
  if (extension) return "Internal";
  return "Inbound";
}

function destinationMatches(value: string, patterns: string[]): boolean {
  const valueText = value.trim().toLowerCase();
  const valueDigits = phoneDigits(value);
  return patterns.some((pattern) => {
    const patternText = pattern.trim().toLowerCase();
    const patternDigits = phoneDigits(pattern);
    if (!patternText) return false;
    if (patternDigits.length >= 10 && valueDigits.length >= 10) return phoneNumbersMatch(patternDigits, valueDigits);
    if (patternDigits && valueDigits) return patternDigits === valueDigits;
    return patternText === valueText;
  });
}

function shouldConsiderCall(call: TrackedCall, settings: PbxSettings): boolean {
  if (!settings.isEnabled) return false;

  const didTargets = [call.destination, call.extension].filter(Boolean);
  const destinationTargets = [call.extension, call.destination].filter(Boolean);
  if (didTargets.some((target) => destinationMatches(target, settings.ignoredDids))) return false;
  if (destinationTargets.some((target) => destinationMatches(target, settings.ignoredDestinations))) return false;

  const hasAllowedRules = settings.allowedDids.length > 0 || settings.allowedDestinations.length > 0;
  if (!hasAllowedRules) return false;

  return (
    didTargets.some((target) => destinationMatches(target, settings.allowedDids)) ||
    destinationTargets.some((target) => destinationMatches(target, settings.allowedDestinations))
  );
}

function statusFromFrame(frame: AmiFrame, previous?: TrackedCall): PbxCallStatus {
  const event = frame.Event;
  const state = pick(frame, ["ChannelStateDesc", "Newstate", "DialStatus", "Cause-txt"]).toLowerCase();
  if (event === "BridgeEnter" || state.includes("up") || state.includes("answer")) return "answered";
  if (event === "Hangup" || event === "Cdr") return previous?.answeredAt ? "ended" : "missed";
  if (state.includes("ring") || event === "DialBegin" || event === "Newchannel" || event === "Newcallerid") return "ringing";
  return previous?.status ?? "unknown";
}

function updateTrackedCall(existing: TrackedCall | undefined, frame: AmiFrame): TrackedCall {
  const updatedAt = nowIso();
  const callId = existing?.callId || frameCallId(frame);
  const externalNumber =
    likelyExternalNumber(
      pick(frame, ["CallerIDNum", "CallerID", "ConnectedLineNum", "DestCallerIDNum", "Exten", "DestExten", "Dialstring"])
    ) || existing?.callerNumber || "";
  const destination = pick(frame, ["DestExten", "Dialstring", "Exten", "ConnectedLineNum"]) || existing?.destination || "";
  const extension =
    likelyExtension(pick(frame, ["CallerIDNum", "ConnectedLineNum", "Exten", "DestExten"])) || existing?.extension || "";
  const status = statusFromFrame(frame, existing);
  const answeredAt = status === "answered" && !existing?.answeredAt ? updatedAt : existing?.answeredAt ?? null;
  const endedAt = status === "ended" || status === "missed" ? updatedAt : existing?.endedAt ?? null;

  return {
    callId,
    linkedId: pick(frame, ["Linkedid", "DestLinkedid"]) || existing?.linkedId || callId,
    uniqueId: pick(frame, ["Uniqueid", "DestUniqueid"]) || existing?.uniqueId || callId,
    status,
    direction: callDirection(externalNumber, extension, destination),
    callerNumber: externalNumber || pick(frame, ["CallerIDNum", "CallerID"]) || existing?.callerNumber || "",
    callerName: pick(frame, ["CallerIDName", "ConnectedLineName"]) || existing?.callerName || "",
    destination,
    extension,
    channel: pick(frame, ["Channel", "DestChannel"]) || existing?.channel || "",
    startedAt: existing?.startedAt || updatedAt,
    answeredAt,
    endedAt,
    updatedAt,
    lastPublishedSignature: existing?.lastPublishedSignature || ""
  };
}

function publishSignature(call: TrackedCall): string {
  return [call.status, call.callerNumber, call.callerName, call.destination, call.extension].join("|");
}

function matchId(event: PbxCallEvent, type: "contact" | "organization" | "asset"): string | null {
  return event.matches.find((match) => match.type === type)?.id ?? null;
}

function callerNameLooksUnknown(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return !normalized || normalized === "unknown" || normalized === "<unknown>" || normalized === "anonymous" || normalized === "unavailable";
}

function callSubject(event: PbxCallEvent): string {
  const matchedContact = event.matches.find((match) => match.type === "contact");
  const matchedEntity = matchedContact ?? event.matches[0];
  const caller =
    matchedEntity?.label ||
    (!callerNameLooksUnknown(event.callerName) ? event.callerName : "") ||
    event.displayCallerNumber ||
    event.callerNumber ||
    "Unknown caller";
  if (event.status === "missed") return `Missed call from ${caller}`;
  if (event.status === "answered") return `Answered call from ${caller}`;
  if (event.status === "ended") return `Call with ${caller}`;
  return `Incoming call from ${caller}`;
}

function callCommunicationStatus(event: PbxCallEvent, linkedCaseId: string | null, current?: CommunicationRecord | null): CommunicationStatus {
  if (current?.status === "Ignored / Spam" || current?.status === "Needs follow-up") return current.status;
  if (event.status === "missed") return "Needs follow-up";
  if (linkedCaseId) return "Linked";
  return current?.status && current.status !== "New" ? current.status : "New";
}

function possibleServiceMetadata(event: PbxCallEvent) {
  return event.services.map((service) => ({
    caseId: service.caseId,
    caseNumber: service.caseNumber,
    title: service.title,
    status: service.status
  }));
}

interface PersistedPbxCommunication {
  communication: CommunicationRecord;
  action: "created" | "updated";
}

async function persistPbxCommunication(repo: AppRepository, event: PbxCallEvent): Promise<PersistedPbxCommunication> {
  const existing = await repo.findCommunicationByExternalReferences("Asterisk / PBX", [
    event.callId,
    event.linkedId,
    event.uniqueId
  ]);
  const linkedCaseId = existing?.caseId ?? (event.services.length === 1 ? event.services[0].caseId : null);
  const matchedContactId = existing?.contactId ?? matchId(event, "contact");
  const matchedAssetId = existing?.assetId ?? matchId(event, "asset");
  let matchedOrganizationId = existing?.partyOrganizationId ?? matchId(event, "organization");
  if (!matchedOrganizationId && matchedContactId) {
    matchedOrganizationId = (await repo.getContact(matchedContactId))?.partyOrganizationId ?? null;
  }
  if (!matchedOrganizationId && matchedAssetId) {
    matchedOrganizationId = (await repo.getAsset(matchedAssetId))?.partyOrganizationId ?? null;
  }
  const metadata = {
    ...(existing?.sourceMetadata ?? {}),
    ...(event.metadata ?? {}),
    callId: event.callId,
    linkedId: event.linkedId,
    uniqueId: event.uniqueId,
    callerNumber: event.displayCallerNumber || event.callerNumber,
    rawCallerNumber: event.callerNumber,
    normalizedCallerNumber: event.normalizedCallerNumber,
    callerName: event.callerName,
    destination: event.destination,
    extension: event.extension,
    channel: event.channel,
    status: event.status,
    direction: event.direction,
    startedAt: event.startedAt,
    answeredAt: event.answeredAt ?? null,
    endedAt: event.endedAt ?? null,
    updatedAt: event.updatedAt,
    possibleServices: possibleServiceMetadata(event),
    autoMatched: {
      contactId: matchedContactId,
      partyOrganizationId: matchedOrganizationId,
      assetId: matchedAssetId,
      caseId: linkedCaseId
    },
    matchSummary: event.matches.map((match) => ({
      type: match.type,
      id: match.id,
      label: match.label,
      matchedField: match.matchedField,
      matchedValue: match.matchedValue
    }))
  };
  const input = {
    caseId: linkedCaseId,
    partyOrganizationId: matchedOrganizationId,
    contactId: matchedContactId,
    assetId: matchedAssetId,
    supportingDocumentId: null,
    communicationType: "Call" as const,
    direction: event.direction,
    source: "Asterisk / PBX" as const,
    status: callCommunicationStatus(event, linkedCaseId, existing),
    externalProvider: event.externalProvider,
    externalReference: event.callId,
    externalUrl: "",
    sourceMetadata: metadata,
    subject: callSubject(event),
    body: existing?.body ?? "",
    occurredAt: event.startedAt || event.updatedAt,
    createdBy: existing?.createdBy ?? null
  };
  const communication = existing
    ? await repo.updateCommunication(existing.communicationId, input)
    : await repo.createCommunication(input);
  if (!communication) throw new Error("Failed to persist PBX communication");
  event.metadata = { ...event.metadata, communicationId: communication.communicationId };
  return { communication, action: existing ? "updated" : "created" };
}

async function getPbxAuditUser(repo: AppRepository): Promise<PublicUser | null> {
  const systemUser = await repo.getUserByEmail(SYSTEM_AUDIT_USER_EMAIL);
  if (systemUser) return systemUser;

  const users = await repo.listUsers();
  return users.find((user) => user.role === "Admin") ?? users[0] ?? null;
}

async function auditPbxCommunication(
  repo: AppRepository,
  event: PbxCallEvent,
  communication: CommunicationRecord,
  action: PersistedPbxCommunication["action"]
): Promise<void> {
  try {
    const auditUser = await getPbxAuditUser(repo);
    if (!auditUser) return;
    await repo.createAuditLog({
      action: `pbx.communication.${action}`,
      entityType: "communication",
      entityId: communication.communicationId,
      user: auditUser,
      metadata: {
        actorType: "system",
        actorName: "PBX AMI Listener",
        source: "Asterisk / PBX",
        communicationId: communication.communicationId,
        caseId: communication.caseId ?? null,
        contactId: communication.contactId ?? null,
        partyOrganizationId: communication.partyOrganizationId ?? null,
        assetId: communication.assetId ?? null,
        callId: event.callId,
        linkedId: event.linkedId,
        uniqueId: event.uniqueId,
        status: event.status,
        direction: event.direction,
        callerNumber: event.displayCallerNumber || event.callerNumber,
        normalizedCallerNumber: event.normalizedCallerNumber,
        destination: event.destination,
        extension: event.extension,
        possibleServices: possibleServiceMetadata(event)
      }
    });
  } catch (error) {
    console.error("Unable to write PBX communication audit log", error);
  }
}

export function startPbxAmiListener(env: AppEnv): void {
  if (!envBoolean(env.PBX_AMI_ENABLED)) return;

  const host = env.PBX_AMI_HOST?.trim();
  const port = envNumber(env.PBX_AMI_PORT, 5038);
  const username = env.PBX_AMI_USERNAME?.trim() ?? "";
  const password = env.PBX_AMI_PASSWORD ?? "";
  if (!host || !username || !password) {
    console.warn("PBX AMI listener requires explicit PBX_AMI_HOST, PBX_AMI_USERNAME and PBX_AMI_PASSWORD configuration.");
    return;
  }

  const repo = createRepository(env);
  const calls = new Map<string, TrackedCall>();
  let socket: net.Socket | null = null;
  let buffer = "";
  let reconnectTimer: NodeJS.Timeout | null = null;
  let stopped = false;
  let cachedSettings: { value: PbxSettings; loadedAt: number } | null = null;

  const getSettings = async () => {
    if (cachedSettings && Date.now() - cachedSettings.loadedAt < 5_000) return cachedSettings.value;
    const value = await repo.getPbxSettings();
    cachedSettings = { value, loadedAt: Date.now() };
    return value;
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 10_000);
  };

  const handleFrame = async (frame: AmiFrame) => {
    if (frame.Response === "Error") {
      console.error(`PBX AMI error: ${frame.Message || "unknown error"}`);
      socket?.destroy();
      return;
    }
    if (!frame.Event || !CALL_EVENTS.has(frame.Event)) return;

    const callId = frameCallId(frame);
    const call = updateTrackedCall(calls.get(callId), frame);
    calls.set(callId, call);

    const signature = publishSignature(call);
    if (signature === call.lastPublishedSignature) return;
    call.lastPublishedSignature = signature;

    try {
      const settings = await getSettings();
      if (!shouldConsiderCall(call, settings)) return;
      const event = await buildMatchedPbxCallEvent(repo, {
        ...call,
        metadata: {
          asteriskEvent: frame.Event,
          linkedId: call.linkedId,
          uniqueId: call.uniqueId,
          channel: call.channel,
          destination: call.destination,
          extension: call.extension,
          popupRetentionSeconds: settings.popupRetentionSeconds
        }
      });
      if (!settings.showUnknownCallers && event.matches.length === 0 && event.services.length === 0) return;
      const { communication, action } = await persistPbxCommunication(repo, event);
      event.metadata = { ...event.metadata, communicationId: communication.communicationId };
      await auditPbxCommunication(repo, event, communication, action);
      publishPbxCallEvent(event);
    } catch (error) {
      console.error("Unable to publish PBX call event", error);
    }

    if (call.status === "ended" || call.status === "missed") {
      setTimeout(() => calls.delete(callId), 60_000);
    }
  };

  function connect() {
    console.log(`Starting PBX AMI listener for ${host}:${port} as ${username}`);
    socket = net.createConnection({ host, port });

    socket.on("connect", () => {
      sendAction(socket as net.Socket, {
        Action: "Login",
        Username: username,
        Secret: password,
        Events: "on",
        ActionID: `md3-platform-${Date.now()}`
      });
    });

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      let boundary = buffer.indexOf("\r\n\r\n");
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 4);
        void handleFrame(parseFrame(raw));
        boundary = buffer.indexOf("\r\n\r\n");
      }
    });

    socket.on("error", (error) => {
      console.error(`PBX AMI listener socket error: ${error.message}`);
    });

    socket.on("close", () => {
      if (!stopped) scheduleReconnect();
    });
  }

  process.once("SIGTERM", () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket && !socket.destroyed) {
      sendAction(socket, { Action: "Logoff" });
      socket.destroy();
    }
  });

  connect();
}
