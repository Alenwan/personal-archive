import { createRouter, createWebHistory } from "vue-router";
import { configuredBusinessTemplateCode } from "./businessTemplate";
import { useAuthStore } from "./stores/auth";

type RouteCapability = "canManageBackups" | "canManageSettings";

function redirectWorkItemPath(to: { params: Record<string, unknown>; fullPath: string }, basePath: string) {
  const query = to.fullPath.includes("?") ? `?${to.fullPath.split("?").slice(1).join("?")}` : "";
  return `${basePath}/${String(to.params.id)}${query}`;
}

function requiredRouteCapability(value: unknown): RouteCapability | null {
  return value === "canManageBackups" || value === "canManageSettings" ? value : null;
}

const md3ServiceTemplate = configuredBusinessTemplateCode === "md3-service";
const personalArchiveTemplate = configuredBusinessTemplateCode === "personal-archive";
const homePath = personalArchiveTemplate ? "/documents" : "/dashboard";
const workItemRoutes = md3ServiceTemplate
  ? [
      { path: "/services", name: "services", component: () => import("./views/CasesView.vue") },
      { path: "/services/:id", name: "service-detail", component: () => import("./views/CaseDetailView.vue") },
      { path: "/cases", redirect: "/services" },
      {
        path: "/cases/:id",
        redirect: (to: { params: Record<string, unknown>; fullPath: string }) => redirectWorkItemPath(to, "/services")
      }
    ]
  : [
      { path: "/cases", name: "cases", component: () => import("./views/CasesView.vue") },
      { path: "/cases/:id", name: "case-detail", component: () => import("./views/CaseDetailView.vue") },
      { path: "/services", redirect: "/cases" },
      {
        path: "/services/:id",
        redirect: (to: { params: Record<string, unknown>; fullPath: string }) => redirectWorkItemPath(to, "/cases")
      }
    ];
const discussionRoutes = personalArchiveTemplate
  ? [
      { path: "/reading-notes", name: "reading-notes", component: () => import("./views/DiscussionsView.vue") },
      { path: "/study", redirect: "/reading-notes" },
      { path: "/discussions", redirect: "/reading-notes" }
    ]
  : [
      { path: "/discussions", name: "discussions", component: () => import("./views/DiscussionsView.vue") },
      { path: "/study", redirect: "/discussions" },
      { path: "/reading-notes", redirect: "/discussions" }
    ];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true, authScreen: true } },
    {
      path: "/change-password",
      name: "change-password",
      component: () => import("./views/PasswordChangeView.vue"),
      meta: { authScreen: true }
    },
    { path: "/", redirect: homePath },
    { path: "/dashboard", name: "dashboard", component: () => import("./views/DashboardView.vue") },
    ...workItemRoutes,
    { path: "/contacts", name: "contacts", component: () => import("./views/ContactsView.vue") },
    { path: "/contacts/:id", name: "contact-detail", component: () => import("./views/ContactDetailView.vue") },
    { path: "/organizations", name: "organizations", component: () => import("./views/OrganizationsView.vue") },
    { path: "/organizations/:id", name: "organization-detail", component: () => import("./views/PartyOrganizationDetailView.vue") },
    { path: "/communications", name: "communications", component: () => import("./views/CommunicationsView.vue") },
    ...discussionRoutes,
    { path: "/managed-assets", name: "assets", component: () => import("./views/AssetsView.vue") },
    { path: "/managed-assets/:id", name: "asset-detail", component: () => import("./views/AssetDetailView.vue") },
    { path: "/knowledge", name: "knowledge", component: () => import("./views/KnowledgeView.vue") },
    { path: "/knowledge/:id", name: "knowledge-detail", component: () => import("./views/KnowledgeDetailView.vue") },
    { path: "/manuscripts", name: "manuscripts", component: () => import("./views/ManuscriptsView.vue") },
    { path: "/manuscripts/:id", name: "manuscript-workspace", component: () => import("./views/ManuscriptWorkspaceView.vue") },
    { path: "/documents", name: "documents", component: () => import("./views/DocumentsView.vue") },
    { path: "/private-vault", name: "private-vault", component: () => import("./views/PrivateVaultView.vue") },
    { path: "/reader/:id", name: "reader", component: () => import("./views/ReaderView.vue") },
    {
      path: "/system-status",
      name: "system-status",
      component: () => import("./views/SystemStatusView.vue"),
      meta: { requiredCapability: "canManageSettings" }
    },
    { path: "/code-repositories/:pathMatch(.*)*", redirect: homePath },
    { path: "/backups", name: "backups", component: () => import("./views/BackupsView.vue"), meta: { requiredCapability: "canManageBackups" } },
    { path: "/tags", name: "tags", component: () => import("./views/TagsView.vue"), meta: { requiredCapability: "canManageSettings" } },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { requiredCapability: "canManageSettings" } }
  ]
});

router.beforeEach(async (to) => {
  if (personalArchiveTemplate && /^\/(dashboard|cases|services|contacts|organizations|communications|managed-assets)(\/|$)/.test(to.path)) return homePath;
  const auth = useAuthStore();
  if (!auth.user && !auth.loading) {
    await auth.loadSession().catch(() => undefined);
  }
  if (!to.meta.public && !auth.isAuthenticated) return "/login";
  if (auth.isAuthenticated && auth.mustChangePassword && to.name !== "change-password") return "/change-password";
  if (to.name === "change-password" && auth.isAuthenticated && !auth.mustChangePassword) return homePath;
  if (to.meta.public && auth.isAuthenticated) return auth.mustChangePassword ? "/change-password" : homePath;
  const requiredCapability = requiredRouteCapability(to.meta.requiredCapability);
  if (auth.isAuthenticated && requiredCapability && !auth[requiredCapability]) return homePath;
});
