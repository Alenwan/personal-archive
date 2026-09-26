import { assetSearchQuickValues } from "./assetFilters";
import { contactDisplayName } from "./format";
import type {
  CaseRecord,
  Contact,
  DocumentRecord,
  KnowledgeItem,
  Manuscript,
  ManagedAsset,
  PartyOrganization,
  SearchCredentialMatch,
  SearchResult
} from "./types";

interface SearchCandidate {
  reason: string;
  values: Array<string | null | undefined>;
  weight: number;
  intended?: boolean;
}

export interface RankedSearchResult {
  result: SearchResult;
  score: number;
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").normalize("NFKC").trim().toLowerCase();
}

function queryTokens(query: string): string[] {
  return normalize(query).split(/\s+/).filter(Boolean);
}

function hasFieldIntent(reason: string, query: string): boolean {
  const normalized = normalize(query);
  const compact = normalized.replace(/[\s_-]+/g, "");
  if (reason === "WAN IP") return /\bwan\b/.test(normalized) || compact.includes("wanip") || /公网|外网/.test(normalized);
  if (reason === "LAN IP") return /\blan\b/.test(normalized) || compact.includes("lanip") || /内网|局域网/.test(normalized);
  if (reason === "Web UI" || reason === "Credential Web UI") {
    return /\b(web\s*ui|webui|login|portal|url)\b/.test(normalized) || /登录|后台|管理界面/.test(normalized);
  }
  if (reason === "Hostname" || reason === "Credential host") {
    return /\b(host|hostname)\b/.test(normalized) || /主机名?/.test(normalized);
  }
  if (reason === "MAC") return /\bmac\b/.test(normalized) || /mac地址/.test(normalized);
  if (reason === "Phone") return /\b(phone|telephone)\b/.test(normalized) || /电话|号码/.test(normalized);
  if (reason === "Extension") return /\b(extension|ext)\b/.test(normalized) || /分机/.test(normalized);
  return false;
}

function candidateScore(candidate: SearchCandidate, phrase: string, tokens: string[]): { score: number; matches: number } {
  let score = 0;
  let matches = 0;
  for (const rawValue of candidate.values) {
    const value = normalize(rawValue);
    if (!value) continue;
    const matchedTokens = tokens.filter((token) => value.includes(token)).length;
    matches = Math.max(matches, matchedTokens);
    let quality = 0;
    if (value === phrase) quality = 1000;
    else if (value.startsWith(phrase)) quality = 850;
    else if (value.includes(phrase)) quality = 700;
    else if (tokens.length && matchedTokens === tokens.length) quality = 560;
    else if (matchedTokens) quality = Math.round((matchedTokens / tokens.length) * 240);
    score = Math.max(score, quality + candidate.weight);
  }
  return { score, matches };
}

function rankResult(result: SearchResult, query: string, candidates: SearchCandidate[]): RankedSearchResult {
  const phrase = normalize(query);
  const tokens = queryTokens(query);
  const scored = candidates
    .map((candidate) => ({ candidate, ...candidateScore(candidate, phrase, tokens) }))
    .filter((item) => item.matches > 0)
    .sort((a, b) => b.score - a.score);
  const combined = normalize(candidates.flatMap((candidate) => candidate.values).filter(Boolean).join(" "));
  const combinedMatches = tokens.filter((token) => combined.includes(token)).length;
  const completeMatch = Boolean(tokens.length) && combinedMatches === tokens.length;
  const intended = scored
    .filter((item) => item.candidate.intended)
    .sort((a, b) => b.score - a.score)[0];
  const best = scored[0];
  const useIntendedReason = Boolean(
    completeMatch
      && intended
      && intended.score >= (best?.score ?? 0) * 0.5
  );
  const matchReason = useIntendedReason
    ? intended?.candidate.reason
    : best?.candidate.reason ?? "Related record";
  const score = (best?.score ?? 0)
    + (completeMatch ? 180 : Math.round((combinedMatches / Math.max(tokens.length, 1)) * 80))
    + (useIntendedReason ? 260 : 0);
  return {
    result: { ...result, matchReason },
    score
  };
}

