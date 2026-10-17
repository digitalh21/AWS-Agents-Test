import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  pgEnum,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Approval lifecycle enum shared with companion tooling on the same Supabase
 * project (mirrored so drizzle-kit has zero-diff against the live database).
 */
export const approvalStatusEnum = pgEnum("approval_status", ["PENDING", "APPROVED", "REJECTED"]);

/**
 * Nullable enums owned by companion tooling on this Supabase project.
 * Declared here so drizzle-kit keeps them instead of trying to drop types
 * that other views/table schemas (outside `public` diffing) still depend on.
 */
export const platformLeadStatusEnum = pgEnum("lead_status", [
  "NEW",
  "IN_PROGRESS",
  "CALLBACK",
  "PAYMENT_PENDING",
  "CLOSED",
  "REJECTED",
  "NOT_INTERESTED",
]);
export const platformTransactionTypeEnum = pgEnum("transaction_type", [
  "COMMISSION",
  "WITHDRAWAL",
  "BONUS",
  "ADJUSTMENT",
]);
export const platformUserRoleEnum = pgEnum("user_role", ["ADMIN", "HR", "MANAGER", "AGENT"]);

/* ------------------------------------------------------------------ */
/* Niches (verticals / industries)                                     */
/* ------------------------------------------------------------------ */
export const niches = pgTable("niches", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  color: text("color").default("#2563eb").notNull(),
  // false = hidden from Telecalling Agents entirely (sidebar + their lead queries).
  // Admin / HR / Manager always see every niche.
  visibleToAgents: boolean("visible_to_agents").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Users: ADMIN | HR | MANAGER | AGENT                                 */
/* ------------------------------------------------------------------ */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("AGENT"),
    // agents can be scoped to a niche; staff see all / switch niches
    primaryNicheId: integer("primary_niche_id"),
    isActive: boolean("is_active").notNull().default(true),
    isOnline: boolean("is_online").notNull().default(false),
    avatarUrl: text("avatar_url"),
    // wallet
    walletTotal: numeric("wallet_total", { precision: 12, scale: 2 }).notNull().default("0"),
    walletPending: numeric("wallet_pending", { precision: 12, scale: 2 }).notNull().default("0"),
    walletApproved: numeric("wallet_approved", { precision: 12, scale: 2 }).notNull().default("0"),
    commissionPerDeal: numeric("commission_per_deal", { precision: 12, scale: 2 })
      .notNull()
      .default("500"),
    // manual daily auto-assign limit (leads pulled from the pool each day)
    dailyLeadQuota: integer("daily_lead_quota"),
    // Per Day Lead Limit — ceiling for Pool auto-allocation (wins over legacy quota)
    dailyLeadLimit: integer("daily_lead_limit"),
    // Daily Click Quota — max tracked interactions per day (null = unlimited).
    // Allocated by Admin/HR; enforced server-side on every tracked action.
    dailyClickQuota: integer("daily_click_quota"),
    // payout details
    bankName: text("bank_name"),
    bankAccount: text("bank_account"),
    bankIfsc: text("bank_ifsc"),
    upiId: text("upi_id"),
    // true once HR/Admin approve the payout details -> fields become read-only
    payoutLocked: boolean("payout_locked").notNull().default(false),
    payoutLockedBy: uuid("payout_locked_by"),
    payoutLockedAt: timestamp("payout_locked_at", { withTimezone: true }),
    // kyc
    kycStatus: text("kyc_status").notNull().default("PENDING"),
    kycAadhaarUrl: text("kyc_aadhaar_url"),
    kycMarksheetUrl: text("kyc_marksheet_url"),
    kycPhotoUrl: text("kyc_photo_url"),
    kycPanUrl: text("kyc_pan_url"),
    // contact + qualification (spec section 6)
    altPhone: text("alt_phone"),
    guardianPhone: text("guardian_phone"),
    qualification: text("qualification"),
    // staff-written profile notes + badges
    aboutPerson: text("about_person"),
    badges: jsonb("badges").$type<string[]>().default([]),
    activeSeconds: bigint("active_seconds", { mode: "number" }).notNull().default(0),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    // mirrored columns used by companion tooling (kept for zero-diff schema parity)
    isImpersonating: boolean("is_impersonating").notNull().default(false),
    originalAdminId: uuid("original_admin_id"),
    themePreference: text("theme_preference").notNull().default("day"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("users_email_uq").on(t.email), index("users_role_idx").on(t.role)],
);

