-- Version 6 → 5: the comments on book annotations come back, empty (version 6 has none),
-- with their full-text index and its triggers. Proposed catalogue entries stay, as ordinary
-- ones (version 5 has no proposals).
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

ALTER TABLE "ryu" DROP COLUMN "proposed_by";
ALTER TABLE "ryu" DROP COLUMN "proposed_at";
ALTER TABLE "category" DROP COLUMN "proposed_by";
ALTER TABLE "category" DROP COLUMN "proposed_at";
ALTER TABLE "weapon" DROP COLUMN "proposed_by";
ALTER TABLE "weapon" DROP COLUMN "proposed_at";
ALTER TABLE "section" DROP COLUMN "proposed_by";
ALTER TABLE "section" DROP COLUMN "proposed_at";
ALTER TABLE "technique" DROP COLUMN "proposed_by";
ALTER TABLE "technique" DROP COLUMN "proposed_at";

-- Comments on an annotation: the same rules as the techniques' (comment).
CREATE TABLE IF NOT EXISTS "book_comment" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"annotation" INTEGER NOT NULL,
	"user" INTEGER NOT NULL,
	"lang" TEXT NOT NULL,
	"text" TEXT NOT NULL,
	"created_at" DATETIME NOT NULL,
	"modified_at" DATETIME NOT NULL,
	FOREIGN KEY ("annotation") REFERENCES "book_annotation"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE,
	FOREIGN KEY ("user") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);
CREATE INDEX IF NOT EXISTS "book_comment_annotation" ON "book_comment" ("annotation");
CREATE INDEX IF NOT EXISTS "book_comment_user" ON "book_comment" ("user");

CREATE VIRTUAL TABLE IF NOT EXISTS "book_comment_fts" USING fts5(
	"text", content = 'book_comment', content_rowid = 'id', tokenize = 'trigram remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS "book_comment_fts_insert" AFTER INSERT ON "book_comment" BEGIN
	INSERT INTO "book_comment_fts" ("rowid", "text") VALUES (new."id", new."text");
END;
CREATE TRIGGER IF NOT EXISTS "book_comment_fts_delete" AFTER DELETE ON "book_comment" BEGIN
	INSERT INTO "book_comment_fts" ("book_comment_fts", "rowid", "text") VALUES ('delete', old."id", old."text");
END;
CREATE TRIGGER IF NOT EXISTS "book_comment_fts_update" AFTER UPDATE OF "text" ON "book_comment" BEGIN
	INSERT INTO "book_comment_fts" ("book_comment_fts", "rowid", "text") VALUES ('delete', old."id", old."text");
	INSERT INTO "book_comment_fts" ("rowid", "text") VALUES (new."id", new."text");
END;

UPDATE "config" SET "value" = '5' WHERE "name" = 'db_version';

COMMIT;
