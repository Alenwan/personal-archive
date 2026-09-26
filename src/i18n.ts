import { computed, ref } from "vue";

export type Locale = "en" | "zh";

const dictionaries = {
  en: {
    dashboard: "Dashboard",
    cases: "Cases",
    contacts: "Contacts",
    organizations: "Organizations",
    communications: "Communications",
    discussions: "Discussions",
    study: "Reading & Notes",
    archive: "Archive",
    assets: "Assets",
    documents: "Documents",
    knowledge: "Knowledge",
    backups: "Backups",
    tags: "Tags",
    settings: "Settings",
    searchPlaceholder: "Search services, contacts, organizations, assets, documents, knowledge...",
    language: "中文",
    logout: "Log out",
    login: "Log in",
    email: "Email",
    password: "Password",
    role: "Role",
    status: "Status",
    closingDate: "Closing date",
    property: "Property",
    salePrice: "Sale price",
    updated: "Updated",
    upload: "Upload",
    delete: "Delete",
    download: "Download",
    notes: "Notes",
    tasks: "Tasks",
    overview: "Overview",
    parties: "Parties",
    readonlyNotice: "Your role is read-only for this action.",
    totalCases: "Total cases",
    activeCases: "Active cases",
    closingSoon: "Closing soon",
    pendingCases: "Pending cases",
    recentUploads: "Recent uploads",
    recentlyUpdated: "Recently updated",
    auditLogs: "Audit logs"
  },
  zh: {
    dashboard: "仪表盘",
    cases: "案件",
    contacts: "联系人",
    organizations: "组织",
    communications: "沟通",
    discussions: "讨论",
    study: "阅读与笔记",
    archive: "档案库",
    assets: "资产",
    documents: "文件",
    knowledge: "知识库",
    backups: "备份",
    tags: "标签",
    settings: "设置",
    searchPlaceholder: "搜索服务、联系人、组织、资产、文件、知识库...",
    language: "English",
    logout: "退出",
    login: "登录",
    email: "邮箱",
    password: "密码",
    role: "角色",
    status: "状态",
    closingDate: "过户日期",
    property: "物业",
    salePrice: "成交价",
    updated: "更新",
    upload: "上传",
    delete: "删除",
    download: "下载",
    notes: "备注",
    tasks: "任务",
    overview: "概览",
    parties: "相关方",
    readonlyNotice: "当前角色只能查看，不能执行此操作。",
    totalCases: "案件总数",
    activeCases: "进行中",
    closingSoon: "即将过户",
    pendingCases: "待处理",
    recentUploads: "最近上传",
    recentlyUpdated: "最近更新",
    auditLogs: "审计记录"
  }
} as const;

const localeStorageKey = "md3-platform-locale";
const legacyLocaleStorageKey = "realtycase-locale";
const initialLocale = (localStorage.getItem(localeStorageKey) || localStorage.getItem(legacyLocaleStorageKey)) as Locale | null;
const locale = ref<Locale>(initialLocale || "en");

export function useI18n() {
  const dictionary = computed(() => dictionaries[locale.value]);

  function setLocale(value: Locale) {
    locale.value = value;
    localStorage.setItem(localeStorageKey, value);
    localStorage.removeItem(legacyLocaleStorageKey);
  }

  function toggleLocale() {
    setLocale(locale.value === "en" ? "zh" : "en");
  }

  function t(key: keyof typeof dictionaries.en): string {
    return dictionary.value[key];
  }

  return { locale, t, toggleLocale, setLocale };
}
