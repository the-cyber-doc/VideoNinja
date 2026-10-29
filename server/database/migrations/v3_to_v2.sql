-- Version 3 → 2: back to a release before the indexes. Nothing is lost.
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

DROP INDEX IF EXISTS "video_status";
DROP INDEX IF EXISTS "video_uploaded_by";
DROP INDEX IF EXISTS "video_upload";
DROP INDEX IF EXISTS "segment_video";
DROP INDEX IF EXISTS "segment_technique";
DROP INDEX IF EXISTS "segment_performer";
DROP INDEX IF EXISTS "segment_created_by";
DROP INDEX IF EXISTS "segment_has_tags_tag";
DROP INDEX IF EXISTS "video_has_tags_tag";
DROP INDEX IF EXISTS "comment_technique";
DROP INDEX IF EXISTS "comment_user";
DROP INDEX IF EXISTS "session_user";
DROP INDEX IF EXISTS "upload_user";
DROP INDEX IF EXISTS "upload_state";

UPDATE "config" SET "value" = '2' WHERE "name" = 'db_version';

COMMIT;
