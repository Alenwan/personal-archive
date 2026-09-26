import { computed } from "vue";
import { useI18n, type Locale } from "./i18n";
import {
  MD3_SERVICE_DOCUMENT_CATEGORIES,
  PERSONAL_ARCHIVE_DOCUMENT_CATEGORIES,
  REALTY_DOCUMENT_CATEGORIES,
  type CaseRecord,
  type CaseTypeTemplate,
  type ContactRole,
  type DocumentCategory
} from "./shared/types";

export type BusinessTemplateCode = "generic" | "realtycase" | "md3-service" | "personal-archive";

export interface WorkItemTerminology {
  singular: string;
  plural: string;
  lowerSingular: string;
  lowerPlural: string;
  managementEyebrow: string;
  listDescription: string;
  newButton: string;
  newTitle: string;
  newDescription: string;
  editTitle: string;
  editDescription: string;
  numberLabel: string;
  titleLabel: string;
  typeLabel: string;
  locationLabel: string;
  locationSummaryLabel: string;
  locationDescriptionLabel: string;
  valueLabel: string;
  targetDateLabel: string;
  targetDateFromLabel: string;
  targetDateToLabel: string;
  readinessTitle: string;
  readinessDescription: string;
  completeAction: string;
  forceCompleteAction: string;
  archiveAction: string;
  restoreAction: string;
  archivedNoticeTitle: string;
  archivedNoticeDescription: string;
  timelineTitle: string;
  timelineDescription: string;
  contactRelationshipTitle: string;
  contactRelationshipDescription: string;
  relatedTitle: string;
  relatedDescription: string;
  searchPlaceholder: string;
  listSearchPlaceholder: string;
  noMatches: string;
  loading: string;
  activeArchiveLabel: string;
  archivedArchiveLabel: string;
  allArchiveLabel: string;
  restoreSuccessTitle: string;
  restoreSuccessMessage: (number: string) => string;
  archiveSuccessTitle: string;
  archiveSuccessMessage: (number: string) => string;
  createdError: string;
  updatedError: string;
  archivedError: string;
  restoredError: string;
  closeError: string;
  noteSuccess: string;
  noteSuccessMessage: string;
  createSubmitLabel: string;
}

export interface BusinessTemplate {
  code: BusinessTemplateCode;
  productName: string;
  productShortName: string;
  productSubtitle: string;
  personalArchive: boolean;
  defaultWorkItemTypeCode: string;
  workItemRouteBase: string;
  legacyWorkItemRouteBase: string;
  serviceTypeCodePrefix?: string;
  showPropertyType: boolean;
  showValueField: boolean;
  defaultPropertyType: CaseRecord["propertyType"];
  defaultCity: string;
  defaultState: string;
  defaultZipCode: string;
  defaultValuePlaceholder: string;
  requireCityStateZip: boolean;
  showCustomerOrganization: boolean;
  endpointLabel: string;
  contactRoleOptions: ContactRole[];
  documentCategories: readonly DocumentCategory[];
  terminology: Record<Locale, WorkItemTerminology>;
}

const realtyContactRoles: ContactRole[] = [
  "Seller",
  "Buyer",
  "Seller Agent",
  "Buyer Agent",
  "Seller Attorney",
  "Buyer Attorney",
  "Bank",
  "Bank Attorney",
  "Title Company",
  "Inspector",
  "Other"
];

const md3ContactRoles: ContactRole[] = [
  "Customer",
  "Site Contact",
  "Billing Contact",
  "Technical Contact",
  "Vendor",
  "Carrier",
  "Technician",
  "Project Manager",
  "Other"
];

