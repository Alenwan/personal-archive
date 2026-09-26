import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { resolveBusinessTemplate } from "./businessTemplate";
import { router } from "./router";
import "./styles.css";

document.title = resolveBusinessTemplate().productName;

createApp(App).use(createPinia()).use(router).mount("#app");
