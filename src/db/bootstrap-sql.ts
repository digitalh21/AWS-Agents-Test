/**
 * Idempotent DDL bootstrap.
 * Generated from src/db/schema.ts (drizzle-kit) and made idempotent so a fresh
 * Postgres/Supabase database self-provisions on first request.
 */
export const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS "agent_slabs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier_index" integer NOT NULL,
	"label" text NOT NULL,
	"min_closes" integer NOT NULL,
	"max_closes" integer,
	"amount_per_close" numeric(12, 2) NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_role" text,
	"lead_id" integer,
	"action" text NOT NULL,
	"detail" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "bonuses" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"title" text NOT NULL,
	"note" text,
	"deal_approval_id" integer,
	"status" text DEFAULT 'APPROVED' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "broadcast_acknowledgments" (
	"id" serial PRIMARY KEY NOT NULL,
	"broadcast_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"response" text DEFAULT 'ACKNOWLEDGED' NOT NULL,
	"acknowledged_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "broadcasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"image_url" text,
	"kind" text DEFAULT 'POPUP' NOT NULL,
	"audience_role" text DEFAULT 'AGENT' NOT NULL,
	"target_user_id" uuid,
	"require_acknowledgment" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "call_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"status" text NOT NULL,
	"notes" text,
	"call_started_at" timestamp with time zone,
	"call_ended_at" timestamp with time zone,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"whatsapp_template_id" integer,
	"whatsapp_sent" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "call_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"host_id" uuid NOT NULL,
	"guest_id" uuid,
	"channel_name" text NOT NULL,
	"mode" text DEFAULT 'ONE_TO_ONE' NOT NULL,
	"status" text DEFAULT 'RINGING' NOT NULL,
	"provider" text DEFAULT 'WEBRTC' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"from_user_id" uuid NOT NULL,
	"to_user_id" uuid,
	"channel" text DEFAULT 'DIRECT' NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "commission_slabs" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"tier_index" integer DEFAULT 1 NOT NULL,
	"min_closes" integer NOT NULL,
	"max_closes" integer,
	"amount_per_close" numeric(12, 2) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "correction_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"log_id" integer,
	"reason" text NOT NULL,
	"requested_status" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"resolved_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "daily_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"active_seconds" integer DEFAULT 0 NOT NULL,
	"touched_leads" integer DEFAULT 0 NOT NULL,
	"status_changes" integer DEFAULT 0 NOT NULL,
	"deals_closed" integer DEFAULT 0 NOT NULL,
	"calls_made" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "deal_approvals" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"agent_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"commission" numeric(12, 2) NOT NULL,
	"slab_label" text,
	"slab_index" integer,
	"bonus_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"proof_url" text,
	"proof_upload_id" integer,
	"agent_note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"review_note" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "decision_notices" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"notes" text,
	"lead_id" integer,
	"entity_id" integer,
	"actor_name" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "field_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"field_key" text NOT NULL,
	"role" text NOT NULL,
	"mode" text DEFAULT 'VISIBLE' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "history_access_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"granted_by" uuid,
	"resolved_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "kyc_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_name" text,
	"url" text NOT NULL,
	"upload_id" integer,
	"verified" boolean DEFAULT false NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "lead_error_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"details" text NOT NULL,
	"proof_url" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"reviewed_by" uuid,
	"resolution" text,
	"action_taken" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "lead_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"niche_id" integer,
	"quantity" integer DEFAULT 10 NOT NULL,
	"kind" text DEFAULT 'NEW_LEADS' NOT NULL,
	"lead_id" integer,
	"reason" text,
	"note" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"resolved_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "leads" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"lead_code" text,
	"niche_id" integer,
	"business_name" text NOT NULL,
	"contact_name" text,
	"phone" text NOT NULL,
	"phone_normalized" text,
	"gmap_link" text,
	"city_keyword" text,
	"opens_at" text,
	"website_status" text,
	"website_url" text,
	"service_status" text,
	"call_status" text,
	"email" text,
	"website" text,
	"address" text,
	"city" text,
	"rating" numeric(2, 1) DEFAULT '0',
	"reviews_count" integer DEFAULT 0 NOT NULL,
	"competitor_name" text,
	"competitor_reviews" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"assigned_agent_id" uuid,
	"assigned_at" timestamp with time zone,
	"last_touched_at" timestamp with time zone,
	"callback_at" timestamp with time zone,
	"unassign_reason" text,
	"call_count" integer DEFAULT 0 NOT NULL,
	"deal_amount" numeric(12, 2),
	"commission_amount" numeric(12, 2),
	"access_unlocked" boolean DEFAULT false NOT NULL,
	"unlocked_at" timestamp with time zone,
	"archived_for_agent" boolean DEFAULT false NOT NULL,
	"cycle_count" integer DEFAULT 0 NOT NULL,
	"batch_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "niches" (
	"id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#2563eb' NOT NULL,
	"visible_to_agents" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "niches_slug_unique" UNIQUE("slug")
);

