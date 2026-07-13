CREATE TYPE "public"."recipe_photo_status" AS ENUM('pending', 'generating', 'done', 'failed');--> statement-breakpoint
ALTER TABLE "recipes" ADD COLUMN "photo_status" "recipe_photo_status";