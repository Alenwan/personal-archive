import type { AssetFilters, ManagedAsset, SearchCredentialMatch, SearchQuickValue } from "./types";

type AssetQuickField = "wanIp" | "lanIp" | "hostname" | "macAddress" | "phoneNumber" | "extension";

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim());
}

export function isHttpUrl(value: string | null | undefined): boolean {
  return /^https?:\/\//i.test(value?.trim() ?? "");
}

function compareText(a: string | null | undefined, b: string | null | undefined): number {
  return (a ?? "").localeCompare(b ?? "", undefined, { sensitivity: "base" });
}

function compareNullableDate(a: string | null | undefined, b: string | null | undefined): number {
  if (a && b) return a.localeCompare(b);
  if (a) return 1;
  if (b) return -1;
  return 0;
}

export function hasAssetNetworkIdentifier(asset: ManagedAsset): boolean {
  return [asset.hostname, asset.lanIp, asset.wanIp].some(hasText);
}

export function hasAssetHardwareIdentifier(asset: ManagedAsset): boolean {
  return [asset.serialNumber, asset.macAddress, asset.imei, asset.iccid].some(hasText);
}

export function hasAssetPhoneIdentifier(asset: ManagedAsset): boolean {
  return [asset.phoneNumber, asset.extension].some(hasText);
}

function matchesIdentifierFilter(asset: ManagedAsset, filter: AssetFilters["identifiers"]): boolean {
  if (!filter) return true;
  if (filter === "missing-network") return !hasAssetNetworkIdentifier(asset);
  if (filter === "missing-hardware") return !hasAssetHardwareIdentifier(asset);
  if (filter === "missing-phone") return !hasAssetPhoneIdentifier(asset);
  return true;
}

