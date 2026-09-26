import {
  MD3_SERVICE_DOCUMENT_CATEGORIES,
  REALTY_DOCUMENT_CATEGORIES,
  type CaseReadiness,
  type DocumentCategory
} from "../../shared/types";
import { defaultCaseTypeTemplate } from "../../shared/workflowTemplates";
import type { AppRepository } from "../repositories/types";

export const REQUIRED_CLOSING_DOCUMENT_CATEGORIES: DocumentCategory[] = [
  "Contract",
  "Bank Documents",
  "Title Documents",
  "Closing Documents"
];

export async function buildCaseReadiness(
  repo: AppRepository,
  caseId: string,
  options: { includeArchived?: boolean } = {}
): Promise<CaseReadiness> {
  const [caseRecord, documents, tasks] = await Promise.all([
    repo.getCase(caseId, options),
    repo.listDocuments(caseId),
    repo.listTasks(caseId)
  ]);
  const storedTemplate = caseRecord?.caseTypeCode
    ? await repo.getCaseTypeTemplate(caseRecord.caseTypeCode)
    : null;
  const template = storedTemplate ?? defaultCaseTypeTemplate(caseRecord?.caseTypeCode);
  const requiredDocumentCategories = template.requiredDocumentCategories;
  const closingReadinessEnabled = template.closingReadinessEnabled;
  const isMd3Service = caseRecord?.caseTypeCode.startsWith("md3_") ?? false;
  const objectLabel = isMd3Service ? "service" : "case";
  const configuredDocumentCategories = isMd3Service ? MD3_SERVICE_DOCUMENT_CATEGORIES : REALTY_DOCUMENT_CATEGORIES;
  const configuredCategorySet = new Set<string>(configuredDocumentCategories);
  const availableDocumentCategories = [
    ...configuredDocumentCategories,
    ...requiredDocumentCategories.filter((category) => !configuredCategorySet.has(category)),
    ...documents.map((document) => document.category).filter((category) => !configuredCategorySet.has(category))
  ] as DocumentCategory[];
  const presentDocumentCategories = [...new Set(documents.map((document) => document.category))] as DocumentCategory[];
  const missingDocumentCategories = closingReadinessEnabled
    ? requiredDocumentCategories.filter((category) => !presentDocumentCategories.includes(category))
    : [];
  const openTasks = closingReadinessEnabled ? tasks.filter((task) => task.status !== "Done") : [];
  const documentCategories = [...new Set(availableDocumentCategories)].map((category) => {
    const categoryDocuments = documents.filter((document) => document.category === category);
    return {
      category,
      count: categoryDocuments.length,
      totalSize: categoryDocuments.reduce((total, document) => total + document.fileSize, 0),
      latestUploadedAt: categoryDocuments[0]?.uploadedAt ?? null,
      required: requiredDocumentCategories.includes(category),
      complete: categoryDocuments.length > 0
    };
  });
  const canClose = missingDocumentCategories.length === 0 && openTasks.length === 0;

  return {
    caseId,
    caseTypeCode: template.code,
    caseTypeName: template.name,
    closingReadinessEnabled,
    requiredDocumentCategories,
    presentDocumentCategories,
    missingDocumentCategories,
    documentCategories,
    openTasks,
    completedTasks: tasks.filter((task) => task.status === "Done").length,
    totalTasks: tasks.length,
    canClose,
    checkedAt: new Date().toISOString(),
    message: !closingReadinessEnabled
      ? `This ${objectLabel} type is configured as an informational workspace, so completion blockers are disabled.`
      : canClose
        ? `This ${template.name.toLowerCase()} ${objectLabel} has the required document categories and no open tasks.`
        : `This ${template.name.toLowerCase()} ${objectLabel} still has missing required document categories or unfinished tasks.`
  };
}
