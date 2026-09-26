<script setup lang="ts">
import {
  ChevronDown,
  ChevronUp,
  ListMusic,
  LoaderCircle,
  Pause,
  Play,
  Repeat,
  Repeat1,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X
} from "lucide-vue-next";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useArchiveAudioPlayerStore } from "../../stores/archiveAudioPlayer";

const player = useArchiveAudioPlayerStore();
const audioElement = ref<HTMLAudioElement | null>(null);

const progressMaximum = computed(() => Math.max(player.duration, 0));
const progressValue = computed(() => Math.min(player.currentTime, progressMaximum.value));
const bufferedPercent = computed(() => player.duration > 0 ? Math.min(100, (player.bufferedUntil / player.duration) * 100) : 0);
const repeatLabel = computed(() => {
  if (player.repeatMode === "one") return "Repeat current track";
  if (player.repeatMode === "all") return "Repeat queue";
  return "Repeat is off";
});

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  const minutes = Math.floor(value / 60);
  return `${minutes}:${seconds}`;
}

function onSeekInput(event: Event) {
  player.seek(Number.parseFloat((event.target as HTMLInputElement).value));
}

function onVolumeInput(event: Event) {
  player.setVolume(Number.parseFloat((event.target as HTMLInputElement).value));
}

function installMediaSessionHandlers() {
  if (!("mediaSession" in navigator)) return;
  const handlers: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
    ["play", () => void player.play()],
    ["pause", () => player.pause()],
    ["previoustrack", () => player.previous()],
    ["nexttrack", () => player.next()],
    ["seekbackward", (details) => player.seek(player.currentTime - (details.seekOffset ?? 10))],
    ["seekforward", (details) => player.seek(player.currentTime + (details.seekOffset ?? 10))],
    ["seekto", (details) => details.seekTime !== undefined && player.seek(details.seekTime)]
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Older mobile WebKit versions expose a partial Media Session implementation.
    }
  }
}

onMounted(() => {
  player.registerAudioElement(audioElement.value);
  installMediaSessionHandlers();
});

onBeforeUnmount(() => {
  player.registerAudioElement(null);
  if (!("mediaSession" in navigator)) return;
  for (const action of ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward", "seekto"] as MediaSessionAction[]) {
    try {
      navigator.mediaSession.setActionHandler(action, null);
    } catch {
      // Ignore unsupported actions while detaching the player.
    }
  }
});
</script>