const md3ServiceTerminology: Record<Locale, WorkItemTerminology> = {
  en: {
    singular: "Service",
    plural: "Services",
    lowerSingular: "service",
    lowerPlural: "services",
    managementEyebrow: "Service operations",
    listDescription: "Track one-time jobs, deployments, recurring support, contacts, documents, tasks, assets, and service status.",
    newButton: "New service",
    newTitle: "New service",
    newDescription: "Create a service record with the core work type, location, schedule, and notes.",
    editTitle: "Edit service",
    editDescription: "Update service status, target date, tags, and operational notes.",
    numberLabel: "Service number",
    titleLabel: "Service title / location",
    typeLabel: "Service type",
    locationLabel: "Service location",
    locationSummaryLabel: "Service title",
    locationDescriptionLabel: "Location",
    valueLabel: "Estimated value",
    targetDateLabel: "Target date",
    targetDateFromLabel: "Target from",
    targetDateToLabel: "Target to",
    readinessTitle: "Service readiness",
    readinessDescription: "Documents and tasks that should be reviewed before marking this service complete.",
    completeAction: "Complete service",
    forceCompleteAction: "Complete with exception",
    archiveAction: "Archive service",
    restoreAction: "Restore service",
    archivedNoticeTitle: "This service is archived.",
    archivedNoticeDescription:
      "It is preserved for audit, reporting, and recovery, but editing, uploads, notes, and task updates are locked until it is restored.",
    timelineTitle: "Unified service timeline",
    timelineDescription: "Notes, workflow events, document activity, tasks, and party changes in one audit-aware view.",
    contactRelationshipTitle: "Related services",
    contactRelationshipDescription: "All service records where this contact has a party role.",
    relatedTitle: "Related services",
    relatedDescription: "Services linked directly to this organization or through its contacts.",
    searchPlaceholder: "Search services, contacts, organizations, assets, documents...",
    listSearchPlaceholder: "Service number, title, location, contact...",
    noMatches: "No services match the current filters.",
    loading: "Loading services...",
    activeArchiveLabel: "Active services",
    archivedArchiveLabel: "Archived services",
    allArchiveLabel: "All services",
    restoreSuccessTitle: "Service restored",
    restoreSuccessMessage: (number) => `${number} is back in active service views.`,
    archiveSuccessTitle: "Service archived",
    archiveSuccessMessage: (number) => `${number} was removed from active service views.`,
    createdError: "Unable to create service",
    updatedError: "Unable to update service",
    archivedError: "Unable to archive service",
    restoredError: "Unable to restore service",
    closeError: "Unable to complete service",
    noteSuccess: "Note added",
    noteSuccessMessage: "The service timeline has been updated.",
    createSubmitLabel: "Create service"
  },
  zh: {
    singular: "服务",
    plural: "服务",
    lowerSingular: "服务",
    lowerPlural: "服务",
    managementEyebrow: "服务运营",
    listDescription: "管理一次性服务、部署、长期支持、联系人、文件、任务、资产和服务状态。",
    newButton: "新建服务",
    newTitle: "新建服务",
    newDescription: "创建服务记录，包含服务类型、地点、计划日期和备注。",
    editTitle: "编辑服务",
    editDescription: "更新服务状态、目标日期、标签和运营备注。",
    numberLabel: "服务编号",
    titleLabel: "服务标题 / 地点",
    typeLabel: "服务类型",
    locationLabel: "服务地点",
    locationSummaryLabel: "服务标题",
    locationDescriptionLabel: "地点",
    valueLabel: "预估金额",
    targetDateLabel: "目标日期",
    targetDateFromLabel: "目标开始",
    targetDateToLabel: "目标结束",
    readinessTitle: "服务完成检查",
    readinessDescription: "完成服务前建议检查的文件和任务。",
    completeAction: "完成服务",
    forceCompleteAction: "例外完成",
    archiveAction: "归档服务",
    restoreAction: "恢复服务",
    archivedNoticeTitle: "此服务已归档。",
    archivedNoticeDescription: "记录会保留用于审计、查询和恢复，但恢复前不能编辑、上传、写备注或更新任务。",
    timelineTitle: "服务时间线",
    timelineDescription: "备注、流程事件、文件活动、任务和相关方变化集中在一个可审计视图。",
    contactRelationshipTitle: "相关服务",
    contactRelationshipDescription: "这个联系人参与过的所有服务记录。",
    relatedTitle: "相关服务",
    relatedDescription: "直接关联该组织或通过其联系人关联的服务。",
    searchPlaceholder: "搜索服务、联系人、组织、资产、文件...",
    listSearchPlaceholder: "服务编号、标题、地点、联系人...",
    noMatches: "没有符合当前过滤条件的服务。",
    loading: "正在加载服务...",
    activeArchiveLabel: "进行中的服务",
    archivedArchiveLabel: "已归档服务",
    allArchiveLabel: "全部服务",
    restoreSuccessTitle: "服务已恢复",
    restoreSuccessMessage: (number) => `${number} 已回到进行中的服务视图。`,
    archiveSuccessTitle: "服务已归档",
    archiveSuccessMessage: (number) => `${number} 已从进行中服务视图移除。`,
    createdError: "无法创建服务",
    updatedError: "无法更新服务",
    archivedError: "无法归档服务",
    restoredError: "无法恢复服务",
    closeError: "无法完成服务",
    noteSuccess: "备注已添加",
    noteSuccessMessage: "服务时间线已更新。",
    createSubmitLabel: "创建服务"
  }
};

