-- Schema version 5 (config.db_version). From version 4: migrations/v4_to_v5.sql.
-- Text is UTF-8. Dates (…_at): ISO 8601 text with the UTC offset, in the user's
-- timezone, "2026-10-23T12:13:38+02:00" (app/clock.py). Offsets differ: compare
-- and sort them through datetime(), never as plain text.
PRAGMA encoding = 'UTF-8';

CREATE TABLE IF NOT EXISTS "config" (
	"name" VARCHAR NOT NULL UNIQUE,
	"type" VARCHAR NOT NULL,
	"value" VARCHAR NOT NULL,
	PRIMARY KEY("name")
);

-- Liveness of the services in other containers (the encoder), for /health.
CREATE TABLE IF NOT EXISTS "heartbeat" (
	"name" VARCHAR NOT NULL PRIMARY KEY,
	"at" DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS "ryu" (
	"id" VARCHAR NOT NULL UNIQUE,
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"description" VARCHAR,
	-- Proposed by a user ("Other" in the technique picker) until an admin validates it
	-- (the Options page): both NULL once validated (the seed's rows: always).
	"proposed_by" INTEGER,
	"proposed_at" DATETIME,
	PRIMARY KEY("id"),
	FOREIGN KEY ("description") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- The catalogue: school (ryu) → category → (weapon, only under Buki) → section
-- (a school's scroll or group, e.g. Jo Ryaku no Maki) → technique. Fixed: each
-- school's organisation is known; the seed lists sections and techniques in
-- their traditional order (rowid order).
CREATE TABLE IF NOT EXISTS "category" (
	"id" VARCHAR NOT NULL UNIQUE,
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"description" VARCHAR,
	-- Proposed by a user ("Other" in the technique picker) until an admin validates it
	-- (the Options page): both NULL once validated (the seed's rows: always).
	"proposed_by" INTEGER,
	"proposed_at" DATETIME,
	PRIMARY KEY("id"),
	FOREIGN KEY ("description") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "weapon" (
	"id" VARCHAR NOT NULL UNIQUE,
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"description" VARCHAR,
	-- Proposed by a user ("Other" in the technique picker) until an admin validates it
	-- (the Options page): both NULL once validated (the seed's rows: always).
	"proposed_by" INTEGER,
	"proposed_at" DATETIME,
	PRIMARY KEY("id"),
	FOREIGN KEY ("description") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "section" (
	"id" VARCHAR NOT NULL UNIQUE,
	"ryu" VARCHAR NOT NULL,
	"category" VARCHAR NOT NULL,
	-- Only (and always) under the weapons category.
	"weapon" VARCHAR CHECK (("category" = 'buki') = ("weapon" IS NOT NULL)),
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"description" VARCHAR,
	-- Proposed by a user ("Other" in the technique picker) until an admin validates it
	-- (the Options page): both NULL once validated (the seed's rows: always).
	"proposed_by" INTEGER,
	"proposed_at" DATETIME,
	PRIMARY KEY("id"),
	FOREIGN KEY ("ryu") REFERENCES "ryu"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("category") REFERENCES "category"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("weapon") REFERENCES "weapon"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("description") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "technique" (
	"id" VARCHAR NOT NULL UNIQUE,
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"section" VARCHAR NOT NULL,
	"description" VARCHAR,
	-- Proposed by a user ("Other" in the technique picker) until an admin validates it
	-- (the Options page): both NULL once validated (the seed's rows: always).
	"proposed_by" INTEGER,
	"proposed_at" DATETIME,
	PRIMARY KEY("id"),
	FOREIGN KEY ("section") REFERENCES "section"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("description") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- Uploaded by the browser, encoded by the worker, published asynchronously.
-- Until published: sha256sum and directory are NULL, the original waits in the
-- upload folder (upload = its tus ID). Only published videos are in the catalogue.
CREATE TABLE IF NOT EXISTS "video" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"sha256sum" TEXT UNIQUE,
	"original_sha256" TEXT NOT NULL UNIQUE,
	"original_filename" VARCHAR NOT NULL,
	"directory" VARCHAR,
	"thumbnail" VARCHAR,
	"duration_s" REAL,
	"all_segments_done" BOOLEAN NOT NULL DEFAULT 0,
	"uploaded_by" INTEGER,
	"uploaded_at" DATETIME NOT NULL,
	"status" VARCHAR NOT NULL DEFAULT 'queued'
		CHECK ("status" IN ('queued', 'encoding', 'published', 'failed')),
	"progress" INTEGER NOT NULL DEFAULT 0,
	"error" TEXT,
	"attempts" INTEGER NOT NULL DEFAULT 0,
	"upload" VARCHAR,
	-- Changes of its segments on the Videos page not yet seen by the encoder, which makes
	-- their thumbnails and deletes the old ones (a counter: a change during its work is not lost).
	"thumbs_dirty" INTEGER NOT NULL DEFAULT 0,
	FOREIGN KEY ("uploaded_by") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "segment" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"video" INTEGER NOT NULL,
	"technique" VARCHAR NOT NULL,
	"begin_s" INTEGER NOT NULL,
	"end_s" INTEGER NOT NULL,
	"performer" VARCHAR NOT NULL,
	"thumbnail" VARCHAR,
	"created_by" INTEGER,
	FOREIGN KEY ("video") REFERENCES "video"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("technique") REFERENCES "technique"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("performer") REFERENCES "performer"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("created_by") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "comment" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"technique" VARCHAR NOT NULL,
	"user" INTEGER NOT NULL,
	"lang" TEXT NOT NULL,
	"text" TEXT NOT NULL,
	"created_at" DATETIME NOT NULL,
	"modified_at" DATETIME NOT NULL,
	FOREIGN KEY ("technique") REFERENCES "technique"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("user") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

-- What a tag's value is (video_has_tags / segment_has_tags "value"), by value_format:
-- 'list' = the id of one of its tag_value rows; 'regexp' = text fully matching "regexp";
-- 'free' = any text (not empty); NULL = no value (stored NULL). Text values are stored as
-- typed, not translated. For 'regexp' and 'free': "hint" (a translation, shown as the
-- placeholder and in errors), "input_mode" (the keyboard: text or numeric) and, numeric
-- only, "min_value" / "max_value" (bounds of the number, checked too). The app keeps the
-- fields of the other formats empty. Edited on the Options page (api/options.py).
CREATE TABLE IF NOT EXISTS "tag" (
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

-- Shown sorted by name, in the user's language.
CREATE TABLE IF NOT EXISTS "tag_value" (
	"tag" VARCHAR NOT NULL,
	"id" VARCHAR NOT NULL,
	"name" VARCHAR NOT NULL,
	PRIMARY KEY("tag", "id"),
	FOREIGN KEY ("tag") REFERENCES "tag"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("name") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "video_has_tags" (
	"video" INTEGER NOT NULL,
	"tag" VARCHAR NOT NULL,
	"value" VARCHAR,
	PRIMARY KEY("video", "tag"),
	FOREIGN KEY ("video") REFERENCES "video"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("tag") REFERENCES "tag"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "segment_has_tags" (
	"segment" INTEGER NOT NULL,
	"tag" VARCHAR NOT NULL,
	"value" VARCHAR,
	PRIMARY KEY("segment", "tag"),
	FOREIGN KEY ("segment") REFERENCES "segment"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("tag") REFERENCES "tag"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "user" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"username" VARCHAR NOT NULL UNIQUE,
	"name" VARCHAR,
	"pw_hash" VARCHAR,
	"totp" VARCHAR,
	"role" VARCHAR NOT NULL,
	"time_zone" VARCHAR,
	FOREIGN KEY ("role") REFERENCES "role"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "role" (
	"id" VARCHAR NOT NULL UNIQUE,
	"name" VARCHAR NOT NULL,
	PRIMARY KEY("id"),
	FOREIGN KEY ("name") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "access" (
	"id" VARCHAR NOT NULL UNIQUE,
	"name" VARCHAR NOT NULL,
	PRIMARY KEY("id"),
	FOREIGN KEY ("name") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "role_has_access" (
	"role" VARCHAR NOT NULL,
	"access" VARCHAR NOT NULL,
	PRIMARY KEY("role", "access"),
	FOREIGN KEY ("role") REFERENCES "role"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION,
	FOREIGN KEY ("access") REFERENCES "access"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "performer" (
	"id" VARCHAR NOT NULL,
	"name" VARCHAR NOT NULL,
	PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "translation" (
	"id" VARCHAR NOT NULL UNIQUE,
	"en" TEXT NOT NULL,
	"fr" TEXT,
	PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "session" (
	"id" VARCHAR NOT NULL UNIQUE,
	"user" INTEGER NOT NULL,
	"created_at" DATETIME NOT NULL,
	"last_seen_at" DATETIME NOT NULL,
	"expires_at" DATETIME NOT NULL,
	PRIMARY KEY("id"),
	FOREIGN KEY ("user") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE
);

-- tus uploads (tusd), from creation until the worker deleted the original.
-- state: uploading, finished (complete, waiting for submit or encoding),
-- deleted (the worker must remove its files).
CREATE TABLE IF NOT EXISTS "upload" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"tus_id" VARCHAR NOT NULL UNIQUE,
	"user" INTEGER NOT NULL,
	"original_sha256" TEXT NOT NULL,
	"size" INTEGER NOT NULL,
	"state" VARCHAR NOT NULL DEFAULT 'uploading'
		CHECK ("state" IN ('uploading', 'finished', 'deleted')),
	"created_at" DATETIME NOT NULL,
	-- What the file is: a video (encoded), a book (PDF) or an image the browser made
	-- (a book's thumbnail, an annotation's crop: re-encoded by the encoder).
	"kind" VARCHAR NOT NULL DEFAULT 'video' CHECK ("kind" IN ('video', 'book', 'image')),
	FOREIGN KEY ("user") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS "invite" (
	"user" INTEGER NOT NULL UNIQUE,
	"token_hash" VARCHAR NOT NULL UNIQUE,
	"token" VARCHAR NOT NULL,
	"expires_at" DATETIME NOT NULL,
	PRIMARY KEY("user"),
	FOREIGN KEY ("user") REFERENCES "user"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE
);

-- Books (PDF), uploaded through tusd like videos and published by the encoder, which
-- checks the file and moves it to book/<h2>/<sha256>/book.pdf. Never rewritten: the
-- annotations are rows (book_annotation), written into the copy a user downloads.
-- "reference": one CSL-JSON item (type, title, author…), shown in Chicago style.
-- "thumbnail": the first page, a JPEG made by the browser (thumbnail_upload until the
-- encoder published it). "text_pages": how many pages gave text (book_page), once the
-- browser sent all of them; NULL: not yet (the viewer sends them then; 0: a scanned book).
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
	"text_pages" INTEGER,
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

-- Indexes: the columns the app looks rows up by, on the tables that grow (videos,
-- segments, comments, users, sessions, uploads, books and their annotations), foreign keys included (SQLite does not
-- index them: without, deleting a video or a user scans every segment, comment and
-- session). The catalogue and translation tables are small, fixed, written only by
-- the setup and migrations: no index beyond their keys.
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
CREATE INDEX IF NOT EXISTS "book_status" ON "book" ("status");
CREATE INDEX IF NOT EXISTS "book_uploaded_by" ON "book" ("uploaded_by");
CREATE INDEX IF NOT EXISTS "book_upload" ON "book" ("upload");
CREATE INDEX IF NOT EXISTS "book_has_tags_tag" ON "book_has_tags" ("tag");
CREATE INDEX IF NOT EXISTS "book_annotation_book" ON "book_annotation" ("book");
CREATE INDEX IF NOT EXISTS "book_annotation_technique" ON "book_annotation" ("technique");
CREATE INDEX IF NOT EXISTS "book_annotation_created_by" ON "book_annotation" ("created_by");

-- The text of each page of a book (pages without text: no row), extracted by the browser
-- (the server has no PDF parser), for the search.
CREATE TABLE IF NOT EXISTS "book_page" (
	"id" INTEGER PRIMARY KEY AUTOINCREMENT,
	"book" INTEGER NOT NULL,
	"page" INTEGER NOT NULL CHECK ("page" >= 1),
	"text" TEXT NOT NULL,
	UNIQUE ("book", "page"),
	FOREIGN KEY ("book") REFERENCES "book"("id")
	ON UPDATE NO ACTION ON DELETE CASCADE
);
-- UNIQUE ("book", "page") is the index of its foreign key (book first).

-- Full-text search (FTS5), over the books' pages, the book annotations' quotes and notes,
-- and the techniques' comments. Trigram tokenizer: any part of a word
-- matches, in any script (Japanese has no spaces), accents and case ignored; terms of
-- fewer than 3 characters are looked up with LIKE instead (app/domain/search.py).
-- External content: the rows stay in their tables, the triggers below keep each index
-- in step with every insert, update and delete (cascades included), whoever writes.
CREATE VIRTUAL TABLE IF NOT EXISTS "book_page_fts" USING fts5(
	"text", content = 'book_page', content_rowid = 'id', tokenize = 'trigram remove_diacritics 1'
);
CREATE VIRTUAL TABLE IF NOT EXISTS "book_annotation_fts" USING fts5(
	"quote", "note", content = 'book_annotation', content_rowid = 'id', tokenize = 'trigram remove_diacritics 1'
);
CREATE VIRTUAL TABLE IF NOT EXISTS "comment_fts" USING fts5(
	"text", content = 'comment', content_rowid = 'id', tokenize = 'trigram remove_diacritics 1'
);

CREATE TRIGGER IF NOT EXISTS "book_page_fts_insert" AFTER INSERT ON "book_page" BEGIN
	INSERT INTO "book_page_fts" ("rowid", "text") VALUES (new."id", new."text");
END;
CREATE TRIGGER IF NOT EXISTS "book_page_fts_delete" AFTER DELETE ON "book_page" BEGIN
	INSERT INTO "book_page_fts" ("book_page_fts", "rowid", "text") VALUES ('delete', old."id", old."text");
END;
CREATE TRIGGER IF NOT EXISTS "book_page_fts_update" AFTER UPDATE OF "text" ON "book_page" BEGIN
	INSERT INTO "book_page_fts" ("book_page_fts", "rowid", "text") VALUES ('delete', old."id", old."text");
	INSERT INTO "book_page_fts" ("rowid", "text") VALUES (new."id", new."text");
END;

CREATE TRIGGER IF NOT EXISTS "book_annotation_fts_insert" AFTER INSERT ON "book_annotation" BEGIN
	INSERT INTO "book_annotation_fts" ("rowid", "quote", "note") VALUES (new."id", new."quote", new."note");
END;
CREATE TRIGGER IF NOT EXISTS "book_annotation_fts_delete" AFTER DELETE ON "book_annotation" BEGIN
	INSERT INTO "book_annotation_fts" ("book_annotation_fts", "rowid", "quote", "note")
	VALUES ('delete', old."id", old."quote", old."note");
END;
CREATE TRIGGER IF NOT EXISTS "book_annotation_fts_update" AFTER UPDATE OF "quote", "note" ON "book_annotation" BEGIN
	INSERT INTO "book_annotation_fts" ("book_annotation_fts", "rowid", "quote", "note")
	VALUES ('delete', old."id", old."quote", old."note");
	INSERT INTO "book_annotation_fts" ("rowid", "quote", "note") VALUES (new."id", new."quote", new."note");
END;

CREATE TRIGGER IF NOT EXISTS "comment_fts_insert" AFTER INSERT ON "comment" BEGIN
	INSERT INTO "comment_fts" ("rowid", "text") VALUES (new."id", new."text");
END;
CREATE TRIGGER IF NOT EXISTS "comment_fts_delete" AFTER DELETE ON "comment" BEGIN
	INSERT INTO "comment_fts" ("comment_fts", "rowid", "text") VALUES ('delete', old."id", old."text");
END;
CREATE TRIGGER IF NOT EXISTS "comment_fts_update" AFTER UPDATE OF "text" ON "comment" BEGIN
	INSERT INTO "comment_fts" ("comment_fts", "rowid", "text") VALUES ('delete', old."id", old."text");
	INSERT INTO "comment_fts" ("rowid", "text") VALUES (new."id", new."text");
END;

