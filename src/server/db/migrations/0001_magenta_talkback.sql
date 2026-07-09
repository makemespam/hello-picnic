CREATE TYPE "public"."image_kind" AS ENUM('card', 'generated', 'derived');--> statement-breakpoint
CREATE TYPE "public"."ingredient_category" AS ENUM('groenten', 'fruit', 'zuivel', 'vis', 'kruiden', 'granen', 'peulvruchten', 'overig');--> statement-breakpoint
CREATE TYPE "public"."product_preference" AS ENUM('fresh', 'frozen', 'canned', 'dried', 'any');--> statement-breakpoint
CREATE TYPE "public"."recipe_difficulty" AS ENUM('makkelijk', 'gemiddeld', 'uitdagend');--> statement-breakpoint
CREATE TYPE "public"."recipe_source" AS ENUM('card', 'ai', 'manual');--> statement-breakpoint
CREATE TYPE "public"."recipe_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."recipe_type" AS ENUM('vegan', 'vegetarisch', 'vis', 'kip', 'rund', 'varken');--> statement-breakpoint
CREATE TABLE "images" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" "image_kind" NOT NULL,
	"file_path" text NOT NULL,
	"mime" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"recipe_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_ingredients" (
	"id" serial PRIMARY KEY NOT NULL,
	"recipe_id" integer NOT NULL,
	"name_key" text NOT NULL,
	"display" text NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"unit" text NOT NULL,
	"category" "ingredient_category" NOT NULL,
	"product_preference" "product_preference",
	"pantry" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipes" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer DEFAULT 1 NOT NULL,
	"source" "recipe_source" DEFAULT 'manual' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "recipe_type" NOT NULL,
	"styles_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"time_min" integer NOT NULL,
	"difficulty" "recipe_difficulty" NOT NULL,
	"servings_base" integer NOT NULL,
	"steps_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hero_image_id" integer,
	"card_scan_id" integer,
	"nutrition_json" jsonb,
	"status" "recipe_status" DEFAULT 'active' NOT NULL,
	"rating" integer DEFAULT 0 NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"times_planned" integer DEFAULT 0 NOT NULL,
	"last_planned_at" timestamp with time zone,
	"source_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "images" ADD CONSTRAINT "images_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_recipes_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "recipe_ingredients_recipe_id_idx" ON "recipe_ingredients" USING btree ("recipe_id");--> statement-breakpoint
CREATE INDEX "recipes_household_status_idx" ON "recipes" USING btree ("household_id","status");--> statement-breakpoint
CREATE INDEX "recipes_source_ref_idx" ON "recipes" USING btree ("source_ref");