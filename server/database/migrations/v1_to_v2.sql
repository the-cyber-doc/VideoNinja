-- Version 1 → 2: the encoder in its own container.
-- - heartbeat: its liveness, for /health;
-- - video.thumbs_dirty: segments changed on the Videos page, whose thumbnails the
--   encoder makes (the API runs no ffmpeg).
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

CREATE TABLE IF NOT EXISTS "heartbeat" (
	"name" VARCHAR NOT NULL PRIMARY KEY,
	"at" DATETIME NOT NULL
);

ALTER TABLE "video" ADD COLUMN "thumbs_dirty" INTEGER NOT NULL DEFAULT 0;

UPDATE "config" SET "value" = '2' WHERE "name" = 'db_version';

COMMIT;
