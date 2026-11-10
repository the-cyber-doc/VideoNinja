-- Version 4 → 5: the search's full text. The books' page text (book_page, sent by the
-- browser; book.text_pages: how many pages gave text, NULL until sent) and FTS5 indexes
-- over it, over the book annotations' quotes and notes, and over the techniques' comments,
-- kept in step by triggers (filled here from the existing rows). The comments on book
-- annotations go (the feature was removed), with their rows. The year tag gets its bounds
-- (1950–2080) when an admin gave it none and every stored year fits.
-- Run by the app at startup (app/db.py: migrate), after a backup of the database.

BEGIN;

DROP TABLE "book_comment"; -- its indexes with it

ALTER TABLE "book" ADD COLUMN "text_pages" INTEGER;

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


INSERT INTO "book_annotation_fts" ("book_annotation_fts") VALUES ('rebuild');
INSERT INTO "comment_fts" ("comment_fts") VALUES ('rebuild');

UPDATE "tag" SET "min_value" = 1950, "max_value" = 2080
WHERE "id" = 'year' AND "value_format" = 'regexp' AND "min_value" IS NULL AND "max_value" IS NULL
	AND NOT EXISTS (
		SELECT 1 FROM (
			SELECT "value" FROM "video_has_tags" WHERE "tag" = 'year'
			UNION ALL SELECT "value" FROM "segment_has_tags" WHERE "tag" = 'year'
			UNION ALL SELECT "value" FROM "book_has_tags" WHERE "tag" = 'year'
		) WHERE CAST("value" AS INTEGER) NOT BETWEEN 1950 AND 2080
	);

UPDATE "config" SET "value" = '5' WHERE "name" = 'db_version';

COMMIT;