/* ------------------------------------------------------------------ */
/* Leads — 1M+ rows, server side pagination                            */
/* ------------------------------------------------------------------ */
export const leads = pgTable(
  "leads",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    // stable human-readable serial number
    leadCode: text("lead_code"),
    // nullable: leads can exist before a niche is decided (graceful default)
    nicheId: integer("niche_id"),
    businessName: text("business_name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone").notNull(),
    phoneNormalized: text("phone_normalized"),
    gmapLink: text("gmap_link"),
    cityKeyword: text("city_keyword"),
    opensAt: text("opens_at"),
    websiteStatus: text("website_status"),
    websiteUrl: text("website_url"),
    serviceStatus: text("service_status"),
    callStatus: text("call_status"),
    // mirrored columns used by companion tooling
    categoryName: varchar("category_name"),
    isAccessApproved: approvalStatusEnum("is_access_approved").default("PENDING"),
    // --- extended lead structure (custom lead form) ---
    title: text("title"),
    reviews: integer("reviews").notNull().default(0),
    nicheCategory: text("niche_category"),
    mobileNo: text("mobile_no"),
    statusService: text("status_service"),
    leadStatus: text("lead_status"),
    leadCloseAmount: numeric("lead_close_amount", { precision: 12, scale: 2 }),
    // Backed Check pipeline state (owned jointly with companion tooling)
    backendCheck: boolean("backend_check").notNull().default(false),
    backendCheckNote: text("backend_check_note"),
    backendCheckedAt: timestamp("backend_checked_at", { withTimezone: true }),
    email: text("email"),
    website: text("website"),
    address: text("address"),
    city: text("city"),
    rating: numeric("rating", { precision: 2, scale: 1 }).default("0"),
    reviewsCount: integer("reviews_count").notNull().default(0),
    competitorName: text("competitor_name"),
    competitorReviews: integer("competitor_reviews").notNull().default(0),
    // NEW | IN_PROGRESS | CALLBACK | PAYMENT_APPROVAL | REJECTED | CLOSED | ARCHIVED
    status: text("status").notNull().default("NEW"),
    assignedAgentId: uuid("assigned_agent_id"),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    lastTouchedAt: timestamp("last_touched_at", { withTimezone: true }),
    // scheduled reminder when the agent moves a lead to Call back
    callbackAt: timestamp("callback_at", { withTimezone: true }),
    // why a lead is in the unassigned pool: AUTO_NO_RESPONSE | AUTO_REJECTED | AGENT_LOST | MANUAL | null
    unassignReason: text("unassign_reason"),
    callCount: integer("call_count").notNull().default(0),
    dealAmount: numeric("deal_amount", { precision: 12, scale: 2 }),
    commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }),
    accessUnlocked: boolean("access_unlocked").notNull().default(false),
    unlockedAt: timestamp("unlocked_at", { withTimezone: true }),
    archivedForAgent: boolean("archived_for_agent").notNull().default(false),
    cycleCount: integer("cycle_count").notNull().default(0),
    batchId: text("batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("leads_status_idx").on(t.status),
    index("leads_niche_idx").on(t.nicheId),
    index("leads_agent_idx").on(t.assignedAgentId),
    index("leads_created_idx").on(t.createdAt),
    index("leads_agent_status_idx").on(t.assignedAgentId, t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Message templates per niche with {placeholders}                     */
/* ------------------------------------------------------------------ */
export const templates = pgTable("templates", {
  id: serial("id").primaryKey(),
  nicheId: integer("niche_id"),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Call logs / notes (agent identity masked for other agents)          */
/* ------------------------------------------------------------------ */
export const callLogs = pgTable(
  "call_logs",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull(),
    agentId: uuid("agent_id").notNull(),
    status: text("status").notNull(),
    notes: text("notes"),
    callStartedAt: timestamp("call_started_at", { withTimezone: true }),
    callEndedAt: timestamp("call_ended_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    whatsappTemplateId: integer("whatsapp_template_id"),
    whatsappSent: boolean("whatsapp_sent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("call_logs_lead_idx").on(t.leadId), index("call_logs_agent_idx").on(t.agentId)],
);

/* ------------------------------------------------------------------ */
/* Uploads (screenshots / KYC proofs)                                  */
/* ------------------------------------------------------------------ */
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull().default("PROOF"),
  fileName: text("file_name"),
  mimeType: text("mime_type"),
  /** canonical Backblaze B2 URL (or /api/files/:id for the Postgres fallback) */
  externalUrl: text("external_url"),
  /** B2 object key — lets the app re-sign or proxy the object later */
  storageKey: text("storage_key"),
  /** b2 | postgres — records where the bytes actually live */
  storageDriver: text("storage_driver").default("postgres"),
  // mirrored columns used by companion tooling
  fileCategory: text("file_category").default("Others"),
  isManualUpload: boolean("is_manual_upload").notNull().default(false),
  /** inline base64, used only by the Postgres fallback driver */
  data: text("data"),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Deal approvals (payment proof -> commission)                        */
/* ------------------------------------------------------------------ */
export const dealApprovals = pgTable("deal_approvals", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  agentId: uuid("agent_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  commission: numeric("commission", { precision: 12, scale: 2 }).notNull(),
  // commission slab applied at submission time (kept for the itemized breakdown)
  slabLabel: text("slab_label"),
  slabIndex: integer("slab_index"),
  bonusAmount: numeric("bonus_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  proofUrl: text("proof_url"),
  proofUploadId: integer("proof_upload_id"),
  agentNote: text("agent_note"),
  status: text("status").notNull().default("PENDING"),
  reviewedBy: uuid("reviewed_by"),
  reviewNote: text("review_note"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Withdrawal / payout requests                                        */
/* ------------------------------------------------------------------ */
export const withdrawals = pgTable("withdrawals", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  method: text("method").notNull().default("UPI"),
  destination: text("destination"),
  proofUrl: text("proof_url"),
  status: text("status").notNull().default("PENDING"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Correction requests ("Any mistake happen?")                         */
/* ------------------------------------------------------------------ */
export const correctionRequests = pgTable("correction_requests", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  userId: uuid("user_id").notNull(),
  logId: integer("log_id"),
  reason: text("reason").notNull(),
  requestedStatus: text("requested_status"),
  status: text("status").notNull().default("PENDING"),
  resolvedNote: text("resolved_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Agent requests for new / re-assigned leads                          */
/* ------------------------------------------------------------------ */
export const leadRequests = pgTable("lead_requests", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  nicheId: integer("niche_id"),
  quantity: integer("quantity").notNull().default(10),
  // NEW_LEADS | REPLACE_LEAD
  kind: text("kind").notNull().default("NEW_LEADS"),
  leadId: integer("lead_id"),
  reason: text("reason"),
  note: text("note"),
  status: text("status").notNull().default("PENDING"),
  resolvedNote: text("resolved_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Agent requests to read masked/hidden past call history on a lead. */
export const historyAccessRequests = pgTable("history_access_requests", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  userId: uuid("user_id").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("PENDING"),
  grantedBy: uuid("granted_by"),
  resolvedNote: text("resolved_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Global system toggles (key/value) — e.g. show-history-to-agent. */
export const systemSettings = pgTable(
  "system_settings",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    value: text("value").notNull(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("system_settings_key_uq").on(t.key)],
);

/**
 * Lead field-change timeline. Every management field update, status change and
 * (re)assignment writes one row per changed field. Rendered ONLY to staff.
 */
export const leadHistory = pgTable(
  "lead_history",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull(),
    changedBy: uuid("changed_by"),
    changedByName: text("changed_by_name"),
    changedByRole: text("changed_by_role"),
    fieldName: text("field_name").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    // mirrored columns owned by companion tooling on this Supabase project
    changeType: text("change_type").notNull().default("FIELD_UPDATE"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("lead_history_lead_idx").on(t.leadId), index("lead_history_actor_idx").on(t.changedBy)],
);

export type LeadHistoryEntry = typeof leadHistory.$inferSelect;

/* ------------------------------------------------------------------ */
/* Audit trail                                                         */
/* ------------------------------------------------------------------ */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actorId: uuid("actor_id"),
    actorRole: text("actor_role"),
    leadId: integer("lead_id"),
    action: text("action").notNull(),
    detail: text("detail"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_lead_idx").on(t.leadId), index("audit_actor_idx").on(t.actorId)],
);

/* ------------------------------------------------------------------ */
/* Push notifications / broadcasts                                     */
/* ------------------------------------------------------------------ */
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  audienceRole: text("audience_role").notNull().default("ALL"),
  targetUserId: uuid("target_user_id"),
  sentBy: uuid("sent_by"),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Live time tracking (Page Visibility API synced every 60s)           */
/* ------------------------------------------------------------------ */
export const timeLogs = pgTable("time_logs", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  day: text("day").notNull(),
  seconds: integer("seconds").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Direct chat                                                         */
/* ------------------------------------------------------------------ */
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    fromUserId: uuid("from_user_id").notNull(),
    toUserId: uuid("to_user_id"),
    channel: text("channel").notNull().default("DIRECT"),
    body: text("body").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chat_pair_idx").on(t.fromUserId, t.toUserId)],
);

/* ------------------------------------------------------------------ */
/* WebRTC / Agora style live audio sessions                            */
/* ------------------------------------------------------------------ */
export const callSessions = pgTable("call_sessions", {
  id: serial("id").primaryKey(),
  hostId: uuid("host_id").notNull(),
  guestId: uuid("guest_id"),
  channelName: text("channel_name").notNull(),
  mode: text("mode").notNull().default("ONE_TO_ONE"),
  status: text("status").notNull().default("RINGING"),
  provider: text("provider").notNull().default("WEBRTC"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  durationSeconds: integer("duration_seconds").notNull().default(0),
});

/* ------------------------------------------------------------------ */
/* Role-based field visibility matrix (Admin managed RBAC)             */
/* fieldKey -> role -> VISIBLE | MASKED | HIDDEN                       */
/* ------------------------------------------------------------------ */
export const fieldPermissions = pgTable(
  "field_permissions",
  {
    id: serial("id").primaryKey(),
    fieldKey: text("field_key").notNull(),
    role: text("role").notNull(),
    // VISIBLE | MASKED | HIDDEN
    mode: text("mode").notNull().default("VISIBLE"),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("field_perm_uq").on(t.fieldKey, t.role)],
);

export type User = typeof users.$inferSelect;
export type Lead = typeof leads.$inferSelect;
export type Niche = typeof niches.$inferSelect;
export type Template = typeof templates.$inferSelect;
export type CallLog = typeof callLogs.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type FieldPermission = typeof fieldPermissions.$inferSelect;
export type LeadRequest = typeof leadRequests.$inferSelect;
export type HistoryAccessRequest = typeof historyAccessRequests.$inferSelect;
export type SystemSetting = typeof systemSettings.$inferSelect;

/* ------------------------------------------------------------------ */
/* Tiered commission slabs (configurable by Admin/HR/Manager)          */
/* ------------------------------------------------------------------ */
export const commissionSlabs = pgTable("commission_slabs", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  // 1..5 — matches the mandated five tiers
  tierIndex: integer("tier_index").notNull().default(1),
  // inclusive lower bound of closes
  minCloses: integer("min_closes").notNull(),
  // inclusive upper bound (null = no upper limit)
  maxCloses: integer("max_closes"),
  amountPerClose: numeric("amount_per_close", { precision: 12, scale: 2 }).notNull(),
  isActive: boolean("is_active").notNull().default(true),
  updatedBy: uuid("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Custom bonuses granted by Admin/HR/Manager                          */
/* ------------------------------------------------------------------ */
export const bonuses = pgTable("bonuses", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  title: text("title").notNull(),
  note: text("note"),
  dealApprovalId: integer("deal_approval_id"),
  status: text("status").notNull().default("APPROVED"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ------------------------------------------------------------------ */
/* Daily activity snapshot per agent per day                           */
/* ------------------------------------------------------------------ */
export const dailyActivity = pgTable(
  "daily_activity",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    day: text("day").notNull(),
    // Page Visibility API active seconds
    activeSeconds: integer("active_seconds").notNull().default(0),
    touchedLeads: integer("touched_leads").notNull().default(0),
    statusChanges: integer("status_changes").notNull().default(0),
    dealsClosed: integer("deals_closed").notNull().default(0),
    callsMade: integer("calls_made").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("daily_activity_user_day_uq").on(t.userId, t.day)],
);

/* ------------------------------------------------------------------ */
/* KYC documents (multiple marksheets, avatar photo, etc.)             */
/* ------------------------------------------------------------------ */
export const kycDocuments = pgTable("kyc_documents", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  // AADHAAR | PHOTO | MARKSHEET | PAN | OTHER
  kind: text("kind").notNull(),
  fileName: text("file_name"),
  url: text("url").notNull(),
  uploadId: integer("upload_id"),
  verified: boolean("verified").notNull().default(false),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Per-agent overrides of the 5 commission tiers.
 * A row here beats the global slab for that tier index.
 */
export const agentSlabs = pgTable(
  "agent_slabs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    // 1..5 matching the five tiers
    tierIndex: integer("tier_index").notNull(),
    label: text("label").notNull(),
    minCloses: integer("min_closes").notNull(),
    maxCloses: integer("max_closes"),
    amountPerClose: numeric("amount_per_close", { precision: 12, scale: 2 }).notNull(),
    updatedBy: uuid("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_slabs_user_tier_uq").on(t.userId, t.tierIndex)],
);

export type CommissionSlab = typeof commissionSlabs.$inferSelect;
export type Bonus = typeof bonuses.$inferSelect;
export type DailyActivity = typeof dailyActivity.$inferSelect;
export type KycDocument = typeof kycDocuments.$inferSelect;

/* ------------------------------------------------------------------ */
/* Lead error reports ("Report Lead Error" from the agent workspace)   */
/* ------------------------------------------------------------------ */
export const leadErrorReports = pgTable("lead_error_reports", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id").notNull(),
  userId: uuid("user_id").notNull(),
  // WRONG_NUMBER | DUPLICATE | CLOSED_BUSINESS | WRONG_DATA | DO_NOT_CALL | OTHER
  category: text("category").notNull().default("OTHER"),
  details: text("details").notNull(),
  proofUrl: text("proof_url"),
  status: text("status").notNull().default("PENDING"),
  reviewedBy: uuid("reviewed_by"),
  resolution: text("resolution"),
  // action taken: NONE | LEAD_UNASSIGNED | DATA_FIXED | MARKED_DO_NOT_CALL | REJECTED
  actionTaken: text("action_taken"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/* ------------------------------------------------------------------ */
/* Help-desk tickets                                                   */
/* ------------------------------------------------------------------ */
export const tickets = pgTable(
  "tickets",
  {
    id: serial("id").primaryKey(),
    // human readable, e.g. TKT-84920
    ticketNumber: text("ticket_number").notNull(),
    userId: uuid("user_id").notNull(),
    leadId: integer("lead_id"),
    // ACCESS_ISSUE | DATA_CORRECTION | PAYOUT_QUERY | LEAD_ISSUE | TECHNICAL | OTHER
    category: text("category").notNull().default("OTHER"),
    subject: text("subject").notNull(),
    details: text("details").notNull(),
    proofUrl: text("proof_url"),
    // OPEN | IN_PROGRESS | WAITING_AGENT | RESOLVED | REJECTED
    status: text("status").notNull().default("OPEN"),
    priority: text("priority").notNull().default("NORMAL"),
    assignedTo: uuid("assigned_to"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("tickets_number_uq").on(t.ticketNumber), index("tickets_user_idx").on(t.userId)],
);

/** Private 1-on-1 ticket conversation (agent <-> staff only). */
export const ticketMessages = pgTable(
  "ticket_messages",
  {
    id: serial("id").primaryKey(),
    ticketId: integer("ticket_id").notNull(),
    fromUserId: uuid("from_user_id").notNull(),
    body: text("body").notNull(),
    attachmentUrl: text("attachment_url"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("ticket_msg_ticket_idx").on(t.ticketId)],
);

export type LeadErrorReport = typeof leadErrorReports.$inferSelect;
export type Ticket = typeof tickets.$inferSelect;
export type TicketMessage = typeof ticketMessages.$inferSelect;

/* ------------------------------------------------------------------ */
/* Banners & popup broadcasts with mandatory acknowledgment            */
/* ------------------------------------------------------------------ */
export const broadcasts = pgTable("broadcasts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  // VIDEO urls render as an auto-embedded iframe in the popup; AUDIO urls render a player
  videoUrl: text("video_url"),
  audioUrl: text("audio_url"),
  // BANNER (passive strip) | POPUP (modal)
  kind: text("kind").notNull().default("POPUP"),
  /**
   * Advanced broadcast types:
   * strict_lock        — full-screen lock; must Acknowledge (no bare close)
   * management_lock    — lock + agents can leave private comments
   * dismissible_popup  — modal with a Close button (records DISMISSED)
   * site_banner        — persistent strip on every page; click opens a modal
   */
  broadcastType: text("broadcast_type").notNull().default("dismissible_popup"),
  // mirrored columns used by companion tooling
  format: text("format").default("TEXT"),
  isPersistent: boolean("is_persistent").notNull().default(true),
  mediaType: text("media_type").default("TEXT"),
  // ALL | AGENT | MANAGER | HR | ADMIN
  audienceRole: text("audience_role").notNull().default("AGENT"),
  // null = everyone in the audience
  targetUserId: uuid("target_user_id"),
  requireAcknowledgment: boolean("require_acknowledgment").notNull().default(true),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export const broadcastAcknowledgments = pgTable(
  "broadcast_acknowledgments",
  {
    id: serial("id").primaryKey(),
    broadcastId: integer("broadcast_id").notNull(),
    userId: uuid("user_id").notNull(),
    // ACKNOWLEDGED | UNDERSTOOD | NOTED
    response: text("response").notNull().default("ACKNOWLEDGED"),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("broadcast_ack_uq").on(t.broadcastId, t.userId)],
);

/**
 * Private comments on a broadcast.
 * An agent's comment is visible ONLY to that agent and to Management
 * (ADMIN | HR | MANAGER) — never to other agents. Enforced server-side in
 * /api/broadcasts/comments.
 */
export const broadcastComments = pgTable(
  "broadcast_comments",
  {
    id: serial("id").primaryKey(),
    broadcastId: integer("broadcast_id").notNull(),
    userId: uuid("user_id").notNull(),
    // denormalized so management views render names without extra joins
    userName: text("user_name"),
    body: text("body").notNull(),
    // mirrored column used by companion tooling (privacy still enforced in the API)
    isPrivate: boolean("is_private").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("broadcast_comments_bcast_idx").on(t.broadcastId), index("broadcast_comments_user_idx").on(t.userId)],
);

/** Pre-made + custom broadcast templates (management editable). */
export const broadcastTemplates = pgTable("broadcast_templates", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  imageUrl: text("image_url"),
  videoUrl: text("video_url"),
  audioUrl: text("audio_url"),
  // BANNER | POPUP
  kind: text("kind").notNull().default("POPUP"),
  // mirrored columns used by companion tooling
  category: text("category").notNull().default("GENERAL"),
  isSystem: boolean("is_system").notNull().default(false),
  mediaType: text("media_type").notNull().default("TEXT"),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Broadcast = typeof broadcasts.$inferSelect;
export type BroadcastAcknowledgment = typeof broadcastAcknowledgments.$inferSelect;
export type BroadcastComment = typeof broadcastComments.$inferSelect;
export type BroadcastTemplate = typeof broadcastTemplates.$inferSelect;

/* ------------------------------------------------------------------ */
/* Automated decision notices (mgmt approve/reject -> agent popup)     */
/* ------------------------------------------------------------------ */
export const decisionNotices = pgTable(
  "decision_notices",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    // REPLACE_LEAD | LEAD_ERROR | PAYMENT_PROOF | TICKET | KYC | COMMISSION | CORRECTION
    kind: text("kind").notNull(),
    // APPROVED | REJECTED | PENDING | INFO
    status: text("status").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    /** management's written notes shown verbatim in the popup */
    notes: text("notes"),
    leadId: integer("lead_id"),
    entityId: integer("entity_id"),
    actorName: text("actor_name"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("decision_notice_user_idx").on(t.userId)],
);

export type DecisionNotice = typeof decisionNotices.$inferSelect;

/* ------------------------------------------------------------------ */
/* Enterprise activity tracking                                        */
/* ------------------------------------------------------------------ */

/**
 * Per-agent, per-day interaction counters (clicks / actions / navigations /
 * lead opens). One row per user+day — written with an atomic UPSERT so the
 * live counter stays consistent with concurrent agents.
 */
export const agentClickUsage = pgTable(
  "agent_click_usage",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    day: text("day").notNull(),
    clicks: integer("clicks").notNull().default(0),
    actions: integer("actions").notNull().default(0),
    navigations: integer("navigations").notNull().default(0),
    leadOpens: integer("lead_opens").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_click_usage_user_day_uq").on(t.userId, t.day)],
);

/**
 * Every lead an agent opens: timestamp, the action that opened it, and how
 * long the lead stayed open (durationMs) once the agent navigates away.
 */
export const leadOpenLogs = pgTable(
  "lead_open_logs",
  {
    id: serial("id").primaryKey(),
    leadId: integer("lead_id").notNull(),
    userId: uuid("user_id").notNull(),
    // OPEN | CALL | WHATSAPP | STATUS_CHANGE | NOTE | EDIT | PROOF
    action: text("action").notNull().default("OPEN"),
    openedAt: timestamp("opened_at", { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    path: text("path"),
    platform: text("platform"),
  },
  (t) => [
    index("lead_open_logs_user_idx").on(t.userId),
    index("lead_open_logs_lead_idx").on(t.leadId),
    index("lead_open_logs_opened_idx").on(t.openedAt),
  ],
);

/**
 * Raw interaction stream — every click, button interaction and navigation
 * path, batched by the client and inserted with a single multi-row query.
 */
export const agentActivityEvents = pgTable(
  "agent_activity_events",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    sessionId: text("session_id"),
    // CLICK | ACTION | NAVIGATION | LEAD_OPEN
    eventType: text("event_type").notNull(),
    target: text("target"),
    path: text("path"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("agent_activity_events_user_idx").on(t.userId),
    index("agent_activity_events_created_idx").on(t.createdAt),
    index("agent_activity_events_session_idx").on(t.sessionId),
  ],
);

/** One row per browser session — powers the live "active working duration". */
export const agentSessions = pgTable(
  "agent_sessions",
  {
    id: serial("id").primaryKey(),
    userId: uuid("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    activeSeconds: integer("active_seconds").notNull().default(0),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    platform: text("platform"),
  },
  (t) => [uniqueIndex("agent_sessions_session_uq").on(t.sessionId), index("agent_sessions_user_idx").on(t.userId)],
);

export type AgentClickUsage = typeof agentClickUsage.$inferSelect;
export type LeadOpenLog = typeof leadOpenLogs.$inferSelect;
export type AgentActivityEvent = typeof agentActivityEvents.$inferSelect;
export type AgentSession = typeof agentSessions.$inferSelect;

/* ------------------------------------------------------------------ */
/* Companion-tooling tables (recreated app-managed equivalents so the  */
/* schema owns them; future pushes never drop them again).             */
/* If the companion tools ship exact migrations, re-apply those over   */
/* these definitions.                                                  */
/* ------------------------------------------------------------------ */

/** Who impersonated whom, when (mirrors the secure switch flow). */
export const impersonationLogs = pgTable("impersonation_logs", {
  id: serial("id").primaryKey(),
  adminId: uuid("admin_id"),
  targetUserId: uuid("target_user_id"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  userAgent: text("user_agent"),
});

/** Generic approval queue used by companion tooling. */
export const companionApprovals = pgTable("approvals", {
  id: serial("id").primaryKey(),
  leadId: integer("lead_id"),
  kind: text("kind").notNull().default("GENERIC"),
  status: approvalStatusEnum("status").notNull().default("PENDING"),
  requestedBy: uuid("requested_by"),
  decidedBy: uuid("decided_by"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

/** Money ledger (commission / withdrawal / bonus / adjustment). */
export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  type: platformTransactionTypeEnum("type").notNull().default("ADJUSTMENT"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Extended profile attributes keyed to a user. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique(),
  bio: text("bio"),
  avatarUrl: text("avatar_url"),
  theme: text("theme").notNull().default("day"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/** Saved embed configurations from the Video iFrame Studio. */
export const videoIframes = pgTable("video_iframes", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  embedUrl: text("embed_url").notNull(),
  theme: text("theme").notNull().default("wistia"),
  isActive: boolean("is_active").notNull().default(true),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
