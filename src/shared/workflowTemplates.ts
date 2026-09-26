import type { CaseTypeCode, CaseTypeTemplate, PropertyType, Tag } from "./types";

export const DEFAULT_CASE_TYPE_TEMPLATES: CaseTypeTemplate[] = [
  {
    code: "residential_purchase",
    name: "Residential Purchase",
    description: "Standard single-family, townhouse, or multi-family purchase workflow.",
    requiredDocumentCategories: ["Contract", "Bank Documents", "Title Documents", "Closing Documents"],
    checklist: [
      {
        title: "Executed contract received",
        description: "Confirm the signed contract package is uploaded and categorized.",
        dueFrom: "created",
        dueOffsetDays: 1
      },
      {
        title: "Inspection follow-up",
        description: "Track inspection report, punch-list items, and party responses.",
        dueFrom: "created",
        dueOffsetDays: 7
      },
      {
        title: "Mortgage commitment",
        description: "Confirm lender commitment or financing status before closing preparation.",
        dueFrom: "closing",
        dueOffsetDays: -21
      },
      {
        title: "Title review",
        description: "Review title report, exceptions, municipal searches, and clearance items.",
        dueFrom: "closing",
        dueOffsetDays: -14
      },
      {
        title: "Closing package",
        description: "Prepare closing disclosure, final statement, payoff items, and signatures.",
        dueFrom: "closing",
        dueOffsetDays: -5
      },
      {
        title: "Final closing",
        description: "Confirm funding, recording, and final file archive.",
        dueFrom: "closing",
        dueOffsetDays: 0
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 10,
    isActive: true
  },
  {
    code: "condo_coop",
    name: "Condo / Co-op",
    description: "Residential transaction with board, building, and buyer package coordination.",
    requiredDocumentCategories: ["Contract", "Buyer Documents", "Bank Documents", "Title Documents", "Closing Documents"],
    checklist: [
      {
        title: "Executed contract received",
        description: "Confirm the signed contract package is uploaded and categorized.",
        dueFrom: "created",
        dueOffsetDays: 1
      },
      {
        title: "Board package review",
        description: "Track board application, financials, questionnaire, and approval status.",
        dueFrom: "created",
        dueOffsetDays: 10
      },
      {
        title: "Mortgage commitment",
        description: "Confirm lender commitment and building-specific lender conditions.",
        dueFrom: "closing",
        dueOffsetDays: -21
      },
      {
        title: "Title and building review",
        description: "Review title, building documents, questionnaire, and management requirements.",
        dueFrom: "closing",
        dueOffsetDays: -14
      },
      {
        title: "Closing package",
        description: "Prepare board, lender, attorney, and title closing materials.",
        dueFrom: "closing",
        dueOffsetDays: -5
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 20,
    isActive: true
  },
  {
    code: "commercial_purchase",
    name: "Commercial Purchase",
    description: "Commercial, mixed-use, or investor purchase with due diligence and title review.",
    requiredDocumentCategories: ["Contract", "Attorney Documents", "Title Documents", "Closing Documents"],
    checklist: [
      {
        title: "Contract and rider review",
        description: "Confirm contract, riders, schedules, and attorney review notes.",
        dueFrom: "created",
        dueOffsetDays: 2
      },
      {
        title: "Due diligence package",
        description: "Track leases, estoppels, certificates, inspection materials, and disclosures.",
        dueFrom: "created",
        dueOffsetDays: 14
      },
      {
        title: "Title and municipal clearance",
        description: "Review title, violations, searches, tax items, and clearance plan.",
        dueFrom: "closing",
        dueOffsetDays: -18
      },
      {
        title: "Closing package",
        description: "Prepare entity documents, closing statement, transfer docs, and signatures.",
        dueFrom: "closing",
        dueOffsetDays: -7
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 30,
    isActive: true
  },
  {
    code: "refinance",
    name: "Refinance",
    description: "Loan refinance workflow focused on lender, payoff, title, and closing materials.",
    requiredDocumentCategories: ["Bank Documents", "Title Documents", "Closing Documents"],
    checklist: [
      {
        title: "Lender intake",
        description: "Confirm borrower, lender, payoff, and loan package requirements.",
        dueFrom: "created",
        dueOffsetDays: 1
      },
      {
        title: "Title and payoff review",
        description: "Review title, payoff letters, taxes, and open lien items.",
        dueFrom: "closing",
        dueOffsetDays: -14
      },
      {
        title: "Lender clearance",
        description: "Confirm lender conditions and closing authorization.",
        dueFrom: "closing",
        dueOffsetDays: -5
      },
      {
        title: "Closing package",
        description: "Prepare signing package, settlement statement, funding, and archive.",
        dueFrom: "closing",
        dueOffsetDays: 0
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 40,
    isActive: true
  },
  {
    code: "md3_one_time_service",
    name: "One-time Service",
    description: "Single visit, remote adjustment, DVR local deployment, network change, or short service job.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Confirm request and scope",
        description: "Record what the customer needs, expected service window, site access, and success criteria.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 0
      },
      {
        title: "Complete service notes",
        description: "Record what was changed, tested, and handed back to the customer.",
        priority: "Normal",
        dueFrom: "created",
        dueOffsetDays: 1
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 110,
    isActive: true
  },
  {
    code: "md3_deployment_recurring_service",
    name: "Deployment + Recurring Support",
    description: "Initial installation plus ongoing monthly communication service, support, or maintenance.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Confirm deployment scope",
        description: "Record customer site, system design, numbers, devices, accounts, and recurring support expectations.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 0
      },
      {
        title: "Link managed assets",
        description: "Attach PBX, phones, trunks, gateways, SIMs, routers, accounts, or other managed assets to this service.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 1
      },
      {
        title: "Verify credentials",
        description: "Confirm encrypted credentials are saved only where needed and access is limited to Admin and Manager roles.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 1
      },
      {
        title: "Handoff and recurring support notes",
        description: "Record support terms, customer contacts, maintenance notes, and known follow-up items.",
        priority: "Normal",
        dueFrom: "created",
        dueOffsetDays: 3
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 120,
    isActive: true
  },
  {
    code: "md3_pbx_service",
    name: "PBX / VoIP Service",
    description: "PBX server, VoIP phones, SIP trunk, number routing, voicemail, IVR, or related voice service.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Record voice service design",
        description: "Capture numbers, extensions, routing, SIP trunk, phones, gateways, and customer contacts.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 0
      },
      {
        title: "Test inbound and outbound calls",
        description: "Confirm call flow, emergency routing assumptions, voicemail, recording, and customer acceptance.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 2
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 130,
    isActive: true
  },
  {
    code: "md3_network_service",
    name: "Network Service",
    description: "Router, firewall, switch, Wi-Fi, VPN, VLAN, static IP, cabling coordination, or network troubleshooting.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Record network scope",
        description: "Capture topology, IP ranges, device access, ISP details, and planned changes.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 0
      },
      {
        title: "Test connectivity",
        description: "Confirm LAN/WAN connectivity, Wi-Fi, VPN, phone service impact, and customer acceptance.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 1
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 140,
    isActive: true
  },
  {
    code: "md3_dvr_security_service",
    name: "DVR / Security Service",
    description: "DVR/NVR, camera, local recording, remote access, monitoring, or security system service.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Record security system scope",
        description: "Capture DVR/NVR, cameras, channels, storage, remote access, and customer access details.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 0
      },
      {
        title: "Verify viewing and recording",
        description: "Confirm local recording, remote viewing, user access, and customer acceptance.",
        priority: "Normal",
        dueFrom: "created",
        dueOffsetDays: 1
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 150,
    isActive: true
  },
  {
    code: "md3_cabling_service",
    name: "Cabling / Site Work",
    description: "On-site cabling, jack work, device placement, rack cleanup, or coordination with installers.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Confirm site work details",
        description: "Capture rooms, drops, device locations, access timing, and customer approval.",
        priority: "Normal",
        dueFrom: "created",
        dueOffsetDays: 0
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 160,
    isActive: true
  },
  {
    code: "md3_support_service",
    name: "Support / Maintenance",
    description: "Troubleshooting, recurring support, account maintenance, configuration update, or customer assistance.",
    requiredDocumentCategories: [],
    checklist: [
      {
        title: "Record support request",
        description: "Capture issue, affected service, customer contact, priority, and follow-up notes.",
        priority: "High",
        dueFrom: "created",
        dueOffsetDays: 0
      }
    ],
    closingReadinessEnabled: true,
    sortOrder: 170,
    isActive: true
  },
  {
    code: "demo_training",
    name: "Demo / Training Workspace",
    description: "Client-facing demo, training, or internal reference case without closing blockers.",
    requiredDocumentCategories: [],
    checklist: [],
    closingReadinessEnabled: false,
    sortOrder: 90,
    isActive: true
  }
];

const CASE_TYPE_BY_CODE = new Map(DEFAULT_CASE_TYPE_TEMPLATES.map((template) => [template.code, template]));

export function defaultCaseTypeTemplate(code: string | undefined): CaseTypeTemplate {
  return CASE_TYPE_BY_CODE.get(code ?? "") ?? CASE_TYPE_BY_CODE.get("residential_purchase")!;
}

export function caseTypeName(code: string | undefined): string {
  return CASE_TYPE_BY_CODE.get(code ?? "")?.name ?? code ?? defaultCaseTypeTemplate(code).name;
}

export function inferCaseTypeCode(propertyType: PropertyType | string, tags: Tag[] = []): CaseTypeCode {
  if (tags.some((tag) => tag.name === "client-demo" || tag.name === "training" || tag.name === "system-overview")) {
    return "demo_training";
  }
  if (propertyType === "Condo" || propertyType === "Co-op") return "condo_coop";
  if (propertyType === "Commercial" || propertyType === "Mixed Use") return "commercial_purchase";
  return "residential_purchase";
}
