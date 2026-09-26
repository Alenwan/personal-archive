const AUDIO_PREVIEW_EXTENSIONS = new Set([
  "aac",
  "aif",
  "aiff",
  "alac",
  "flac",
  "m4a",
  "mp3",
  "oga",
  "ogg",
  "opus",
  "wav",
  "weba",
  "wma"
]);

export function isAudioPreviewFile(mimeType: string | null | undefined, fileName: string | null | undefined) {
  if (mimeType?.toLowerCase().startsWith("audio/")) return true;
  const extension = fileName?.toLowerCase().split(".").pop() ?? "";
  return AUDIO_PREVIEW_EXTENSIONS.has(extension);
}
