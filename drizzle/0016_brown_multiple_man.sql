CREATE TYPE "public"."server_route_kind" AS ENUM('function', 'agent', 'helper');--> statement-breakpoint
CREATE TABLE "project_sandboxes" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"sandbox_id" text,
	"domain" text,
	"signature" text,
	"starting_until" timestamp,
	"session_started_at" timestamp,
	"deadline_at" timestamp,
	"usage_day" text,
	"usage_ms" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "server_routes" (
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" "server_route_kind" NOT NULL,
	"purpose" text NOT NULL,
	"code" text,
	"status" "screen_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "server_routes_project_id_path_pk" PRIMARY KEY("project_id","path")
);
--> statement-breakpoint
ALTER TABLE "project_sandboxes" ADD CONSTRAINT "project_sandboxes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server_routes" ADD CONSTRAINT "server_routes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;