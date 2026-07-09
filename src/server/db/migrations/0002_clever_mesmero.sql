CREATE TYPE "public"."plan_status" AS ENUM('draft', 'final');--> statement-breakpoint
CREATE TABLE "plan_meals" (
	"id" serial PRIMARY KEY NOT NULL,
	"plan_id" integer NOT NULL,
	"recipe_id" integer NOT NULL,
	"slot_index" integer NOT NULL,
	"cook_date" text,
	"approved" boolean DEFAULT false NOT NULL,
	"calendar_event_id" text
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer DEFAULT 1 NOT NULL,
	"week_start" text NOT NULL,
	"servings" integer NOT NULL,
	"meal_count" integer NOT NULL,
	"rationale" text DEFAULT '' NOT NULL,
	"status" "plan_status" DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_meals" ADD CONSTRAINT "plan_meals_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_meals_plan_id_idx" ON "plan_meals" USING btree ("plan_id");