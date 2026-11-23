CREATE TABLE "project_credentials" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"service_slug" text NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"hint" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_credentials_project_id_name_pk" PRIMARY KEY("project_id","name")
);
--> statement-breakpoint
CREATE TABLE "project_services" (
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"definition" jsonb NOT NULL,
	"approved_hosts" text[] DEFAULT '{}' NOT NULL,
	"check_result" text,
	"checked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_services_project_id_slug_pk" PRIMARY KEY("project_id","slug")
);
--> statement-breakpoint
ALTER TABLE "project_credentials" ADD CONSTRAINT "project_credentials_project_id_service_slug_project_services_project_id_slug_fk" FOREIGN KEY ("project_id","service_slug") REFERENCES "public"."project_services"("project_id","slug") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_services" ADD CONSTRAINT "project_services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;