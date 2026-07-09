CREATE TYPE "public"."card_scan_status" AS ENUM('uploaded', 'extracted', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "card_scans" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer DEFAULT 1 NOT NULL,
	"front_image_id" integer NOT NULL,
	"back_image_id" integer,
	"status" "card_scan_status" DEFAULT 'uploaded' NOT NULL,
	"extraction_json" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "card_scans" ADD CONSTRAINT "card_scans_front_image_id_images_id_fk" FOREIGN KEY ("front_image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_scans" ADD CONSTRAINT "card_scans_back_image_id_images_id_fk" FOREIGN KEY ("back_image_id") REFERENCES "public"."images"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_scans_household_status_idx" ON "card_scans" USING btree ("household_id","status");--> statement-breakpoint
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_card_scan_id_card_scans_id_fk" FOREIGN KEY ("card_scan_id") REFERENCES "public"."card_scans"("id") ON DELETE set null ON UPDATE no action;