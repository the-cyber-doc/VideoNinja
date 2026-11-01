-- Version 2 → 3: indexes on the columns the app looks rows up by (see db_v3.sql), and the
-- "moderator" access (edit and delete anyone's comments), given to the admin role, and the
-- generic "deleted user" (id 0) that a deleted user's content is given to; tags with an
-- explicit format (list, regexp, free or no value) and their input hints, edited on the
-- Options page (the "options" access, given to the admin role).
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

-- The tag table is rebuilt (new CHECK constraints): foreign keys off meanwhile, as SQLite
-- asks (a PRAGMA has no effect inside a transaction).
PRAGMA foreign_keys = OFF;

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

INSERT INTO "translation" ("id", "en", "fr") VALUES
	('access.options.name', 'Options', 'Options');
INSERT INTO "access" ("id", "name") VALUES
	('options', 'access.options.name');
INSERT INTO "role_has_access" ("role", "access") VALUES
	('admin', 'options');

-- Formats: fixed values → 'list'; 'year' → its regexp, hint and numeric keyboard; any other
-- (NULL: any text) → 'free'.
INSERT INTO "translation" ("id", "en", "fr")
	SELECT 'tag.' || "id" || '.hint', 'A year, e.g. 2024', 'Une année, par ex. 2024'
	FROM "tag" WHERE "value_format" = 'year';
CREATE TABLE "tag_v3" (
	"id" VARCHAR NOT NULL UNIQUE,
	"name" VARCHAR NOT NULL,
	"value_format" VARCHAR CHECK ("value_format" IN ('list', 'regexp', 'free')),
	"regexp" VARCHAR,
	"hint" VARCHAR,
	"input_mode" VARCHAR NOT NULL DEFAULT 'text' CHECK ("input_mode" IN ('text', 'numeric')),
	"min_value" INTEGER,
	"max_value" INTEGER,
	PRIMARY KEY("id"),
	CHECK (("value_format" IS 'regexp') = ("regexp" IS NOT NULL)),
	CHECK ("min_value" IS NULL OR "max_value" IS NULL OR "min_value" <= "max_value"),
	FOREIGN KEY ("name") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("hint") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);
INSERT INTO "tag_v3" ("id", "name", "value_format", "regexp", "hint", "input_mode")
	SELECT g."id", g."name",
		CASE
			WHEN g."value_format" = 'year' THEN 'regexp'
			WHEN EXISTS (SELECT 1 FROM "tag_value" v WHERE v."tag" = g."id") THEN 'list'
			ELSE 'free'
		END,
		CASE WHEN g."value_format" = 'year' THEN '[12][0-9]{3}' END,
		CASE WHEN g."value_format" = 'year' THEN 'tag.' || g."id" || '.hint' END,
		CASE WHEN g."value_format" = 'year' THEN 'numeric' ELSE 'text' END
	FROM "tag" g;
DROP TABLE "tag";
ALTER TABLE "tag_v3" RENAME TO "tag";

UPDATE "config" SET "value" = '3' WHERE "name" = 'db_version';

COMMIT;

PRAGMA foreign_keys = ON;
