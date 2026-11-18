import { onBeforeUnmount, toValue, watch, type MaybeRefOrGetter } from "vue";
import { useAudioPlayerPresentationStore } from "../stores/audioPlayerPresentation";

// Reading/image overlays can open without a route change. Register only their
// visibility and (for native modal dialogs) the reachable controls host.
export function useAudioPlayerFocus(active: MaybeRefOrGetter<boolean>, host?: MaybeRefOrGetter<HTMLElement | null>) {
  const presentation = useAudioPlayerPresentationStore();
  let release: (() => void) | undefined;
  watch(() => [toValue(active), host ? toValue(host) : null] as const, ([open, element]) => {
    release?.();
    release = open ? presentation.enterFocusSurface(element) : undefined;
  }, { immediate: true, flush: "post" });
  onBeforeUnmount(() => release?.());
}
