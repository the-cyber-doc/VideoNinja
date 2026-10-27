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

CREATE TABLE IF NOT EXISTS "ryu" (
	"id" VARCHAR NOT NULL UNIQUE,
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"description" VARCHAR,
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
	PRIMARY KEY("id"),
	FOREIGN KEY ("description") REFERENCES "translation"("id")
	ON UPDATE NO ACTION ON DELETE NO ACTION
);

CREATE TABLE IF NOT EXISTS "weapon" (
	"id" VARCHAR NOT NULL UNIQUE,
	"kanji" VARCHAR NOT NULL,
	"romaji" VARCHAR NOT NULL,
	"description" VARCHAR,
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

-- A tag with rows in tag_value takes one of them (video_has_tags / segment_has_tags
-- store the value's id); without, text (stored as typed, not translated) in its
-- value_format: NULL = any text, 'year' = a year, at most 100 years ago, not in the future.
CREATE TABLE IF NOT EXISTS "tag" (
	"id" VARCHAR NOT NULL UNIQUE,
	"name" VARCHAR NOT NULL,
	"value_format" VARCHAR,
	PRIMARY KEY("id"),
	FOREIGN KEY ("name") REFERENCES "translation"("id")
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
