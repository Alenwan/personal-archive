import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";
import type { DocumentRecord } from "../shared/types";

export type ArchiveAudioRepeatMode = "off" | "all" | "one";

export interface ArchiveAudioTrack {
  documentId: string;
  title: string;
  folderName: string;
}

const VOLUME_STORAGE_KEY = "personal-archive.audio-player.volume";
const REPEAT_STORAGE_KEY = "personal-archive.audio-player.repeat";

function storedVolume() {
  const value = Number.parseFloat(localStorage.getItem(VOLUME_STORAGE_KEY) ?? "");
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.85;
}

function storedRepeatMode(): ArchiveAudioRepeatMode {
  const value = localStorage.getItem(REPEAT_STORAGE_KEY);
  return value === "all" || value === "one" ? value : "off";
}

function toAudioTrack(document: DocumentRecord): ArchiveAudioTrack {
  return {
    documentId: document.documentId,
    title: document.originalFileName,
    folderName: document.folderName ?? "Unfiled"
  };
}

export const useArchiveAudioPlayerStore = defineStore("archive-audio-player", () => {
  const queue = ref<ArchiveAudioTrack[]>([]);
  const currentIndex = ref(-1);
  const contextLabel = ref("Archive");
  const isPlaying = ref(false);
  const isLoading = ref(false);
  const currentTime = ref(0);
  const duration = ref(0);
  const bufferedUntil = ref(0);
  const volume = ref(storedVolume());
  const muted = ref(false);
  const repeatMode = ref<ArchiveAudioRepeatMode>(storedRepeatMode());
  const queueOpen = ref(false);
  const error = ref("");
  const audioElement = shallowRef<HTMLAudioElement | null>(null);
  let loadRequestId = 0;

  const currentTrack = computed(() => queue.value[currentIndex.value] ?? null);
  const visible = computed(() => Boolean(currentTrack.value));
  const queuePosition = computed(() => currentIndex.value >= 0 ? currentIndex.value + 1 : 0);

  function updateMediaSession() {
    if (!("mediaSession" in navigator) || !currentTrack.value) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTrack.value.title,
      artist: contextLabel.value,
      album: "Personal Archive"
    });
  }

  function registerAudioElement(element: HTMLAudioElement | null) {
    audioElement.value = element;
    if (!element) return;
    element.volume = volume.value;
    element.muted = muted.value;
  }

  async function loadCurrent(autoplay = true) {
    const element = audioElement.value;
    const track = currentTrack.value;
    if (!element || !track) return;

    const requestId = ++loadRequestId;
    isLoading.value = true;
    error.value = "";
    currentTime.value = 0;
    duration.value = 0;
    bufferedUntil.value = 0;
    element.pause();
    element.src = `/api/documents/${track.documentId}/preview`;
    element.load();
    updateMediaSession();

    if (!autoplay) {
      isPlaying.value = false;
      return;
    }

    try {
      await element.play();
      if (requestId === loadRequestId) isPlaying.value = true;
    } catch {
      if (requestId !== loadRequestId) return;
      isPlaying.value = false;
      error.value = "Tap Play to start this track.";
    }
  }

  function setQueue(documents: DocumentRecord[], startDocumentId: string, label: string, autoplay = true) {
    const tracks = documents.map(toAudioTrack);
    const startIndex = tracks.findIndex((track) => track.documentId === startDocumentId);
    if (!tracks.length || startIndex < 0) return;
    queue.value = tracks;
    currentIndex.value = startIndex;
    contextLabel.value = label;
    queueOpen.value = false;
    void loadCurrent(autoplay);
  }

  function replaceQueuePreservingCurrent(documents: DocumentRecord[], expectedDocumentId: string, label: string) {
    if (currentTrack.value?.documentId !== expectedDocumentId) return;
    const tracks = documents.map(toAudioTrack);
    const nextIndex = tracks.findIndex((track) => track.documentId === expectedDocumentId);
    if (!tracks.length || nextIndex < 0) return;
    queue.value = tracks;
    currentIndex.value = nextIndex;
    contextLabel.value = label;
    updateMediaSession();
  }

  async function play() {
    const element = audioElement.value;
    if (!element || !currentTrack.value) return;
    error.value = "";
    if (!element.src) {
      await loadCurrent(true);
      return;
    }
    try {
      await element.play();
      isPlaying.value = true;
    } catch {
      isPlaying.value = false;
      error.value = "Playback could not start. Try closing another media preview, then press Play again.";
    }
  }

  function pause() {
    audioElement.value?.pause();
    isPlaying.value = false;
  }

  function togglePlayback() {
    if (isPlaying.value) pause();
    else void play();
  }

  function selectTrack(index: number, autoplay = true) {
    if (index < 0 || index >= queue.value.length) return;
    currentIndex.value = index;
    void loadCurrent(autoplay);
  }

  function next(automatic = false) {
    if (!queue.value.length) return;
    if (automatic && repeatMode.value === "one") {
      void loadCurrent(true);
      return;
    }
    if (currentIndex.value < queue.value.length - 1) {
      selectTrack(currentIndex.value + 1, true);
      return;
    }
    if (repeatMode.value === "all") {
      selectTrack(0, true);
      return;
    }
    isPlaying.value = false;
    if (audioElement.value) audioElement.value.currentTime = duration.value;
  }

  function previous() {
    const element = audioElement.value;
    if (!element || !queue.value.length) return;
    if (element.currentTime > 3 || currentIndex.value <= 0) {
      element.currentTime = 0;
      currentTime.value = 0;
      if (!isPlaying.value) void play();
      return;
    }
    selectTrack(currentIndex.value - 1, true);
  }

  function seek(value: number) {
    const element = audioElement.value;
    if (!element || !Number.isFinite(value)) return;
    element.currentTime = Math.min(duration.value || value, Math.max(0, value));
    currentTime.value = element.currentTime;
  }

  function setVolume(value: number) {
    const nextVolume = Math.min(1, Math.max(0, value));
    volume.value = nextVolume;
    muted.value = nextVolume === 0;
    if (audioElement.value) {
      audioElement.value.volume = nextVolume;
      audioElement.value.muted = muted.value;
    }
    localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume));
  }

  function toggleMuted() {
    muted.value = !muted.value;
    if (audioElement.value) audioElement.value.muted = muted.value;
  }

  function cycleRepeatMode() {
    repeatMode.value = repeatMode.value === "off" ? "all" : repeatMode.value === "all" ? "one" : "off";
    localStorage.setItem(REPEAT_STORAGE_KEY, repeatMode.value);
  }

  function updateProgress() {
    const element = audioElement.value;
    if (!element) return;
    currentTime.value = Number.isFinite(element.currentTime) ? element.currentTime : 0;
    duration.value = Number.isFinite(element.duration) ? element.duration : 0;
    const lastRange = element.buffered.length ? element.buffered.end(element.buffered.length - 1) : 0;
    bufferedUntil.value = Number.isFinite(lastRange) ? lastRange : 0;
  }

  function onLoadedMetadata() {
    isLoading.value = false;
    updateProgress();
    updateMediaSession();
  }

  function onPlaying() {
    isPlaying.value = true;
    isLoading.value = false;
    error.value = "";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "playing";
  }

  function onPause() {
    isPlaying.value = false;
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = "paused";
  }

  function onEnded() {
    next(true);
  }

  function onError() {
    isPlaying.value = false;
    isLoading.value = false;
    error.value = "This track could not be loaded. Try again or select another track.";
  }

  function closePlayer() {
    loadRequestId += 1;
    const element = audioElement.value;
    element?.pause();
    element?.removeAttribute("src");
    element?.load();
    queue.value = [];
    currentIndex.value = -1;
    isPlaying.value = false;
    isLoading.value = false;
    currentTime.value = 0;
    duration.value = 0;
    bufferedUntil.value = 0;
    queueOpen.value = false;
    error.value = "";
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = null;
      navigator.mediaSession.playbackState = "none";
    }
  }

  return {
    queue,
    currentIndex,
    currentTrack,
    contextLabel,
    visible,
    queuePosition,
    isPlaying,
    isLoading,
    currentTime,
    duration,
    bufferedUntil,
    volume,
    muted,
    repeatMode,
    queueOpen,
    error,
    registerAudioElement,
    setQueue,
    replaceQueuePreservingCurrent,
    play,
    pause,
    togglePlayback,
    selectTrack,
    next,
    previous,
    seek,
    setVolume,
    toggleMuted,
    cycleRepeatMode,
    updateProgress,
    onLoadedMetadata,
    onPlaying,
    onPause,
    onEnded,
    onError,
    closePlayer
  };
});
