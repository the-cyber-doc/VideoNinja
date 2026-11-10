-- Version 5 → 4: the search's full text goes (indexes, triggers, the books' page text:
-- the browser sends it again after a migration up). The comments on book annotations
-- come back, empty (version 5 has none). The year tag's bounds stay: version 4
-- has them (an admin may have set them there).
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

DROP TRIGGER "book_page_fts_insert";
DROP TRIGGER "book_page_fts_delete";
DROP TRIGGER "book_page_fts_update";
DROP TRIGGER "book_annotation_fts_insert";
DROP TRIGGER "book_annotation_fts_delete";
DROP TRIGGER "book_annotation_fts_update";
DROP TRIGGER "comment_fts_insert";
DROP TRIGGER "comment_fts_delete";
DROP TRIGGER "comment_fts_update";
DROP TABLE "book_page_fts";
DROP TABLE "book_annotation_fts";
DROP TABLE "comment_fts";
DROP TABLE "book_page";

ALTER TABLE "book" DROP COLUMN "text_pages";

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

UPDATE "config" SET "value" = '4' WHERE "name" = 'db_version';

COMMIT;