export function caseSearchResult(item: CaseRecord, query: string): RankedSearchResult {
  const result: SearchResult = {
    type: "case",
    id: item.caseId,
    title: `${item.caseNumber} - ${item.propertyAddress}`,
    subtitle: `${item.city}, ${item.state} ${item.zipCode}`,
    meta: item.status
  };
  return rankResult(result, query, [
    { reason: "Service title", values: [item.propertyAddress], weight: 120 },
    { reason: "Service number", values: [item.caseNumber], weight: 125 },
    { reason: "Organization", values: [item.customerOrganizationName], weight: 75 },
    { reason: "Service type", values: [item.caseTypeName, item.caseTypeCode], weight: 55 },
    { reason: "Location", values: [item.city, item.state, item.zipCode], weight: 40 },
    { reason: "Tag", values: item.tags.map((tag) => tag.name), weight: 35 },
    { reason: "Service notes", values: [item.notes], weight: 10 }
  ]);
}

export function contactSearchResult(item: Contact, query: string): RankedSearchResult {
  const title = contactDisplayName(item);
  const result: SearchResult = {
    type: "contact",
    id: item.contactId,
    title,
    subtitle: [item.jobTitle, item.partyOrganizationName || item.email].filter(Boolean).join(" · "),
    meta: item.phone
  };
  return rankResult(result, query, [
    { reason: "Contact name", values: [title, item.displayName, item.firstName, item.lastName], weight: 120 },
    { reason: "Phone number", values: [item.phone], weight: 110 },
    { reason: "Email", values: [item.email], weight: 105 },
    { reason: "Organization", values: [item.partyOrganizationName], weight: 75 },
    { reason: "Job title", values: [item.jobTitle], weight: 55 },
    { reason: "Address", values: [item.address], weight: 35 },
    { reason: "Contact notes", values: [item.notes], weight: 10 }
  ]);
}

export function organizationSearchResult(item: PartyOrganization, query: string): RankedSearchResult {
  const result: SearchResult = {
    type: "organization",
    id: item.partyOrganizationId,
    title: item.name,
    subtitle: [item.type, item.city && item.state ? `${item.city}, ${item.state}` : item.email].filter(Boolean).join(" · "),
    meta: item.phone || item.website
  };
  return rankResult(result, query, [
    { reason: "Organization name", values: [item.name], weight: 120 },
    { reason: "Phone number", values: [item.phone, item.fax], weight: 110 },
    { reason: "Email", values: [item.email], weight: 105 },
    { reason: "Website", values: [item.website], weight: 100 },
    { reason: "Organization type", values: [item.type], weight: 55 },
    { reason: "Location", values: [item.addressLine1, item.addressLine2, item.city, item.state, item.zipCode], weight: 35 },
    { reason: "Organization notes", values: [item.notes], weight: 10 }
  ]);
}

export function assetSearchResult(
  item: ManagedAsset,
  query: string,
  credentialMatches: SearchCredentialMatch[] = []
): RankedSearchResult {
  const quickValues = assetSearchQuickValues(item, query);
  const result: SearchResult = {
    type: "asset",
    id: item.assetId,
    title: item.name,
    subtitle: [item.assetType, item.partyOrganizationName, item.caseNumber].filter(Boolean).join(" · "),
    meta: item.status,
    quickValues,
    ...(credentialMatches.length
      ? { credentialMatches: credentialMatches.slice(0, 2), credentialMatchCount: credentialMatches.length }
      : {})
  };
  const credentialCandidates: SearchCandidate[] = credentialMatches.flatMap((credential) => [
    {
      reason: "Credential host",
      values: [credential.host, credential.host ? "host server ip address endpoint 主机 地址" : ""],
      weight: 130,
      intended: hasFieldIntent("Credential host", query)
    },
    {
      reason: "Credential Web UI",
      values: [credential.loginUrl, credential.loginUrl ? "web ui webui login url portal management 登录 后台 管理界面" : ""],
      weight: 130,
      intended: hasFieldIntent("Credential Web UI", query)
    },
    { reason: "Credential label", values: [credential.label], weight: 100 },
    { reason: "Credential type", values: [credential.credentialType], weight: 80 }
  ]);
  const ranked = rankResult(result, query, [
    { reason: "Asset name", values: [item.name], weight: 120 },
    ...quickValues.map((value) => ({
      reason: value.label,
      values: [
        value.value,
        value.label,
        value.label === "Web UI" ? "webui web ui login url portal management 登录 后台 管理界面" : ""
      ],
      weight: 125,
      intended: hasFieldIntent(value.label, query)
    })),
    ...credentialCandidates,
    {
      reason: "Asset identifier",
      values: [item.serialNumber, item.macAddress, item.imei, item.iccid, item.phoneNumber, item.extension],
      weight: 115
    },
    { reason: "Hostname", values: [item.hostname, "host hostname host name 主机 主机名"], weight: 115 },
    { reason: "LAN IP", values: [item.lanIp, "lan lan ip local ip private ip 内网 局域网"], weight: 115 },
    { reason: "WAN IP", values: [item.wanIp, "wan wan ip public ip external ip endpoint 公网 外网"], weight: 115 },
    { reason: "Service", values: [item.caseNumber, item.caseTitle], weight: 80 },
    { reason: "Organization", values: [item.partyOrganizationName], weight: 75 },
    { reason: "Asset type", values: [item.assetType, item.manufacturer, item.model], weight: 55 },
    { reason: "Installed location", values: [item.installedLocation], weight: 35 },
    { reason: "Asset notes", values: [item.notes], weight: 10 }
  ]);
  return credentialMatches.length ? { ...ranked, score: ranked.score + 100 } : ranked;
}

