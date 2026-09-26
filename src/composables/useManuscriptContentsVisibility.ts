import { useReaderContentsVisibility } from "./useReaderContentsVisibility";

const STORAGE_KEY = "personal-archive.manuscript-contents-open";

export function useManuscriptContentsVisibility() {
  return useReaderContentsVisibility(STORAGE_KEY);
}
