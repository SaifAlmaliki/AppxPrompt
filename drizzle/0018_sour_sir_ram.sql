CREATE TABLE "server_route_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"path" text NOT NULL,
	"method" text NOT NULL,
	"status" integer NOT NULL,
	"error_code" text,
	"service" text,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "server_route_calls" ADD CONSTRAINT "server_route_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "server_route_calls_project_id_idx" ON "server_route_calls" USING btree ("project_id","id");