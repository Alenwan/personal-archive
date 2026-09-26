const IMAGE_PREVIEW_EXTENSIONS = new Set([
  "apng",
  "avif",
  "bmp",
  "cur",
  "dib",
  "gif",
  "heic",
  "heif",
  "ico",
  "j2c",
  "j2k",
  "jpe",
  "jpeg",
  "jfif",
  "jp2",
  "jpg",
  "jpx",
  "jxl",
  "pjp",
  "pjpeg",
  "png",
  "svg",
  "tif",
  "tiff",
  "webp"
]);

export function isImagePreviewFile(mimeType: string | null | undefined, fileName: string | null | undefined) {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  const extension = fileName?.toLowerCase().split(".").pop() ?? "";
  return IMAGE_PREVIEW_EXTENSIONS.has(extension);
}
