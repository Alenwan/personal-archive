/// <reference types="vite/client" />
/// <reference types="@cloudflare/workers-types" />

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>;
  export default component;
}