const realtyCaseTerminology: Record<Locale, WorkItemTerminology> = {
  en: {
    singular: "Case",
    plural: "Cases",
    lowerSingular: "case",
    lowerPlural: "cases",
    managementEyebrow: "Case management",
    listDescription: "Track property transactions, parties, closing dates, document readiness, and case status from intake through closing.",
    newButton: "New case",
    newTitle: "New case",
    newDescription: "Create a transaction file with core property and closing details.",
    editTitle: "Edit case",
    editDescription: "Update status, closing details, tags, and operational notes.",
    numberLabel: "Case number",
    titleLabel: "Property address",
    typeLabel: "Case type",
    locationLabel: "Property address",
    locationSummaryLabel: "Property",
    locationDescriptionLabel: "Property",
    valueLabel: "Sale price",
    targetDateLabel: "Closing date",
    targetDateFromLabel: "Closing from",
    targetDateToLabel: "Closing to",
    readinessTitle: "Closing readiness",
    readinessDescription: "Required documents and open tasks before closing.",
    completeAction: "Close case",
    forceCompleteAction: "Force close case",
    archiveAction: "Archive case",
    restoreAction: "Restore case",
    archivedNoticeTitle: "This case is archived.",
    archivedNoticeDescription:
      "It is preserved for audit, reporting, and recovery, but editing, uploads, notes, and task updates are locked until it is restored.",
    timelineTitle: "Unified case timeline",
    timelineDescription: "Notes, case workflow events, document activity, tasks, and party changes in one audit-aware view.",
    contactRelationshipTitle: "Related cases",
    contactRelationshipDescription: "All transaction files where this contact has a party role.",
    relatedTitle: "Related cases",
    relatedDescription: "Cases connected through this organization's contacts.",
    searchPlaceholder: "Search cases, contacts, organizations, assets, documents...",
    listSearchPlaceholder: "Address, case number, contact...",
    noMatches: "No cases match the current filters.",
    loading: "Loading cases...",
    activeArchiveLabel: "Active cases",
    archivedArchiveLabel: "Archived cases",
    allArchiveLabel: "All cases",
    restoreSuccessTitle: "Case restored",
    restoreSuccessMessage: (number) => `${number} is back in active work views.`,
    archiveSuccessTitle: "Case archived",
    archiveSuccessMessage: (number) => `${number} was removed from active lists.`,
    createdError: "Unable to create case",
    updatedError: "Unable to update case",
    archivedError: "Unable to archive case",
    restoredError: "Unable to restore case",
    closeError: "Unable to close case",
    noteSuccess: "Note added",
    noteSuccessMessage: "The case timeline has been updated.",
    createSubmitLabel: "Create case"
  },
  zh: {
    singular: "案件",
    plural: "案件",
    lowerSingular: "案件",
    lowerPlural: "案件",
    managementEyebrow: "案件管理",
    listDescription: "管理房产交易、相关方、过户日期、文件完整度和案件状态。",
    newButton: "新建案件",
    newTitle: "新建案件",
    newDescription: "创建包含房产和过户信息的交易文件。",
    editTitle: "编辑案件",
    editDescription: "更新状态、过户信息、标签和运营备注。",
    numberLabel: "案件编号",
    titleLabel: "物业地址",
    typeLabel: "案件类型",
    locationLabel: "物业地址",
    locationSummaryLabel: "物业",
    locationDescriptionLabel: "物业",
    valueLabel: "成交价",
    targetDateLabel: "过户日期",
    targetDateFromLabel: "过户开始",
    targetDateToLabel: "过户结束",
    readinessTitle: "过户检查",
    readinessDescription: "过户前需要检查的文件和任务。",
    completeAction: "关闭案件",
    forceCompleteAction: "例外关闭案件",
    archiveAction: "归档案件",
    restoreAction: "恢复案件",
    archivedNoticeTitle: "此案件已归档。",
    archivedNoticeDescription: "记录会保留用于审计、查询和恢复，但恢复前不能编辑、上传、写备注或更新任务。",
    timelineTitle: "案件时间线",
    timelineDescription: "备注、案件流程事件、文件活动、任务和相关方变化集中在一个可审计视图。",
    contactRelationshipTitle: "相关案件",
    contactRelationshipDescription: "这个联系人参与过的所有案件。",
    relatedTitle: "相关案件",
    relatedDescription: "通过该组织下联系人关联的案件。",
    searchPlaceholder: "搜索案件、联系人、组织、资产、文件...",
    listSearchPlaceholder: "地址、案件编号、联系人...",
    noMatches: "没有符合当前过滤条件的案件。",
    loading: "正在加载案件...",
    activeArchiveLabel: "进行中的案件",
    archivedArchiveLabel: "已归档案件",
    allArchiveLabel: "全部案件",
    restoreSuccessTitle: "案件已恢复",
    restoreSuccessMessage: (number) => `${number} 已回到进行中的视图。`,
    archiveSuccessTitle: "案件已归档",
    archiveSuccessMessage: (number) => `${number} 已从进行中列表移除。`,
    createdError: "无法创建案件",
    updatedError: "无法更新案件",
    archivedError: "无法归档案件",
    restoredError: "无法恢复案件",
    closeError: "无法关闭案件",
    noteSuccess: "备注已添加",
    noteSuccessMessage: "案件时间线已更新。",
    createSubmitLabel: "创建案件"
  }
};

