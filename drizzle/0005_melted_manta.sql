ALTER TABLE "tenants" DROP CONSTRAINT "tenants_slug_unique";--> statement-breakpoint
ALTER TABLE "audit_events" DROP CONSTRAINT "audit_events_actor_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "client_groups" DROP CONSTRAINT "client_groups_relationship_owner_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "client_services" DROP CONSTRAINT "client_services_legal_entity_id_legal_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "document_requests" DROP CONSTRAINT "document_requests_legal_entity_id_legal_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "document_requests" DROP CONSTRAINT "document_requests_work_item_id_work_items_id_fk";
--> statement-breakpoint
ALTER TABLE "document_requests" DROP CONSTRAINT "document_requests_requested_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_legal_entity_id_legal_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_work_item_id_work_items_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_request_id_document_requests_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_uploaded_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "legal_entities" DROP CONSTRAINT "legal_entities_client_group_id_client_groups_id_fk";
--> statement-breakpoint
ALTER TABLE "registrations" DROP CONSTRAINT "registrations_legal_entity_id_legal_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_legal_entity_id_legal_entities_id_fk";
--> statement-breakpoint
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_assignee_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "work_items" DROP CONSTRAINT "work_items_reviewer_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_tenant_id_unique" UNIQUE("tenant_id","id");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_membership_fk" FOREIGN KEY ("tenant_id","actor_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_groups" ADD CONSTRAINT "client_groups_owner_membership_fk" FOREIGN KEY ("tenant_id","relationship_owner_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_requester_membership_fk" FOREIGN KEY ("tenant_id","requested_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_work_tenant_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_request_tenant_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."document_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploader_membership_fk" FOREIGN KEY ("tenant_id","uploaded_by_user_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_entities" ADD CONSTRAINT "legal_entities_group_tenant_fk" FOREIGN KEY ("tenant_id","client_group_id") REFERENCES "public"."client_groups"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_entity_tenant_fk" FOREIGN KEY ("tenant_id","legal_entity_id") REFERENCES "public"."legal_entities"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_assignee_membership_fk" FOREIGN KEY ("tenant_id","assignee_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_reviewer_membership_fk" FOREIGN KEY ("tenant_id","reviewer_id") REFERENCES "public"."tenant_memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_occurred_idx" ON "audit_events" USING btree ("tenant_id","occurred_at");--> statement-breakpoint
CREATE INDEX "documents_tenant_created_idx" ON "documents" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_lower_unique" ON "tenants" USING btree (lower("slug"));--> statement-breakpoint
CREATE INDEX "work_items_tenant_due_idx" ON "work_items" USING btree ("tenant_id","statutory_due_date");--> statement-breakpoint
ALTER TABLE "client_services" ADD CONSTRAINT "client_services_status_check" CHECK ("client_services"."status" in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "document_requests" ADD CONSTRAINT "document_requests_received_state_check" CHECK (("document_requests"."status" = 'received' and "document_requests"."received_at" is not null) or ("document_requests"."status" <> 'received' and "document_requests"."received_at" is null));--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_sha256_check" CHECK ("documents"."sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_status_check" CHECK ("registrations"."status" in ('active', 'inactive'));--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_deadline_order_check" CHECK ("work_items"."internal_due_date" is null or "work_items"."internal_due_date" <= "work_items"."statutory_due_date");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_separation_check" CHECK ("work_items"."assignee_id" is null or "work_items"."reviewer_id" is null or "work_items"."assignee_id" <> "work_items"."reviewer_id");--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_completed_state_check" CHECK ("work_items"."status" <> 'completed' or ("work_items"."progress" = 100 and "work_items"."missing_item_count" = 0));
