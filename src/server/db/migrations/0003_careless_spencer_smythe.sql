CREATE TYPE "public"."shopping_item_status" AS ENUM('open', 'added', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."shopping_provider" AS ENUM('picnic', 'bring');--> statement-breakpoint
CREATE TABLE "shopping_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"name_key" text NOT NULL,
	"display" text NOT NULL,
	"total_amount" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"category" "ingredient_category" NOT NULL,
	"product_preference" "product_preference",
	"pantry" boolean DEFAULT false NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provider" "shopping_provider" DEFAULT 'picnic' NOT NULL,
	"article_json" jsonb,
	"article_count" integer,
	"coverage_label" text,
	"warning" text,
	"price_cents" integer,
	"status" "shopping_item_status" DEFAULT 'open' NOT NULL,
	"breakdown" text DEFAULT '' NOT NULL,
	"last_error" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "shopping_items_plan_id_idx" ON "shopping_items" USING btree ("plan_id");