CREATE TABLE IF NOT EXISTS "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience_role" text DEFAULT 'ALL' NOT NULL,
	"target_user_id" uuid,
	"sent_by" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "system_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"niche_id" integer,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"from_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"attachment_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_number" text NOT NULL,
	"user_id" uuid NOT NULL,
	"lead_id" integer,
	"category" text DEFAULT 'OTHER' NOT NULL,
	"subject" text NOT NULL,
	"details" text NOT NULL,
	"proof_url" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"priority" text DEFAULT 'NORMAL' NOT NULL,
	"assigned_to" uuid,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);

CREATE TABLE IF NOT EXISTS "time_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"day" text NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'PROOF' NOT NULL,
	"file_name" text,
	"mime_type" text,
	"external_url" text,
	"storage_key" text,
	"storage_driver" text DEFAULT 'postgres',
	"data" text,
	"size_bytes" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'AGENT' NOT NULL,
	"primary_niche_id" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_online" boolean DEFAULT false NOT NULL,
	"avatar_url" text,
	"wallet_total" numeric(12, 2) DEFAULT '0' NOT NULL,
	"wallet_pending" numeric(12, 2) DEFAULT '0' NOT NULL,
	"wallet_approved" numeric(12, 2) DEFAULT '0' NOT NULL,
	"commission_per_deal" numeric(12, 2) DEFAULT '500' NOT NULL,
	"daily_lead_quota" integer,
	"bank_name" text,
	"bank_account" text,
	"bank_ifsc" text,
	"upi_id" text,
	"payout_locked" boolean DEFAULT false NOT NULL,
	"payout_locked_by" uuid,
	"payout_locked_at" timestamp with time zone,
	"kyc_status" text DEFAULT 'PENDING' NOT NULL,
	"kyc_aadhaar_url" text,
	"kyc_marksheet_url" text,
	"kyc_photo_url" text,
	"kyc_pan_url" text,
	"alt_phone" text,
	"guardian_phone" text,
	"qualification" text,
	"about_person" text,
	"badges" jsonb DEFAULT '[]'::jsonb,
	"active_seconds" bigint DEFAULT 0 NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "withdrawals" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text DEFAULT 'UPI' NOT NULL,
	"destination" text,
	"proof_url" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_slabs_user_tier_uq" ON "agent_slabs" USING btree ("user_id","tier_index");
