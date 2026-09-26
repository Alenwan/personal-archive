import { onBeforeUnmount, onMounted } from "vue";

const MENU_SELECTOR = "details[data-dismissible-menu]";

function openMenus() {
  return Array.from(document.querySelectorAll<HTMLDetailsElement>(`${MENU_SELECTOR}[open]`));
}

function closeMenusExcept(target: EventTarget | null) {
  if (!(target instanceof Node)) return;
  for (const menu of openMenus()) {
    if (!menu.contains(target)) menu.open = false;
  }
}

export function useDismissibleMenus() {
  function onPointerDown(event: PointerEvent) {
    closeMenusExcept(event.target);
  }

  function onFocusIn(event: FocusEvent) {
    closeMenusExcept(event.target);
  }

  function onClick(event: MouseEvent) {
    if (!(event.target instanceof Element)) return;
    const action = event.target.closest("button, a");
    const menu = action?.closest<HTMLDetailsElement>(MENU_SELECTOR);
    if (menu) menu.open = false;
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    const menus = openMenus();
    if (!menus.length) return;
    const lastMenu = menus.at(-1);
    for (const menu of menus) menu.open = false;
    lastMenu?.querySelector<HTMLElement>("summary")?.focus();
    event.stopPropagation();
  }

  onMounted(() => {
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);
  });

  onBeforeUnmount(() => {
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
    document.removeEventListener("click", onClick);
    document.removeEventListener("keydown", onKeyDown);
  });
}
