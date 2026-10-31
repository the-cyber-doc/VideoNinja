-- Version 3 → 2: back to a release before the indexes and the "moderator" access
-- (admins then change only their own comments). No content is lost: the "deleted user"
-- (id 0) stays while comments or uploads point to it (NOT NULL), shown under its username.
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

DELETE FROM "role_has_access" WHERE "access" = 'moderator';
DELETE FROM "access" WHERE "id" = 'moderator';
DELETE FROM "translation" WHERE "id" = 'access.moderator.name';

UPDATE "segment" SET "created_by" = NULL WHERE "created_by" = 0;
UPDATE "video" SET "uploaded_by" = NULL WHERE "uploaded_by" = 0;
DELETE FROM "user" WHERE "id" = 0
	AND NOT EXISTS (SELECT 1 FROM "comment" WHERE "user" = 0)
	AND NOT EXISTS (SELECT 1 FROM "upload" WHERE "user" = 0);

UPDATE "config" SET "value" = '2' WHERE "name" = 'db_version';

COMMIT;
