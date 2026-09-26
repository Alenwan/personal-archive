const naturalCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base"
});

export function naturalCompare(left: string | null | undefined, right: string | null | undefined): number {
  return naturalCollator.compare(left ?? "", right ?? "");
}

export function fileTypeLabel(fileName: string | null | undefined, mimeType = ""): string {
  const normalizedName = fileName?.trim() ?? "";
  const extensionMatch = normalizedName.match(/\.([^./\\]{1,24})$/);
  if (extensionMatch?.[1]) return extensionMatch[1].toLocaleLowerCase();
  return mimeType.trim().toLocaleLowerCase() || "file";
}