<template>
  <audio
    ref="audioElement"
    class="hidden"
    preload="metadata"
    @timeupdate="player.updateProgress"
    @progress="player.updateProgress"
    @durationchange="player.updateProgress"
    @loadedmetadata="player.onLoadedMetadata"
    @canplay="player.onLoadedMetadata"
    @playing="player.onPlaying"
    @pause="player.onPause"
    @ended="player.onEnded"
    @error="player.onError"
  />
  <Transition name="archive-player">
    <section v-if="player.visible" class="archive-audio-player" aria-label="Archive audio player">
      <Transition name="archive-queue">
        <section v-if="player.queueOpen" class="archive-audio-queue" aria-label="Current playback queue">
          <header>
            <div class="min-w-0">
              <p>Playing from</p>
              <h2>{{ player.contextLabel }}</h2>
            </div>
            <span>{{ player.queue.length }} tracks</span>
          </header>
          <ol>
            <li v-for="(track, index) in player.queue" :key="track.documentId">
              <button
                type="button"
                :class="index === player.currentIndex ? 'is-current' : ''"
                :aria-current="index === player.currentIndex ? 'true' : undefined"
                @click="player.selectTrack(index)"
              >
                <span class="archive-audio-queue-index">
                  <Volume2 v-if="index === player.currentIndex && player.isPlaying" />
                  <span v-else>{{ index + 1 }}</span>
                </span>
                <span class="min-w-0 flex-1">
                  <strong>{{ track.title }}</strong>
                  <small>{{ track.folderName }}</small>
                </span>
              </button>
            </li>
          </ol>
        </section>
      </Transition>

      <div class="archive-audio-track">
        <div class="archive-audio-art" aria-hidden="true"><ListMusic /></div>
        <div class="min-w-0">
          <p>{{ player.contextLabel }}</p>
          <strong :title="player.currentTrack?.title">{{ player.currentTrack?.title }}</strong>
          <small>{{ player.queuePosition }} of {{ player.queue.length }}</small>
        </div>
      </div>

      <div class="archive-audio-transport">
        <div class="archive-audio-buttons">
          <button type="button" title="Previous track" aria-label="Previous track" @click="player.previous">
            <SkipBack />
          </button>
          <button
            class="archive-audio-play"
            type="button"
            :title="player.isPlaying ? 'Pause' : 'Play'"
            :aria-label="player.isPlaying ? 'Pause' : 'Play'"
            @click="player.togglePlayback"
          >
            <LoaderCircle v-if="player.isLoading" class="animate-spin" />
            <Pause v-else-if="player.isPlaying" />
            <Play v-else class="translate-x-px" />
          </button>
          <button type="button" title="Next track" aria-label="Next track" @click="player.next()">
            <SkipForward />
          </button>
        </div>
        <div class="archive-audio-timeline">
          <span>{{ formatPlaybackTime(player.currentTime) }}</span>
          <div class="archive-audio-range-wrap" :style="{ '--buffered': `${bufferedPercent}%` }">
            <input
              type="range"
              min="0"
              :max="progressMaximum"
              step="0.1"
              :value="progressValue"
              aria-label="Playback position"
              @input="onSeekInput"
            />
          </div>
          <span>{{ formatPlaybackTime(player.duration) }}</span>
        </div>
        <p v-if="player.error" class="archive-audio-error" role="status">{{ player.error }}</p>
      </div>

      <div class="archive-audio-tools">
        <button
          type="button"
          :class="player.repeatMode !== 'off' ? 'is-active' : ''"
          :title="`${repeatLabel}. Change repeat mode`"
          :aria-label="`${repeatLabel}. Change repeat mode`"
          @click="player.cycleRepeatMode"
        >
          <Repeat1 v-if="player.repeatMode === 'one'" />
          <Repeat v-else />
        </button>
        <div class="archive-audio-volume">
          <button type="button" :title="player.muted ? 'Unmute' : 'Mute'" :aria-label="player.muted ? 'Unmute' : 'Mute'" @click="player.toggleMuted">
            <VolumeX v-if="player.muted || player.volume === 0" />
            <Volume2 v-else />
          </button>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            :value="player.volume"
            aria-label="Volume"
            @input="onVolumeInput"
          />
        </div>
        <button
          type="button"
          :class="player.queueOpen ? 'is-active' : ''"
          :title="player.queueOpen ? 'Hide queue' : 'Show queue'"
          :aria-label="player.queueOpen ? 'Hide queue' : 'Show queue'"
          :aria-expanded="player.queueOpen"
          @click="player.queueOpen = !player.queueOpen"
        >
          <ListMusic />
          <ChevronDown v-if="player.queueOpen" class="archive-audio-tool-caret" />
          <ChevronUp v-else class="archive-audio-tool-caret" />
        </button>
        <button type="button" title="Close player" aria-label="Close player" @click="player.closePlayer">
          <X />
        </button>
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.archive-audio-player {
  --player-line: color-mix(in srgb, var(--personal-border, #d8d8cd) 82%, transparent);
  --player-ink: var(--personal-text, #20201d);
  --player-muted: var(--personal-muted, #6c6c63);
  --player-surface: color-mix(in srgb, var(--personal-surface-raised, #fff) 94%, transparent);
  position: fixed;
  right: 0.75rem;
  bottom: max(0.75rem, env(safe-area-inset-bottom));
  left: 0.75rem;
  z-index: 45;
  display: grid;
  grid-template-columns: minmax(12rem, 0.9fr) minmax(20rem, 1.45fr) auto;
  align-items: center;
  gap: 1rem;
  min-height: 5.15rem;
  border: 1px solid var(--player-line);
  border-radius: 1rem;
  background: var(--player-surface);
  padding: 0.65rem 0.75rem;
  color: var(--player-ink);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--player-ink) 18%, transparent);
  backdrop-filter: blur(18px);
  transition: left 180ms ease, right 180ms ease, transform 180ms ease, opacity 180ms ease;
}

.archive-audio-track {
  display: grid;
  min-width: 0;
  grid-template-columns: 2.9rem minmax(0, 1fr);
  align-items: center;
  gap: 0.7rem;
}

.archive-audio-art {
  display: grid;
  width: 2.9rem;
  height: 2.9rem;
  place-items: center;
  border-radius: 0.75rem;
  background: var(--personal-accent-soft, #dff0ec);
  color: var(--personal-accent-strong, #245e56);
}

.archive-audio-art svg { width: 1.25rem; height: 1.25rem; }
.archive-audio-track p { overflow: hidden; color: var(--player-muted); font-size: 0.62rem; font-weight: 750; letter-spacing: 0.05em; text-overflow: ellipsis; text-transform: uppercase; white-space: nowrap; }
.archive-audio-track strong { display: block; overflow: hidden; margin-top: 0.1rem; font-size: 0.79rem; text-overflow: ellipsis; white-space: nowrap; }
.archive-audio-track small { display: block; margin-top: 0.08rem; color: var(--player-muted); font-size: 0.63rem; }

.archive-audio-transport { min-width: 0; }
.archive-audio-buttons { display: flex; align-items: center; justify-content: center; gap: 0.45rem; }
.archive-audio-buttons button,
.archive-audio-tools button {
  display: grid;
  width: 2.15rem;
  height: 2.15rem;
  place-items: center;
  border-radius: 0.58rem;
  color: var(--player-muted);
  transition: background-color 140ms ease, color 140ms ease, transform 140ms ease;
}
.archive-audio-buttons button:hover,
.archive-audio-tools button:hover,
.archive-audio-tools button.is-active {
  background: var(--personal-accent-soft, #dff0ec);
  color: var(--personal-accent-strong, #245e56);
}
.archive-audio-buttons button:active,
.archive-audio-tools button:active { transform: scale(0.94); }
.archive-audio-buttons svg,
.archive-audio-tools svg { width: 1rem; height: 1rem; }
.archive-audio-buttons .archive-audio-play {
  width: 2.55rem;
  height: 2.55rem;
  border-radius: 999px;
  background: var(--personal-accent, #397f75);
  color: var(--personal-accent-contrast, #fff);
}
.archive-audio-buttons .archive-audio-play:hover { background: var(--personal-accent-strong, #245e56); color: var(--personal-accent-contrast, #fff); }

.archive-audio-timeline { display: grid; grid-template-columns: 2.8rem minmax(0, 1fr) 2.8rem; align-items: center; gap: 0.45rem; margin-top: 0.15rem; }
.archive-audio-timeline > span { color: var(--player-muted); font-size: 0.6rem; font-variant-numeric: tabular-nums; }
.archive-audio-timeline > span:last-child { text-align: right; }
.archive-audio-range-wrap { position: relative; height: 1rem; }
.archive-audio-range-wrap::before { position: absolute; top: 50%; right: 0; left: 0; height: 0.22rem; border-radius: 999px; background: linear-gradient(to right, color-mix(in srgb, var(--personal-accent, #397f75) 35%, var(--personal-border, #d8d8cd)) var(--buffered), var(--personal-border, #d8d8cd) var(--buffered)); content: ""; transform: translateY(-50%); }
.archive-audio-timeline input,
.archive-audio-volume input { position: relative; width: 100%; accent-color: var(--personal-accent, #397f75); }
.archive-audio-error { overflow: hidden; margin-top: 0.1rem; color: #a33b2f; font-size: 0.62rem; text-align: center; text-overflow: ellipsis; white-space: nowrap; }

.archive-audio-tools { display: flex; align-items: center; justify-content: flex-end; gap: 0.2rem; }
.archive-audio-volume { display: flex; width: 7rem; align-items: center; gap: 0.25rem; }
.archive-audio-volume button { flex: 0 0 auto; }
.archive-audio-tool-caret { width: 0.55rem !important; height: 0.55rem !important; margin-top: -0.2rem; }

.archive-audio-queue {
  position: absolute;
  right: 0;
  bottom: calc(100% + 0.55rem);
  width: min(31rem, calc(100vw - 1.5rem));
  max-height: min(28rem, calc(100dvh - 8rem));
  overflow: hidden;
  border: 1px solid var(--player-line);
  border-radius: 0.9rem;
  background: var(--personal-surface-raised, #fff);
  box-shadow: 0 18px 48px color-mix(in srgb, var(--player-ink) 18%, transparent);
}
.archive-audio-queue header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--player-line); padding: 0.8rem 0.9rem; }
.archive-audio-queue header p { color: var(--player-muted); font-size: 0.6rem; font-weight: 760; letter-spacing: 0.06em; text-transform: uppercase; }
.archive-audio-queue header h2 { overflow: hidden; margin-top: 0.12rem; font-size: 0.82rem; text-overflow: ellipsis; white-space: nowrap; }
.archive-audio-queue header > span { flex: 0 0 auto; color: var(--player-muted); font-size: 0.68rem; }
.archive-audio-queue ol { max-height: min(23rem, calc(100dvh - 12rem)); overflow-y: auto; padding: 0.35rem; }
.archive-audio-queue li button { display: flex; width: 100%; min-height: 3.3rem; align-items: center; gap: 0.65rem; border-radius: 0.6rem; padding: 0.45rem 0.55rem; text-align: left; transition: background-color 130ms ease; }
.archive-audio-queue li button:hover { background: color-mix(in srgb, var(--personal-accent-soft, #dff0ec) 52%, transparent); }
.archive-audio-queue li button.is-current { background: var(--personal-accent-soft, #dff0ec); color: var(--personal-accent-strong, #245e56); }
.archive-audio-queue-index { display: grid; width: 1.7rem; height: 1.7rem; flex: 0 0 auto; place-items: center; color: var(--player-muted); font-size: 0.65rem; font-variant-numeric: tabular-nums; }
.archive-audio-queue-index svg { width: 0.85rem; height: 0.85rem; }
.archive-audio-queue strong { display: block; overflow: hidden; font-size: 0.74rem; text-overflow: ellipsis; white-space: nowrap; }
.archive-audio-queue small { display: block; overflow: hidden; margin-top: 0.15rem; color: var(--player-muted); font-size: 0.62rem; text-overflow: ellipsis; white-space: nowrap; }

.archive-player-enter-active,
.archive-player-leave-active { transition: opacity 170ms ease, transform 170ms ease; }
.archive-player-enter-from,
.archive-player-leave-to { opacity: 0; transform: translateY(0.75rem); }
.archive-queue-enter-active,
.archive-queue-leave-active { transition: opacity 150ms ease, transform 150ms ease; transform-origin: bottom right; }
.archive-queue-enter-from,
.archive-queue-leave-to { opacity: 0; transform: translateY(0.5rem) scale(0.98); }

@media (max-width: 840px) {
  .archive-audio-player {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.55rem 0.75rem;
    min-height: 8.25rem;
    padding: 0.65rem 0.7rem;
  }
  .archive-audio-track { grid-column: 1; grid-row: 1; grid-template-columns: 2.75rem minmax(0, 1fr); }
  .archive-audio-art { width: 2.75rem; height: 2.75rem; border-radius: 0.68rem; }
  .archive-audio-art svg { width: 1.35rem; height: 1.35rem; }
  .archive-audio-track strong { font-size: 0.86rem; }
  .archive-audio-track small { display: none; }
  .archive-audio-tools { grid-column: 2; grid-row: 1; }
  .archive-audio-tools button { width: 2.75rem; height: 2.75rem; border-radius: 0.72rem; }
  .archive-audio-tools svg { width: 1.15rem; height: 1.15rem; }
  .archive-audio-volume { display: none; }
  .archive-audio-transport { display: grid; grid-column: 1 / -1; grid-row: 2; grid-template-columns: auto minmax(0, 1fr); align-items: center; gap: 0.5rem; }
  .archive-audio-buttons { justify-content: flex-start; }
  .archive-audio-buttons button { width: 2.75rem; height: 2.75rem; border-radius: 0.72rem; }
  .archive-audio-buttons .archive-audio-play { width: 3.25rem; height: 3.25rem; }
  .archive-audio-buttons svg { width: 1.2rem; height: 1.2rem; }
  .archive-audio-timeline { margin: 0; }
  .archive-audio-error { grid-column: 1 / -1; }
  .archive-audio-queue { right: -0.05rem; }
}

@media (max-width: 640px) {
  .archive-audio-player {
    right: 0.45rem;
    bottom: max(0.45rem, env(safe-area-inset-bottom));
    left: 0.45rem;
    gap: 0.75rem 0.45rem;
    min-height: 12rem;
    border-radius: 1rem;
    padding: 0.75rem;
  }
  .archive-audio-track { grid-template-columns: 2.8rem minmax(0, 1fr); gap: 0.6rem; }
  .archive-audio-track p { font-size: 0.6rem; }
  .archive-audio-track strong { font-size: 0.86rem; }
  .archive-audio-track small { display: block; font-size: 0.65rem; }
  .archive-audio-tools { gap: 0.08rem; }
  .archive-audio-tools button { width: 2.75rem; height: 2.75rem; }
  .archive-audio-transport {
    grid-template-columns: minmax(0, 1fr);
    gap: 0.55rem;
  }
  .archive-audio-buttons { justify-content: center; gap: 0.8rem; }
  .archive-audio-buttons button {
    width: 3.5rem;
    height: 3.5rem;
    border: 1px solid var(--player-line);
    border-radius: 999px;
    background: color-mix(in srgb, var(--personal-surface-raised, #fff) 78%, transparent);
  }
  .archive-audio-buttons .archive-audio-play {
    width: 4.35rem;
    height: 4.35rem;
    border: 0;
    box-shadow: 0 0.45rem 1.15rem color-mix(in srgb, var(--personal-accent, #397f75) 30%, transparent);
  }
  .archive-audio-buttons svg { width: 1.5rem; height: 1.5rem; }
  .archive-audio-buttons .archive-audio-play svg { width: 1.75rem; height: 1.75rem; }
  .archive-audio-timeline { grid-template-columns: 2.6rem minmax(0, 1fr) 2.6rem; gap: 0.4rem; }
  .archive-audio-timeline > span { font-size: 0.68rem; }
  .archive-audio-range-wrap { height: 2rem; }
  .archive-audio-range-wrap::before { height: 0.35rem; }
  .archive-audio-timeline input {
    height: 2rem;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
  }
  .archive-audio-timeline input::-webkit-slider-runnable-track { height: 0.35rem; background: transparent; }
  .archive-audio-timeline input::-webkit-slider-thumb {
    width: 1.25rem;
    height: 1.25rem;
    margin-top: -0.45rem;
    border: 0.2rem solid var(--personal-surface-raised, #fff);
    border-radius: 999px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--personal-accent, #397f75);
    box-shadow: 0 0.12rem 0.35rem color-mix(in srgb, var(--player-ink) 28%, transparent);
  }
  .archive-audio-timeline input::-moz-range-track { height: 0.35rem; background: transparent; }
  .archive-audio-timeline input::-moz-range-thumb {
    width: 0.95rem;
    height: 0.95rem;
    border: 0.2rem solid var(--personal-surface-raised, #fff);
    border-radius: 999px;
    background: var(--personal-accent, #397f75);
  }
  .archive-audio-error { margin-top: -0.25rem; font-size: 0.68rem; }
  .archive-audio-queue {
    right: -0.3rem;
    width: calc(100vw - 0.9rem);
    max-height: calc(100dvh - 13.5rem - env(safe-area-inset-bottom));
  }
  .archive-audio-queue ol { max-height: calc(100dvh - 17.75rem - env(safe-area-inset-bottom)); }
  .archive-audio-queue li button { min-height: 4rem; padding: 0.65rem; }
  .archive-audio-queue-index { width: 2.2rem; height: 2.2rem; font-size: 0.75rem; }
  .archive-audio-queue strong { font-size: 0.82rem; }
  .archive-audio-queue small { font-size: 0.68rem; }
}

@media (max-width: 390px) {
  .archive-audio-player { right: 0.3rem; left: 0.3rem; padding: 0.65rem; }
  .archive-audio-art { width: 2.55rem; height: 2.55rem; }
  .archive-audio-track { grid-template-columns: 2.55rem minmax(0, 1fr); }
  .archive-audio-tools button { width: 2.6rem; height: 2.6rem; }
  .archive-audio-buttons { gap: 0.65rem; }
}

@media (prefers-reduced-motion: reduce) {
  .archive-audio-player,
  .archive-player-enter-active,
  .archive-player-leave-active,
  .archive-queue-enter-active,
  .archive-queue-leave-active { transition: none; }
}
</style>