const templates: Record<BusinessTemplateCode, BusinessTemplate> = {
  generic: {
    code: "generic",
    productName: "Generic Platform",
    productShortName: "GP",
    productSubtitle: "Records Workspace",
    personalArchive: false,
    defaultWorkItemTypeCode: "demo_training",
    workItemRouteBase: "/cases",
    legacyWorkItemRouteBase: "/cases",
    showPropertyType: true,
    showValueField: true,
    defaultPropertyType: "Commercial",
    defaultCity: "New York",
    defaultState: "NY",
    defaultZipCode: "",
    defaultValuePlaceholder: "0",
    requireCityStateZip: true,
    showCustomerOrganization: false,
    endpointLabel: "WAN IP",
    contactRoleOptions: realtyContactRoles,
    documentCategories: REALTY_DOCUMENT_CATEGORIES,
    terminology: realtyCaseTerminology
  },
  realtycase: {
    code: "realtycase",
    productName: "RealtyCase Manager",
    productShortName: "RC",
    productSubtitle: "Case Management",
    personalArchive: false,
    defaultWorkItemTypeCode: "condo_coop",
    workItemRouteBase: "/cases",
    legacyWorkItemRouteBase: "/cases",
    showPropertyType: true,
    showValueField: true,
    defaultPropertyType: "Condo",
    defaultCity: "New York",
    defaultState: "NY",
    defaultZipCode: "",
    defaultValuePlaceholder: "850000",
    requireCityStateZip: true,
    showCustomerOrganization: false,
    endpointLabel: "WAN IP",
    contactRoleOptions: realtyContactRoles,
    documentCategories: REALTY_DOCUMENT_CATEGORIES,
    terminology: realtyCaseTerminology
  },
  "md3-service": {
    code: "md3-service",
    productName: "MD3 Platform",
    productShortName: "MD3",
    productSubtitle: "Business Operations",
    personalArchive: false,
    defaultWorkItemTypeCode: "md3_one_time_service",
    workItemRouteBase: "/services",
    legacyWorkItemRouteBase: "/cases",
    serviceTypeCodePrefix: "md3_",
    showPropertyType: false,
    showValueField: true,
    defaultPropertyType: "Commercial",
    defaultCity: "New York",
    defaultState: "NY",
    defaultZipCode: "",
    defaultValuePlaceholder: "0",
    requireCityStateZip: false,
    showCustomerOrganization: true,
    endpointLabel: "WAN IP / Endpoint",
    contactRoleOptions: md3ContactRoles,
    documentCategories: MD3_SERVICE_DOCUMENT_CATEGORIES,
    terminology: md3ServiceTerminology
  },
  "personal-archive": {
    code: "personal-archive",
    productName: "Personal Archive",
    productShortName: "PA",
    productSubtitle: "Archive, reading & notes",
    personalArchive: true,
    defaultWorkItemTypeCode: "demo_training",
    workItemRouteBase: "/cases",
    legacyWorkItemRouteBase: "/cases",
    showPropertyType: false,
    showValueField: false,
    defaultPropertyType: "Commercial",
    defaultCity: "",
    defaultState: "",
    defaultZipCode: "",
    defaultValuePlaceholder: "0",
    requireCityStateZip: false,
    showCustomerOrganization: false,
    endpointLabel: "Reference",
    contactRoleOptions: realtyContactRoles,
    documentCategories: PERSONAL_ARCHIVE_DOCUMENT_CATEGORIES,
    terminology: {
      en: {
        ...realtyCaseTerminology.en,
        searchPlaceholder: "Search archive, notes, long writing..."
      },
      zh: {
        ...realtyCaseTerminology.zh,
        searchPlaceholder: "搜索档案、笔记和长篇文稿..."
      }
    }
  }
};

