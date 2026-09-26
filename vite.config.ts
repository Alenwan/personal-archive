import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig, loadEnv } from "vite";
import { bundleNotices } from "./scripts/bundleNotices.mjs";

export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), "VITE_");
  const template = process.env.VITE_BUSINESS_TEMPLATE || fileEnv.VITE_BUSINESS_TEMPLATE
    || process.env.VITE_APP_TEMPLATE || fileEnv.VITE_APP_TEMPLATE || "personal-archive";
  return {
    define: { "import.meta.env.VITE_BUSINESS_TEMPLATE": JSON.stringify(template) },
    plugins: [vue(), {
      name: "bundle-third-party-notices",
      apply: "build",
      async generateBundle(_options, bundle) {
        const modules = Object.values(bundle).flatMap((output) => output.type === "chunk"
          ? Object.entries(output.modules).filter(([, info]) => info.renderedLength > 0).map(([id]) => id) : []);
        const notices = await bundleNotices(process.cwd(), modules, "browser");
        this.emitFile({ type: "asset", fileName: "THIRD_PARTY_NOTICES.txt", source: notices.text });
        this.emitFile({ type: "asset", fileName: "THIRD_PARTY_COMPONENTS.json", source: notices.json });
      }
    }],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url))
      }
    },
    server: {
      port: 5173
    }
  };
});
