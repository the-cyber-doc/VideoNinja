-- Version 5 → 6: the comments on book annotations go (the feature was removed), with their
-- rows, their full-text index and its triggers. Catalogue entries can be proposed by users
-- ("Other" in the technique picker: proposed_by, proposed_at) until an admin validates them.
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

DROP TRIGGER "book_comment_fts_insert";
DROP TRIGGER "book_comment_fts_delete";
DROP TRIGGER "book_comment_fts_update";
DROP TABLE "book_comment_fts";
DROP TABLE "book_comment"; -- its indexes with it

-- Catalogue entries proposed by users ("Other"), until an admin validates them.
ALTER TABLE "ryu" ADD COLUMN "proposed_by" INTEGER;
ALTER TABLE "ryu" ADD COLUMN "proposed_at" DATETIME;
ALTER TABLE "category" ADD COLUMN "proposed_by" INTEGER;
ALTER TABLE "category" ADD COLUMN "proposed_at" DATETIME;
ALTER TABLE "weapon" ADD COLUMN "proposed_by" INTEGER;
ALTER TABLE "weapon" ADD COLUMN "proposed_at" DATETIME;
ALTER TABLE "section" ADD COLUMN "proposed_by" INTEGER;
ALTER TABLE "section" ADD COLUMN "proposed_at" DATETIME;
ALTER TABLE "technique" ADD COLUMN "proposed_by" INTEGER;
ALTER TABLE "technique" ADD COLUMN "proposed_at" DATETIME;

UPDATE "config" SET "value" = '6' WHERE "name" = 'db_version';

COMMIT;
