export function downloadBlob(blob: Blob, name: string) {
  const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Allow the browser to finish consuming the file before releasing its URL.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
