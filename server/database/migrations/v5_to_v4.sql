-- Version 5 → 4: the search's full text goes (indexes, triggers, the books' page text:
-- the browser sends it again after a migration up). The year tag's bounds stay: version 4
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
DROP TRIGGER "book_comment_fts_insert";
DROP TRIGGER "book_comment_fts_delete";
DROP TRIGGER "book_comment_fts_update";
DROP TABLE "book_page_fts";
DROP TABLE "book_annotation_fts";
DROP TABLE "comment_fts";
DROP TABLE "book_comment_fts";
DROP TABLE "book_page";

ALTER TABLE "book" DROP COLUMN "text_pages";

UPDATE "config" SET "value" = '4' WHERE "name" = 'db_version';

COMMIT;