CREATE INDEX IF NOT EXISTS "audit_lead_idx" ON "audit_logs" USING btree ("lead_id");
CREATE INDEX IF NOT EXISTS "audit_actor_idx" ON "audit_logs" USING btree ("actor_id");
CREATE UNIQUE INDEX IF NOT EXISTS "broadcast_ack_uq" ON "broadcast_acknowledgments" USING btree ("broadcast_id","user_id");
CREATE INDEX IF NOT EXISTS "call_logs_lead_idx" ON "call_logs" USING btree ("lead_id");
CREATE INDEX IF NOT EXISTS "call_logs_agent_idx" ON "call_logs" USING btree ("agent_id");
CREATE INDEX IF NOT EXISTS "chat_pair_idx" ON "chat_messages" USING btree ("from_user_id","to_user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "daily_activity_user_day_uq" ON "daily_activity" USING btree ("user_id","day");
CREATE INDEX IF NOT EXISTS "decision_notice_user_idx" ON "decision_notices" USING btree ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "field_perm_uq" ON "field_permissions" USING btree ("field_key","role");
CREATE INDEX IF NOT EXISTS "leads_status_idx" ON "leads" USING btree ("status");
CREATE INDEX IF NOT EXISTS "leads_niche_idx" ON "leads" USING btree ("niche_id");
CREATE INDEX IF NOT EXISTS "leads_agent_idx" ON "leads" USING btree ("assigned_agent_id");
CREATE INDEX IF NOT EXISTS "leads_created_idx" ON "leads" USING btree ("created_at");
CREATE INDEX IF NOT EXISTS "leads_agent_status_idx" ON "leads" USING btree ("assigned_agent_id","status");
CREATE UNIQUE INDEX IF NOT EXISTS "system_settings_key_uq" ON "system_settings" USING btree ("key");
CREATE INDEX IF NOT EXISTS "ticket_msg_ticket_idx" ON "ticket_messages" USING btree ("ticket_id");
CREATE UNIQUE INDEX IF NOT EXISTS "tickets_number_uq" ON "tickets" USING btree ("ticket_number");
CREATE INDEX IF NOT EXISTS "tickets_user_idx" ON "tickets" USING btree ("user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq" ON "users" USING btree ("email");
CREATE INDEX IF NOT EXISTS "users_role_idx" ON "users" USING btree ("role");
CREATE INDEX IF NOT EXISTS "leads_updated_idx" ON "leads" ("updated_at" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "leads_niche_status_idx" ON "leads" ("niche_id", "status");

-- Extended lead structure (custom lead form columns, idempotent)
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "title" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "reviews" integer DEFAULT 0 NOT NULL;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "niche_category" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "mobile_no" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "status_service" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lead_status" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lead_close_amount" numeric(12, 2);

-- Broadcast media formats (video -> auto-embedded iframe, audio -> player)
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "video_url" text;
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "audio_url" text;

CREATE TABLE IF NOT EXISTS "broadcast_comments" (
	"id" serial PRIMARY KEY NOT NULL,
	"broadcast_id" integer NOT NULL,
	"user_id" uuid NOT NULL,
	"user_name" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "broadcast_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"image_url" text,
	"video_url" text,
	"audio_url" text,
	"kind" text DEFAULT 'POPUP' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "broadcast_comments_bcast_idx" ON "broadcast_comments" USING btree ("broadcast_id");
CREATE INDEX IF NOT EXISTS "broadcast_comments_user_idx" ON "broadcast_comments" USING btree ("user_id");

-- Advanced broadcast types + backfill from the legacy kind/ack columns
ALTER TABLE "broadcasts" ADD COLUMN IF NOT EXISTS "broadcast_type" text DEFAULT 'dismissible_popup' NOT NULL;
UPDATE "broadcasts" SET "broadcast_type" = 'site_banner' WHERE "kind" = 'BANNER' AND "broadcast_type" = 'dismissible_popup';
UPDATE "broadcasts" SET "broadcast_type" = 'strict_lock' WHERE "kind" = 'POPUP' AND "require_acknowledgment" = true AND "broadcast_type" = 'dismissible_popup';

ALTER TABLE "leads" ALTER COLUMN "niche_id" DROP NOT NULL;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "daily_lead_limit" integer;

CREATE TABLE IF NOT EXISTS "lead_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"changed_by" uuid,
	"changed_by_name" text,
	"changed_by_role" text,
	"field_name" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"change_type" text DEFAULT 'FIELD_UPDATE' NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "lead_history" ADD COLUMN IF NOT EXISTS "change_type" text DEFAULT 'FIELD_UPDATE' NOT NULL;
ALTER TABLE "lead_history" ADD COLUMN IF NOT EXISTS "note" text;
CREATE INDEX IF NOT EXISTS "lead_history_lead_idx" ON "lead_history" USING btree ("lead_id");
CREATE INDEX IF NOT EXISTS "lead_history_actor_idx" ON "lead_history" USING btree ("changed_by");

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "backend_check" boolean DEFAULT false NOT NULL;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "backend_check_note" text;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "backend_checked_at" timestamp with time zone;
`;