export function documentSearchResult(
  item: DocumentRecord,
  context: { caseNumber: string; propertyAddress: string },
  query: string
): RankedSearchResult {
  const result: SearchResult = {
    type: "document",
    id: item.documentId,
    caseId: item.caseId ?? undefined,
    title: item.originalFileName,
    subtitle: `${context.caseNumber} · ${item.category}`,
    meta: item.tags.length ? item.tags.map((tag) => tag.name).join(", ") : item.uploadedByName
  };
  return rankResult(result, query, [
    { reason: "File name", values: [item.originalFileName, item.fileName], weight: 120 },
    { reason: "Service", values: [context.caseNumber, context.propertyAddress], weight: 80 },
    { reason: "Document category", values: [item.category], weight: 60 },
    { reason: "Document tag", values: item.tags.map((tag) => tag.name), weight: 50 },
    { reason: "Document notes", values: [item.notes, item.reviewNotes], weight: 10 }
  ]);
}

export function knowledgeSearchResult(item: KnowledgeItem, query: string): RankedSearchResult {
  const result: SearchResult = {
    type: "knowledge",
    id: item.knowledgeId,
    caseId: item.sourceServiceId ?? undefined,
    title: item.title,
    subtitle: [item.type, item.component, item.sourceServiceNumber].filter(Boolean).join(" · "),
    meta: item.status
  };
  return rankResult(result, query, [
    { reason: "Knowledge title", values: [item.title], weight: 120 },
    { reason: "Component", values: [item.component], weight: 80 },
    { reason: "Service", values: [item.sourceServiceNumber, item.sourceServiceTitle], weight: 75 },
    { reason: "Keyword", values: item.keywords, weight: 60 },
    { reason: "Knowledge type", values: [item.type, item.status], weight: 50 },
    { reason: "Summary", values: [item.summary], weight: 40 },
    { reason: "Credential reference", values: [item.credentialReference], weight: 35 },
    { reason: "Knowledge body", values: [item.body], weight: 10 }
  ]);
}

export function manuscriptSearchResult(item: Manuscript, query: string): RankedSearchResult {
  const result: SearchResult = {
    type: "manuscript",
    id: item.manuscriptId,
    title: item.title,
    subtitle: `${item.kind} · ${item.chapterCount} chapters`,
    meta: `${item.characterCount.toLocaleString()} characters`
  };
  return rankResult(result, query, [
    { reason: "Long-form title", values: [item.title], weight: 120 },
    { reason: "Description", values: [item.description], weight: 50 },
    { reason: "Chapter title", values: item.chapters.map((chapter) => chapter.title), weight: 65 },
    { reason: "Work type", values: [item.kind, item.status], weight: 30 },
    { reason: "Chapter text", values: [query], weight: -500 }
  ]);
}

const typePriority: Record<SearchResult["type"], number> = {
  asset: 6,
  case: 5,
  organization: 4,
  contact: 3,
  knowledge: 2,
  manuscript: 3,
  document: 1
};

export function finalizeSearchResults(entries: RankedSearchResult[], limit = 12): SearchResult[] {
  return entries
    .filter((entry) => entry.score > 0)
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) =>
      b.score - a.score
      || typePriority[b.result.type] - typePriority[a.result.type]
      || a.index - b.index
    )
    .slice(0, limit)
    .map((entry) => entry.result);
}
