import type { CommunicationRecord } from "./types";
import { normalizePhoneNumber } from "./phoneNumbers";

export type EmailAddress = { name?: string; email?: string };

export type ParsedEmailThreadMessage = {
  key: string;
  index: string;
  timestamp: string;
  from: string;
  to: string;
  body: string;
};

const DEFAULT_BODY_PREVIEW_LENGTH = 520;
const DEFAULT_LIST_PREVIEW_LENGTH = 180;
const DEFAULT_THREAD_MESSAGE_PREVIEW_LENGTH = 180;
const threadMessageCache = new WeakMap<CommunicationRecord, { body: string; messages: ParsedEmailThreadMessage[] }>();

export function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function metadataString(communication: CommunicationRecord, key: string): string {
  const value = communication.sourceMetadata?.[key];
  return typeof value === "string" ? value : "";
}

export function emailAddressList(communication: CommunicationRecord, key: "from" | "to" | "cc"): EmailAddress[] {
  const value = communication.sourceMetadata?.[key];
  if (!Array.isArray(value)) return [];
  return value
    .map<EmailAddress | null>((item) => (isObject(item) ? { name: String(item.name ?? ""), email: String(item.email ?? "") } : null))
    .filter((item): item is EmailAddress => Boolean(item && (item.name || item.email)));
}

export function emailAddressText(address: EmailAddress): string {
  if (address.name && address.email) return `${address.name} <${address.email}>`;
  return address.email || address.name || "";
}

export function emailAddressListText(addresses: EmailAddress[]): string {
  return addresses.map(emailAddressText).filter(Boolean).join(", ");
}

export function emailAddressShortText(address: EmailAddress): string {
  return address.name || address.email || "";
}

export function emailAddressListShortText(addresses: EmailAddress[]): string {
  return addresses.map(emailAddressShortText).filter(Boolean).join(", ");
}

function generatedEmailIdentityLooksLikeSystemAddress(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (normalizePhoneNumber(normalized).isLikelyPhoneNumber) return true;
  return (
    normalized.includes("@txt.voice.google.com") ||
    normalized.includes("noreply") ||
    normalized.includes("no-reply") ||
    normalized.includes("mailer-daemon")
  );
}

export function communicationSenderLabel(communication: CommunicationRecord): string {
  const gmailFrom = emailAddressListShortText(emailAddressList(communication, "from"));
  if (communication.contactName && (!gmailFrom || generatedEmailIdentityLooksLikeSystemAddress(gmailFrom))) return communication.contactName;
  if (gmailFrom) return gmailFrom;
  if (communication.contactName) return communication.contactName;
  if (communication.partyOrganizationName) return communication.partyOrganizationName;
  if (metadataString(communication, "callerName")) return metadataString(communication, "callerName");
  if (metadataString(communication, "callerNumber")) return metadataString(communication, "callerNumber");
  if (communication.assetName) return communication.assetName;
  return communication.source === "Asterisk / PBX" ? "PBX call" : "Unknown";
}

export function emailThreadMessageSenderLabel(communication: CommunicationRecord, rawSender: string): string {
  const sender = rawSender.trim();
  if (communication.contactName && (!sender || generatedEmailIdentityLooksLikeSystemAddress(sender))) return communication.contactName;
  if (sender) return sender;
  return communicationSenderLabel(communication);
}

