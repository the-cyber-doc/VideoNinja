-- Version 3 → 4: books (PDF) with their annotations and the comments on them; the
-- "book_mgmt" access (Books page, book uploads), given to the admin role and to two new
-- roles: book_mgmt (segment, comment, annotate, upload, book_mgmt) and content_mgmt (the
-- same + video_mgmt); uploads say what they hold (upload.kind: video, book or image).
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

ALTER TABLE "upload" ADD COLUMN "kind" VARCHAR NOT NULL DEFAULT 'video'
	CHECK ("kind" IN ('video', 'book', 'image'));

-- Books (PDF), uploaded through tusd like videos and published by the encoder, which
-- checks the file and moves it to book/<h2>/<sha256>/book.pdf. Never rewritten: the
-- annotations are rows (book_annotation), written into the copy a user downloads.
-- "reference": one CSL-JSON item (type, title, author…), shown in Chicago style.
-- "thumbnail": the first page, a JPEG made by the browser (thumbnail_upload until the
-- encoder published it).
CREATE TABLE IF NOT EXISTS "book" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"sha256sum" TEXT NOT NULL UNIQUE,
	"original_filename" VARCHAR NOT NULL,
	"directory" VARCHAR,
	"thumbnail" VARCHAR,
	"pages" INTEGER,
	"reference" TEXT NOT NULL,
	"uploaded_by" INTEGER,
	"uploaded_at" DATETIME NOT NULL,
	"status" VARCHAR NOT NULL DEFAULT 'queued'
		CHECK ("status" IN ('queued', 'published', 'failed')),
	"error" TEXT,
	"attempts" INTEGER NOT NULL DEFAULT 0,
	"upload" VARCHAR,
	"thumbnail_upload" VARCHAR,
	FOREIGN KEY ("uploaded_by") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "book_has_tags" (
	"book" INTEGER NOT NULL,
	"tag" VARCHAR NOT NULL,
	"value" VARCHAR,
	PRIMARY KEY("book", "tag"),
	FOREIGN KEY ("book") REFERENCES "book"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE,
	FOREIGN KEY ("tag") REFERENCES "tag"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- An annotation of a book's page: a text highlight ("quote" = the selected text) or a
-- region (scanned pages; "image" = its crop, a JPEG made by the browser, image_upload
-- until published). "target": the PDF annotation itself (JSON: subtype, rects in PDF
-- points, colour…), what the viewer shows and the downloaded copy gets. "technique":
-- shown on that technique's page.
CREATE TABLE IF NOT EXISTS "book_annotation" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"book" INTEGER NOT NULL,
	"page" INTEGER NOT NULL CHECK ("page" >= 1),
	"kind" VARCHAR NOT NULL CHECK ("kind" IN ('text', 'region')),
	"target" TEXT NOT NULL,
	"quote" TEXT,
	"color" VARCHAR,
	"note" TEXT,
	"technique" VARCHAR,
	"image" VARCHAR,
	"image_upload" VARCHAR,
	"created_by" INTEGER,
	"created_at" DATETIME NOT NULL,
	"modified_at" DATETIME NOT NULL,
	FOREIGN KEY ("book") REFERENCES "book"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE,
	FOREIGN KEY ("technique") REFERENCES "technique"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("created_by") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE SET NULL
);

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

CREATE INDEX IF NOT EXISTS "book_status" ON "book" ("status");
CREATE INDEX IF NOT EXISTS "book_uploaded_by" ON "book" ("uploaded_by");
CREATE INDEX IF NOT EXISTS "book_upload" ON "book" ("upload");
CREATE INDEX IF NOT EXISTS "book_has_tags_tag" ON "book_has_tags" ("tag");
CREATE INDEX IF NOT EXISTS "book_annotation_book" ON "book_annotation" ("book");
CREATE INDEX IF NOT EXISTS "book_annotation_technique" ON "book_annotation" ("technique");
CREATE INDEX IF NOT EXISTS "book_annotation_created_by" ON "book_annotation" ("created_by");
CREATE INDEX IF NOT EXISTS "book_comment_annotation" ON "book_comment" ("annotation");
CREATE INDEX IF NOT EXISTS "book_comment_user" ON "book_comment" ("user");

INSERT INTO "translation" ("id", "en", "fr") VALUES
	('access.book_mgmt.name', 'Book management', 'Gestion des livres'),
	('role.book_mgmt.name', 'Book manager', 'Gestionnaire de livres'),
	('role.content_mgmt.name', 'Content manager', 'Gestionnaire de contenu');
INSERT INTO "access" ("id", "name") VALUES
	('book_mgmt', 'access.book_mgmt.name');
INSERT INTO "role" ("id", "name") VALUES
	('book_mgmt', 'role.book_mgmt.name'),
	('content_mgmt', 'role.content_mgmt.name');
INSERT INTO "role_has_access" ("role", "access") VALUES
	('admin', 'book_mgmt'),
	('book_mgmt', 'segment'),
	('book_mgmt', 'comment'),
	('book_mgmt', 'annotate'),
	('book_mgmt', 'upload'),
	('book_mgmt', 'book_mgmt'),
	('content_mgmt', 'segment'),
	('content_mgmt', 'comment'),
	('content_mgmt', 'annotate'),
	('content_mgmt', 'upload'),
	('content_mgmt', 'book_mgmt'),
	('content_mgmt', 'video_mgmt');

UPDATE "config" SET "value" = '4' WHERE "name" = 'db_version';

COMMIT;