function assetSearchText(asset: ManagedAsset): string {
  const endpointAliases = asset.wanIp
    ? isHttpUrl(asset.wanIp)
      ? "endpoint web ui webui management url login url portal 管理界面 登录地址"
      : "wan wan ip wanip public ip external ip endpoint 公网 外网"
    : "";
  return [
    asset.name,
    asset.assetType,
    asset.status,
    asset.partyOrganizationName,
    asset.caseNumber,
    asset.caseTitle,
    asset.parentAssetName,
    asset.manufacturer,
    asset.model,
    asset.serialNumber,
    asset.macAddress,
    asset.imei,
    asset.iccid,
    asset.phoneNumber,
    asset.extension,
    asset.hostname,
    asset.lanIp,
    asset.wanIp,
    asset.installedLocation,
    asset.notes,
    endpointAliases,
    asset.lanIp ? "lan lan ip lanip local ip private ip 内网 局域网" : "",
    asset.hostname ? "host hostname host name 主机 主机名" : "",
    asset.macAddress ? "mac mac address hardware address mac地址" : "",
    asset.phoneNumber ? "phone phone number telephone 电话 号码" : "",
    asset.extension ? "extension ext 分机" : ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function queryTokens(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

function credentialSearchText(credential: SearchCredentialMatch): string {
  const type = credential.credentialType.toLowerCase();
  return [
    credential.label,
    credential.credentialType,
    credential.host,
    credential.loginUrl,
    credential.host ? "host server ip address endpoint 主机 地址" : "",
    credential.loginUrl ? "web ui webui login url portal management endpoint 登录 后台 管理界面" : "",
    /sip/.test(type) ? "sip trunk pbx voip" : "",
    /vpn/.test(type) ? "vpn tunnel remote access" : "",
    /admin|user|portal/.test(type) ? "login account access" : "",
    /database|db|sql|mysql|mariadb/.test(`${type} ${credential.label.toLowerCase()}`)
      ? "database db sql mysql mariadb 数据库"
      : "",
    /ssh/.test(`${type} ${credential.label.toLowerCase()}`) ? "ssh shell terminal" : ""
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function hasCredentialSearchIntent(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return /\b(web\s*ui|webui|login|portal|credential|host|ssh|database|db|sql|mysql|mariadb|url)\b/.test(normalized)
    || /登录|后台|管理界面|凭证|数据库|主机/.test(normalized);
}

export function credentialMatchesAssetSearch(
  asset: ManagedAsset,
  credential: SearchCredentialMatch,
  query: string
): boolean {
  const tokens = queryTokens(query);
  if (!tokens.length) return false;
  const credentialText = credentialSearchText(credential);
  const combinedText = `${assetSearchText(asset)} ${credentialText}`;
  if (!tokens.every((token) => combinedText.includes(token))) return false;
  const rawCredentialText = [credential.label, credential.credentialType, credential.host, credential.loginUrl]
    .join(" ")
    .toLowerCase();
  return hasCredentialSearchIntent(query) || tokens.some((token) => rawCredentialText.includes(token));
}

export function assetQuickSearchFields(query: string): AssetQuickField[] {
  const normalized = query.trim().toLowerCase();
  const compact = normalized.replace(/[\s_-]+/g, "");
  const fields: AssetQuickField[] = [];
  const hasWan = /\bwan\b/.test(normalized) || compact.includes("wanip") || /公网|外网/.test(normalized);
  const hasLan = /\blan\b/.test(normalized) || compact.includes("lanip") || /内网|局域网/.test(normalized);
  const hasIp = /\bip\b/.test(normalized) || compact.includes("ip地址");
  const hasWebUi = /\b(web\s*ui|webui|url|portal|endpoint)\b/.test(normalized) || /登录地址|管理界面/.test(normalized);

  if (hasWan) fields.push("wanIp");
  if (hasLan) fields.push("lanIp");
  if (hasIp && !hasWan && !hasLan) fields.push("wanIp", "lanIp");
  if (hasWebUi) fields.push("wanIp");
  if (/\b(host|hostname)\b/.test(normalized) || /主机名?/.test(normalized)) fields.push("hostname");
  if (/\bmac\b/.test(normalized) || /mac地址/.test(normalized)) fields.push("macAddress");
  if (/\b(phone|telephone)\b/.test(normalized) || /电话|号码/.test(normalized)) fields.push("phoneNumber");
  if (/\b(extension|ext)\b/.test(normalized) || /分机/.test(normalized)) fields.push("extension");
  return [...new Set(fields)];
}

export function hasAssetQuickSearchIntent(query: string): boolean {
  return assetQuickSearchFields(query).length > 0;
}

export function assetSearchQuickValues(asset: ManagedAsset, query: string): SearchQuickValue[] {
  const requestedFields = assetQuickSearchFields(query);
  const fields = requestedFields.length
    ? requestedFields
    : (["wanIp", "lanIp", "hostname"] as AssetQuickField[]);
  const values: Record<AssetQuickField, SearchQuickValue> = {
    wanIp: {
      label: isHttpUrl(asset.wanIp) ? "Web UI" : "WAN IP",
      value: asset.wanIp,
      kind: isHttpUrl(asset.wanIp) ? "url" : "text"
    },
    lanIp: { label: "LAN IP", value: asset.lanIp },
    hostname: { label: "Hostname", value: asset.hostname },
    macAddress: { label: "MAC", value: asset.macAddress },
    phoneNumber: { label: "Phone", value: asset.phoneNumber },
    extension: { label: "Extension", value: asset.extension }
  };
  return fields.map((field) => values[field]).filter((item) => hasText(item.value)).slice(0, 3);
}

function matchesRelationship(value: string | null | undefined, filter: AssetFilters["organization"]): boolean {
  if (!filter) return true;
  if (filter === "linked") return hasText(value);
  if (filter === "unlinked") return !hasText(value);
  return true;
}

function compareAssets(a: ManagedAsset, b: ManagedAsset, filters: AssetFilters): number {
  const direction = filters.direction === "asc" ? 1 : -1;
  const sort = filters.sort ?? "updated";
  let result = 0;
  if (sort === "name") result = compareText(a.name, b.name);
  else if (sort === "type") result = compareText(a.assetType, b.assetType) || compareText(a.name, b.name);
  else if (sort === "organization") {
    result = compareText(a.partyOrganizationName, b.partyOrganizationName) || compareText(a.name, b.name);
  } else if (sort === "service") {
    result = compareText(a.caseNumber || a.caseTitle, b.caseNumber || b.caseTitle) || compareText(a.name, b.name);
  } else if (sort === "installedAt") {
    result = compareNullableDate(a.installedAt, b.installedAt) || compareText(a.name, b.name);
  } else if (sort === "lastServiceAt") {
    result = compareNullableDate(a.lastServiceAt, b.lastServiceAt) || compareText(a.name, b.name);
  } else {
    result = compareNullableDate(a.updatedAt, b.updatedAt) || compareText(a.name, b.name);
  }
  return result * direction;
}

export function filterAssets(assets: ManagedAsset[], filters: AssetFilters = {}): ManagedAsset[] {
  const tokens = queryTokens(filters.q ?? "");
  return assets
    .filter((asset) => {
      if (filters.type && asset.assetType !== filters.type) return false;
      if (filters.status && asset.status !== filters.status) return false;
      if (filters.partyOrganizationId && asset.partyOrganizationId !== filters.partyOrganizationId) return false;
      if (filters.caseId && asset.caseId !== filters.caseId) return false;
      if (filters.parentAssetId && asset.parentAssetId !== filters.parentAssetId) return false;
      if (!matchesRelationship(asset.partyOrganizationId, filters.organization)) return false;
      if (!matchesRelationship(asset.caseId, filters.service)) return false;
      if (!matchesRelationship(asset.parentAssetId, filters.parent)) return false;
      if (filters.credentials === "has" && asset.credentialCount <= 0) return false;
      if (filters.credentials === "none" && asset.credentialCount > 0) return false;
      if (!matchesIdentifierFilter(asset, filters.identifiers)) return false;
      if (!tokens.length) return true;
      const searchText = assetSearchText(asset);
      return tokens.every((token) => searchText.includes(token));
    })
    .sort((a, b) => compareAssets(a, b, filters));
}