export function communicationLooksLikeTestRecord(communication: CommunicationRecord): boolean {
  const metadata = JSON.stringify(communication.sourceMetadata ?? {}).toLowerCase();
  const haystack = [
    communication.subject,
    communication.body,
    communication.caseNumber,
    communication.caseTitle,
    communication.contactName,
    communication.partyOrganizationName,
    communication.assetName,
    communication.externalProvider,
    communication.externalReference,
    metadata
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes("phase 9 smoke") || haystack.includes("phase9-") || haystack.includes("scripts/smoke-selfhost");
}

export function cleanEmailBody(communication: CommunicationRecord): string {
  const body = communication.body || "";
  if (communication.source !== "Gmail") return body;
  const marker = "\n\nEmail body\n";
  const markerIndex = body.indexOf(marker);
  if (markerIndex >= 0) return body.slice(markerIndex + marker.length).trim();
  const looseMarker = "Email body\n";
  const looseIndex = body.indexOf(looseMarker);
  if (looseIndex >= 0) return body.slice(looseIndex + looseMarker.length).trim();
  return body;
}

export function parseGmailThreadMessages(communication: CommunicationRecord): ParsedEmailThreadMessage[] {
  if (communication.source !== "Gmail") return [];
  const body = cleanEmailBody(communication).trim();
  const cached = threadMessageCache.get(communication);
  if (cached?.body === body) return cached.messages;
  if (!body) return [];

  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const messages: ParsedEmailThreadMessage[] = [];
  let index = 0;
  while (index < lines.length) {
    const header = lines[index].trim().match(/^\[(\d+)\]\s+(.+)$/);
    if (!header) {
      index += 1;
      continue;
    }

    const messageNumber = header[1];
    const timestamp = header[2].trim();
    index += 1;

    let from = "";
    let to = "";
    if (index < lines.length && /^From:\s*/i.test(lines[index].trim())) {
      from = lines[index].replace(/^From:\s*/i, "").trim();
      index += 1;
    }
    if (index < lines.length && /^To:\s*/i.test(lines[index].trim())) {
      to = lines[index].replace(/^To:\s*/i, "").trim();
      index += 1;
    }

    while (index < lines.length && !lines[index].trim()) index += 1;

    const bodyLines: string[] = [];
    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();
      if (/^-{3,}$/.test(trimmed)) {
        index += 1;
        break;
      }
      if (/^\[\d+\]\s+/.test(trimmed) && bodyLines.length) break;
      bodyLines.push(line);
      index += 1;
    }

    messages.push({
      key: `${messageNumber}-${timestamp}-${messages.length}`,
      index: messageNumber,
      timestamp,
      from,
      to,
      body: bodyLines.join("\n").trim()
    });
  }

  const parsed = messages.length ? messages : [];
  threadMessageCache.set(communication, { body, messages: parsed });
  return parsed;
}

export function threadPreviewMessages(communication: CommunicationRecord, limit = 3): ParsedEmailThreadMessage[] {
  const messages = parseGmailThreadMessages(communication);
  if (messages.length <= limit) return messages;
  return messages.slice(-limit);
}

export function threadMessagePreview(message: ParsedEmailThreadMessage, limit = DEFAULT_THREAD_MESSAGE_PREVIEW_LENGTH): string {
  const body = message.body.replace(/\s+/g, " ").trim();
  if (body.length <= limit) return body;
  return `${body.slice(0, limit).trimEnd()}...`;
}

export function displayCommunicationBody(communication: CommunicationRecord): string {
  if (communication.source === "Gmail") return cleanEmailBody(communication) || metadataString(communication, "snippet");
  return cleanEmailBody(communication);
}

export function previewCommunicationBody(communication: CommunicationRecord, limit = DEFAULT_BODY_PREVIEW_LENGTH): string {
  const body = displayCommunicationBody(communication).trim();
  if (body.length <= limit) return body;
  return `${body.slice(0, limit).trimEnd()}...`;
}

export function communicationBodyIsTruncated(communication: CommunicationRecord, limit = DEFAULT_BODY_PREVIEW_LENGTH, threadPreviewLimit = 3): boolean {
  if (parseGmailThreadMessages(communication).length > threadPreviewLimit) return true;
  return displayCommunicationBody(communication).trim().length > limit;
}

export function communicationPreviewText(communication: CommunicationRecord, limit = DEFAULT_LIST_PREVIEW_LENGTH): string {
  const threadMessages = parseGmailThreadMessages(communication);
  if (threadMessages.length) {
    const latest = threadMessages[threadMessages.length - 1];
    const preview = threadMessagePreview(latest, limit);
    return [threadMessages.length > 1 ? `${threadMessages.length} messages` : "", preview].filter(Boolean).join(" · ");
  }

  const body = metadataString(communication, "snippet") || displayCommunicationBody(communication) || communication.body || "";
  const preview = body.replace(/\s+/g, " ").trim();
  if (preview.length <= limit) return preview;
  return `${preview.slice(0, limit).trimEnd()}...`;
}
