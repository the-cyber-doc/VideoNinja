-- Version 2 → 3: indexes on the columns the app looks rows up by (see db_v3.sql), and the
-- "moderator" access (edit and delete anyone's comments), given to the admin role, and the
-- generic "deleted user" (id 0) that a deleted user's content is given to.
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

CREATE INDEX IF NOT EXISTS "video_status" ON "video" ("status");
CREATE INDEX IF NOT EXISTS "video_uploaded_by" ON "video" ("uploaded_by");
CREATE INDEX IF NOT EXISTS "video_upload" ON "video" ("upload");
CREATE INDEX IF NOT EXISTS "segment_video" ON "segment" ("video");
CREATE INDEX IF NOT EXISTS "segment_technique" ON "segment" ("technique");
CREATE INDEX IF NOT EXISTS "segment_performer" ON "segment" ("performer");
CREATE INDEX IF NOT EXISTS "segment_created_by" ON "segment" ("created_by");
CREATE INDEX IF NOT EXISTS "segment_has_tags_tag" ON "segment_has_tags" ("tag");
CREATE INDEX IF NOT EXISTS "video_has_tags_tag" ON "video_has_tags" ("tag");
CREATE INDEX IF NOT EXISTS "comment_technique" ON "comment" ("technique");
CREATE INDEX IF NOT EXISTS "comment_user" ON "comment" ("user");
CREATE INDEX IF NOT EXISTS "session_user" ON "session" ("user");
CREATE INDEX IF NOT EXISTS "upload_user" ON "upload" ("user");
CREATE INDEX IF NOT EXISTS "upload_state" ON "upload" ("state");

INSERT INTO "translation" ("id", "en", "fr") VALUES
	('access.moderator.name', 'Moderation', 'Modération');
INSERT INTO "access" ("id", "name") VALUES
	('moderator', 'access.moderator.name');
INSERT INTO "role_has_access" ("role", "access") VALUES
	('admin', 'moderator');

-- The generic "deleted user" (id 0, never listed nor managed): a deleted user's comments,
-- segments, videos and uploads are given to it. Its username is outside the username
-- pattern (app/validation.json) and it has no credentials: nobody can create it or log in as it.
INSERT INTO "user" ("id", "username", "role") VALUES (0, '#deleted', 'user');

UPDATE "config" SET "value" = '3' WHERE "name" = 'db_version';

COMMIT;
