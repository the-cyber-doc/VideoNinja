-- Version 4 → 3: back to the release before books. The books, their annotations and
-- comments are DELETED (version 3 has no place for them; the PDFs stay in the media
-- folder, and the backup made before the migration up keeps the rows). Users of the
-- book_mgmt and content_mgmt roles get the closest version 3 role: uploader and
-- video_mgmt. Book and image uploads are marked deleted (the encoder of version 3 then
-- removes their files).
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

UPDATE "user" SET "role" = 'uploader' WHERE "role" = 'book_mgmt';
UPDATE "user" SET "role" = 'video_mgmt' WHERE "role" = 'content_mgmt';
DELETE FROM "role_has_access" WHERE "access" = 'book_mgmt' OR "role" IN ('book_mgmt', 'content_mgmt');
DELETE FROM "role" WHERE "id" IN ('book_mgmt', 'content_mgmt');
DELETE FROM "access" WHERE "id" = 'book_mgmt';
DELETE FROM "translation" WHERE "id" IN ('access.book_mgmt.name', 'role.book_mgmt.name', 'role.content_mgmt.name');

DROP TABLE "book_comment";
DROP TABLE "book_annotation";
DROP TABLE "book_has_tags";
DROP TABLE "book";

UPDATE "upload" SET "state" = 'deleted' WHERE "kind" <> 'video';
ALTER TABLE "upload" DROP COLUMN "kind";

UPDATE "config" SET "value" = '3' WHERE "name" = 'db_version';

COMMIT;
