-- Initial data for db_v1.sql. Run once on an empty database, after the schema.

PRAGMA foreign_keys = ON;

BEGIN;

INSERT INTO "config" ("name", "type", "value") VALUES
	('db_version', 'int', '1');

-- Before the tables that point to it (foreign keys are checked immediately).
INSERT INTO "translation" ("id", "en", "fr") VALUES
	('access.user_mgmt.name', 'User Management', 'Gestion des utilisateurs'),
	('access.segment.name', 'Segment', 'Segment'),
	('role.admin.name', 'Admin', 'Administrateur'),
	('role.user.name', 'User', 'Utilisateur'),
	('ryu.togakure.description', 'School of the Hidden Door', 'École de la porte cachée'),
	('ryu.gyokko.description', 'The Jeweled Tiger School', 'L''école du tigre de jade'),
	('ryu.kukishinden.description', 'The Nine Demon Gods School', 'L''école des neuf dieux démons'),
	('ryu.koto.description', 'The Tiger Knockdown School', 'L''école du tigre renversé'),
	('ryu.shinden.description', 'The Immovable Heart School', 'L''école du cœur inébranlable'),
	('ryu.takagi.description', 'The High Tree, Raised Heart School', 'L''école du grand arbre et du cœur élevé'),
	('ryu.gikan.description', 'The Truth, Loyalty and Justice School', 'L''école de la vérité, de la loyauté et de la justice'),
	('ryu.gyokushin.description', 'The Jeweled Heart School', 'L''école du cœur de jade'),
	('ryu.kumogakure.description', 'The Hidden Cloud School', 'L''école du nuage caché'),
	('level.shoden.description', 'The initial transmission', 'La transmission initiale'),
	('level.chuden.description', 'The intermediate transmission', 'La transmission intermédiaire'),
	('level.okuden.description', 'The deep transmission', 'La transmission profonde');

INSERT INTO "access" ("id", "name") VALUES
	('user_mgmt', 'access.user_mgmt.name'),
	('segment', 'access.segment.name');

INSERT INTO "role" ("id", "name") VALUES
	('admin', 'role.admin.name'),
	('user', 'role.user.name');

INSERT INTO "role_has_access" ("role", "access") VALUES
	('admin', 'user_mgmt'),
	('admin', 'segment'),
	('user', 'segment');

-- The admin user is created by the first-start setup wizard.

INSERT INTO "ryu" ("id", "kanji", "romaji", "description") VALUES
	('togakure', '戸隠流', 'Togakure Ryu', 'ryu.togakure.description'),
	('gyokko', '玉虎流', 'Gyokko Ryu', 'ryu.gyokko.description'),
	('kukishinden', '九鬼神伝流', 'Kukishinden Ryu', 'ryu.kukishinden.description'),
	('koto', '虎倒流', 'Koto Ryu', 'ryu.koto.description'),
	('shinden', '神伝不動流', 'Shinden Fudo Ryu', 'ryu.shinden.description'),
	('takagi', '高木揚心流', 'Takagi Yoshin Ryu', 'ryu.takagi.description'),
	('gikan', '義鑑流', 'Gikan Ryu', 'ryu.gikan.description'),
	('gyokushin', '玉心流', 'Gyokushin Ryu', 'ryu.gyokushin.description'),
	('kumogakure', '雲隠流', 'Kumogakure Ryu', 'ryu.kumogakure.description');

INSERT INTO "level" ("id", "kanji", "romaji", "description") VALUES
	('shoden', '初伝', 'Shoden', 'level.shoden.description'),
	('chuden', '中伝', 'Chuden', 'level.chuden.description'),
	('okuden', '奥伝', 'Okuden', 'level.okuden.description');

-- Gyokko ryu, Jo Ryaku no Maki (first level) -> shoden
INSERT INTO "technique" ("id", "kanji", "romaji", "ryu", "level") VALUES
	('gyokko.koku', '虚空', 'Koku', 'gyokko', 'shoden'),
	('gyokko.keto', '闕倒', 'Keto', 'gyokko', 'shoden'),
	('gyokko.hanebi', '跳火', 'Hanebi', 'gyokko', 'shoden');

COMMIT;
