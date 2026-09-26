import type { PrivateVaultItem, PrivateVaultItemMetadata } from "./types";

export type PrivateVaultSortField = "name" | "location" | "updated" | "opened" | "size" | "type";
export type PrivateVaultSortDirection = "asc" | "desc";

export interface PrivateVaultOrderItem extends PrivateVaultItem {
  metadata: PrivateVaultItemMetadata | null;
}

const NATURAL_TEXT_OPTIONS: Intl.CollatorOptions = { numeric: true, sensitivity: "base" };

function compareNaturalText(left: string, right: string): number {
  return left.localeCompare(right, undefined, NATURAL_TEXT_OPTIONS);
}

function extension(fileName: string): string {
  return fileName.match(/\.([A-Za-z0-9]{1,8})$/)?.[1]?.toUpperCase() ?? "FILE";
}

function timestamp(value: string | null | undefined): number {
  const parsed = value ? new Date(value).getTime() : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function comparePrivateVaultItems(
  left: PrivateVaultOrderItem,
  right: PrivateVaultOrderItem,
  field: PrivateVaultSortField,
  direction: PrivateVaultSortDirection,
  resolveFolderName: (folderId: string | null | undefined) => string
): number {
  const leftMetadata = left.metadata;
  const rightMetadata = right.metadata;
  if (!leftMetadata || !rightMetadata) {
    if (leftMetadata !== rightMetadata) return leftMetadata ? -1 : 1;
    return compareNaturalText(left.itemId, right.itemId);
  }

  const leftFolder = resolveFolderName(leftMetadata.folderId);
  const rightFolder = resolveFolderName(rightMetadata.folderId);
  let primary = 0;
  if (field === "name") primary = compareNaturalText(leftMetadata.fileName, rightMetadata.fileName);
  else if (field === "location") primary = compareNaturalText(leftFolder, rightFolder);
  else if (field === "size") primary = leftMetadata.size - rightMetadata.size;
  else if (field === "type") primary = compareNaturalText(extension(leftMetadata.fileName), extension(rightMetadata.fileName));
  else if (field === "opened") primary = timestamp(leftMetadata.lastOpenedAt) - timestamp(rightMetadata.lastOpenedAt);
  else primary = timestamp(left.updatedAt) - timestamp(right.updatedAt);

  const tieBreakers = [
    primary,
    compareNaturalText(leftMetadata.fileName, rightMetadata.fileName),
    compareNaturalText(leftFolder, rightFolder),
    compareNaturalText(left.itemId, right.itemId)
  ];
  const result = tieBreakers.find((candidate) => candidate !== 0) ?? 0;
  return direction === "asc" ? result : -result;
}

export function createPrivateVaultImageSequence<T extends { itemId: string }>(
  visibleItems: readonly T[],
  currentItemId: string,
  isImage: (item: T) => boolean
): string[] {
  const imageIds = visibleItems.filter(isImage).map((item) => item.itemId);
  return imageIds.includes(currentItemId) ? imageIds : [currentItemId];
}

export function privateVaultSortLabel(field: PrivateVaultSortField, direction: PrivateVaultSortDirection): string {
  const fieldLabel: Record<PrivateVaultSortField, string> = {
    name: "Name",
    location: "Location",
    updated: "Modified",
    opened: "Last opened",
    size: "Size",
    type: "Type"
  };
  const directionLabel = field === "updated" || field === "opened"
    ? direction === "asc" ? "oldest first" : "newest first"
    : field === "size"
      ? direction === "asc" ? "smallest first" : "largest first"
      : direction === "asc" ? "A–Z" : "Z–A";
  return `${fieldLabel[field]} ${directionLabel}`;
}