function normalizeBusinessTemplateCode(value: unknown): BusinessTemplateCode {
  if (value === "generic" || value === "realtycase" || value === "md3-service" || value === "personal-archive") return value;
  return "md3-service";
}

export const configuredBusinessTemplateCode = normalizeBusinessTemplateCode(
  import.meta.env.VITE_BUSINESS_TEMPLATE || import.meta.env.VITE_APP_TEMPLATE || "md3-service"
);

export function resolveBusinessTemplate(code: unknown = configuredBusinessTemplateCode): BusinessTemplate {
  return templates[normalizeBusinessTemplateCode(code)];
}

export function useBusinessTemplate() {
  const { locale } = useI18n();
  const template = computed(() => resolveBusinessTemplate());
  const labels = computed(() => template.value.terminology[locale.value]);
  return { template, labels };
}

export function workItemPath(id?: string, query?: string): string {
  const base = resolveBusinessTemplate().workItemRouteBase;
  const path = id ? `${base}/${id}` : base;
  return query ? `${path}${query.startsWith("?") ? query : `?${query}`}` : path;
}

export function filterCaseTypeTemplates(template: BusinessTemplate, caseTypes: CaseTypeTemplate[]): CaseTypeTemplate[] {
  const prefix = template.serviceTypeCodePrefix;
  if (!prefix) return caseTypes.filter((item) => !item.code.startsWith("md3_"));
  const scoped = caseTypes.filter((item) => item.code.startsWith(prefix));
  return scoped.length ? scoped : caseTypes;
}

export function caseTypeDisplayName(caseTypeCode: string, caseTypes: CaseTypeTemplate[], fallback = ""): string {
  return caseTypes.find((item) => item.code === caseTypeCode)?.name || fallback || caseTypeCode;
}
