import { contactDisplayName } from "../../shared/format";
import { formatReadablePhone, normalizePhoneNumber, phoneNumbersMatch } from "../../shared/phoneNumbers";
import type {
  CaseRecord,
  ManagedAsset,
  PartyOrganization,
  PbxCallEvent,
  PbxCallMatchedEntity,
  PbxCallMatchedService
} from "../../shared/types";
import type { AppRepository } from "../repositories/types";

export interface PbxCallSnapshotInput {
  callId: string;
  linkedId: string;
  uniqueId: string;
  status: PbxCallEvent["status"];
  direction: PbxCallEvent["direction"];
  callerNumber: string;
  callerName: string;
  destination: string;
  extension: string;
  channel: string;
  startedAt: string;
  answeredAt?: string | null;
  endedAt?: string | null;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function caseSummary(record: CaseRecord): PbxCallMatchedService {
  return {
    caseId: record.caseId,
    caseNumber: record.caseNumber,
    title: record.propertyAddress,
    status: record.status
  };
}

function pushContactMatch(matches: PbxCallMatchedEntity[], contact: Awaited<ReturnType<AppRepository["listContacts"]>>[number], matchedValue: string) {
  matches.push({
    type: "contact",
    id: contact.contactId,
    label: contactDisplayName(contact),
    detail: [contact.partyOrganizationName, contact.jobTitle].filter(Boolean).join(" · "),
    matchedField: "Contact phone",
    matchedValue
  });
}

function pushOrganizationMatch(matches: PbxCallMatchedEntity[], organization: PartyOrganization, matchedValue: string) {
  matches.push({
    type: "organization",
    id: organization.partyOrganizationId,
    label: organization.name,
    detail: [organization.city, organization.state].filter(Boolean).join(", "),
    matchedField: "Organization phone",
    matchedValue
  });
}

function pushAssetMatch(matches: PbxCallMatchedEntity[], asset: ManagedAsset, matchedField: string, matchedValue: string) {
  matches.push({
    type: "asset",
    id: asset.assetId,
    label: asset.name,
    detail: [asset.assetType, asset.partyOrganizationName].filter(Boolean).join(" · "),
    matchedField,
    matchedValue
  });
}

async function serviceMatchesForContacts(repo: AppRepository, contactIds: string[]): Promise<CaseRecord[]> {
  const rows = await Promise.all(contactIds.map((contactId) => repo.listContactCases(contactId)));
  return rows.flatMap((items) => items.map((item) => item.case).filter((item): item is CaseRecord => Boolean(item)));
}

async function serviceMatchesForOrganizations(repo: AppRepository, organizationIds: string[]): Promise<CaseRecord[]> {
  const directCases = await Promise.all(
    organizationIds.map((partyOrganizationId) => repo.listCases({ customerOrganizationId: partyOrganizationId }))
  );
  const partyCases = await Promise.all(organizationIds.map((partyOrganizationId) => repo.listPartyOrganizationCases(partyOrganizationId)));
  return [
    ...directCases.flat(),
    ...partyCases.flatMap((items) => items.map((item) => item.case).filter((item): item is CaseRecord => Boolean(item)))
  ];
}

async function serviceMatchesForAssets(repo: AppRepository, assets: ManagedAsset[]): Promise<CaseRecord[]> {
  const caseIds = uniqueBy(
    assets
      .map((asset) => asset.caseId)
      .filter((caseId): caseId is string => Boolean(caseId)),
    (caseId) => caseId
  );
  const cases = await Promise.all(caseIds.map((caseId) => repo.getCase(caseId)));
  return cases.filter((record): record is CaseRecord => Boolean(record));
}

export async function buildMatchedPbxCallEvent(repo: AppRepository, input: PbxCallSnapshotInput): Promise<PbxCallEvent> {
  const caller = normalizePhoneNumber(input.callerNumber);
  const matches: PbxCallMatchedEntity[] = [];

  const [matchedContacts, matchedOrganizations, matchedAssets] = await Promise.all([
    repo.findContactsByPhone(input.callerNumber),
    repo.findPartyOrganizationsByPhone(input.callerNumber),
    repo.findAssetsByPhoneOrExtension(input.callerNumber, input.extension)
  ]);

  for (const contact of matchedContacts.slice(0, 8)) {
    pushContactMatch(matches, contact, formatReadablePhone(contact.phone));
  }

  for (const organization of matchedOrganizations.slice(0, 8)) {
    pushOrganizationMatch(matches, organization, formatReadablePhone(organization.phone));
  }

  for (const asset of matchedAssets.slice(0, 8)) {
    const byPhone = phoneNumbersMatch(asset.phoneNumber, input.callerNumber);
    pushAssetMatch(
      matches,
      asset,
      byPhone ? "Asset phone number" : "Asset extension",
      byPhone ? formatReadablePhone(asset.phoneNumber) : asset.extension
    );
  }

  const serviceRecords = uniqueBy(
    [
      ...(await serviceMatchesForContacts(repo, matchedContacts.map((contact) => contact.contactId))),
      ...(await serviceMatchesForOrganizations(repo, matchedOrganizations.map((organization) => organization.partyOrganizationId))),
      ...(await serviceMatchesForAssets(repo, matchedAssets))
    ],
    (record) => record.caseId
  ).slice(0, 8);

  return {
    eventId: `${input.callId}-${input.status}-${Date.now()}`,
    provider: "Asterisk / PBX",
    externalProvider: "Issabel4 / Asterisk16",
    callId: input.callId,
    linkedId: input.linkedId,
    uniqueId: input.uniqueId,
    status: input.status,
    direction: input.direction,
    callerNumber: input.callerNumber,
    callerName: input.callerName,
    normalizedCallerNumber: caller.matchKeys[0] ?? caller.digits,
    displayCallerNumber: caller.display,
    destination: input.destination,
    extension: input.extension,
    channel: input.channel,
    startedAt: input.startedAt,
    answeredAt: input.answeredAt ?? null,
    endedAt: input.endedAt ?? null,
    updatedAt: input.updatedAt,
    matches: uniqueBy(matches, (match) => `${match.type}:${match.id}:${match.matchedField}`),
    services: serviceRecords.map(caseSummary),
    metadata: input.metadata ?? {}
  };
}
