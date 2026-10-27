-- Version 2 → 1: back to a release before the encoder had its own container.
-- Segment thumbnails still to be made by the encoder (video.thumbs_dirty) are lost:
-- re-time those segments on the Videos page to get them.
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

DROP TABLE IF EXISTS "heartbeat";

ALTER TABLE "video" DROP COLUMN "thumbs_dirty";

UPDATE "config" SET "value" = '1' WHERE "name" = 'db_version';

COMMIT;
