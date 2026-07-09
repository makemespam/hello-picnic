CREATE TYPE "public"."integration_provider" AS ENUM('picnic', 'bring', 'google');--> statement-breakpoint
CREATE TYPE "public"."llm_purpose" AS ENUM('plan', 'replace', 'validate_product', 'scan_card', 'image', 'suggest');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('adult', 'child');--> statement-breakpoint
CREATE TABLE "integration_tokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" "integration_provider" NOT NULL,
	"payload_encrypted" text NOT NULL,
	"expires_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "llm_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"purpose" "llm_purpose" NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_cents" numeric(12, 4) NOT NULL,
	"duration_ms" integer NOT NULL,
	"ok" boolean NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"household_id" integer DEFAULT 1 NOT NULL,
	"key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	"is_secret" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settings_household_id_key_pk" PRIMARY KEY("household_id","key")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"household_id" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'adult' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");