import { computed, ref, shallowRef } from "vue";
import { defineStore } from "pinia";

// UI-only state. Never move/recreate the audio element or change its source here.
export const useAudioPlayerPresentationStore = defineStore("audio-player-presentation", () => {
  const collapsed = ref(false);
  const surfaces = shallowRef<Array<{ token: symbol; host: HTMLElement | null }>>([]);
  const focusActive = computed(() => surfaces.value.length > 0);
  const modalHost = computed(() => [...surfaces.value].reverse().find(surface => surface.host)?.host ?? null);

  function collapse() { collapsed.value = true; }
  function expand() { collapsed.value = false; }
  function enterFocusSurface(host: HTMLElement | null = null) {
    const token = Symbol("audio-focus-surface");
    surfaces.value = [...surfaces.value, { token, host }];
    collapse();
    return () => { surfaces.value = surfaces.value.filter(surface => surface.token !== token); };
  }

  return { collapsed, focusActive, modalHost, collapse, expand, enterFocusSurface };
});
