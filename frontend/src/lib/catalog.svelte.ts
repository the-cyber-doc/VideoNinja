// The catalogue (schools, categories, weapons, sections, techniques, segments), kept in memory per language
// and checked again in the background when a page uses it (at most every 30 s;
// usually a 304), so new segments show without reloading the app.
// Same shape and IDs as the server's snapshot: nulls omitted, names stored once.
import { getCatalog } from './api/catalog';
import type { CreatedEntry } from './api/types';
import { url } from './base';
import { i18n, t, type Lang } from './i18n.svelte';
import { onCatalogUpdated } from './pwa';

export interface School {
	id: string;
	kanji: string;
	romaji: string;
	description?: string;
	/** A user's ("Other" in the technique picker), not validated yet: "?" for its emblem. */
	proposed?: true;
}

/** Taijutsu, Muto Dori, Buki (weapons). */
export interface Category {
	id: string;
	kanji: string;
	romaji: string;
	description?: string;
	/** A user's ("Other" in the technique picker), not validated yet: "?" for its emblem. */
	proposed?: true;
}

export interface Weapon {
	id: string;
	kanji: string;
	romaji: string;
	description?: string;
	/** A user's ("Other" in the technique picker), not validated yet: "?" for its emblem. */
	proposed?: true;
}

/** A school's scroll or group (e.g. Jo Ryaku no Maki), in a category; under Buki, of a weapon.
 * ID: <ryu>.<category>[.<weapon>].<name>. */
export interface Section {
	id: string;
	kanji: string;
	romaji: string;
	ryu: string;
	category: string;
	weapon?: string;
	description?: string;
	/** A user's ("Other" in the technique picker), not validated yet: "?" for its emblem. */
	proposed?: true;
}

/** ID: <section ID>.<name>. */
export interface Technique {
	id: string;
	kanji: string;
	romaji: string;
	section: string;
	description?: string;
	/** A user's ("Other" in the technique picker), not validated yet: "?" for its emblem. */
	proposed?: true;
}

/** A part of a source video showing a technique; times in whole seconds. */
export interface Segment {
	id: number;
	video: number;
	technique: string;
	begin_s: number;
	end_s: number;
	performer: string;
	/** Its tags: a tag ID and, if it has one, the value (a list tag's value ID, else the text). */
	tags?: { id: string; value?: string }[];
}

/** Who performs segments (names are not translated). */
export interface Performer {
	id: string;
	name: string;
}

/** A tag, named in the catalogue's language; a list tag with its values. */
export interface CatalogTag {
	id: string;
	name: string;
	values?: { id: string; name: string }[];
}

export interface Catalog {
	schools: School[];
	categories: Category[];
	weapons: Weapon[];
	sections: Section[];
	techniques: Technique[];
	segments: Segment[];
	/** The segments' performers. */
	performers?: Performer[];
	/** Every tag (also those of videos and books, which are not in the catalogue). */
	tags?: CatalogTag[];
}

const loaded = new Map<Lang, Promise<Catalog>>();
const checkedAt = new Map<Lang, number>(); // last request to the server, per language
const REVALIDATE_MS = 30_000;
// Bumped when a newer catalogue arrived: pages using it show it.
const changes = $state({ count: 0 });

if (typeof window !== 'undefined') {
	onCatalogUpdated((lang) => {
		loaded.delete(lang as Lang);
		changes.count++;
	});
}

/** The catalogue in the current language (descriptions are translated by the server).
 * Reactive: called in a $derived, it runs again when the language or the catalogue changes. */
export function loadCatalog(): Promise<Catalog> {
	return loadCatalogIn(i18n.lang);
}

/** The catalogue in this language (the search reads every language's). Reactive as loadCatalog. */
export function loadCatalogIn(lang: Lang): Promise<Catalog> {
	void changes.count;
	let catalog = loaded.get(lang);
	if (!catalog) {
		checkedAt.set(lang, Date.now());
		catalog = getCatalog(lang);
		catalog.catch(() => loaded.delete(lang)); // retry on the next call
		loaded.set(lang, catalog);
	} else if (Date.now() - (checkedAt.get(lang) ?? 0) > REVALIDATE_MS) {
		revalidate(lang);
	}
	return catalog;
}

/** Ask the server again (now): e.g. one of my uploads was just published. */
export function refreshCatalog() {
	if (loaded.has(i18n.lang)) revalidate(i18n.lang);
}

/** The catalogue with entries a proposal just created (marked proposed), each where the
 * server's snapshot puts it: at the end of its list. */
export function withEntries(catalog: Catalog, created: CreatedEntry[]): Catalog {
	const out: Catalog = {
		...catalog,
		schools: [...catalog.schools],
		categories: [...catalog.categories],
		weapons: [...catalog.weapons],
		sections: [...catalog.sections],
		techniques: [...catalog.techniques]
	};
	for (const { kind, id, kanji, romaji, ryu, category, weapon, section } of created) {
		const named = { id, kanji, romaji, proposed: true as const };
		if (kind === 'school') out.schools.push(named);
		else if (kind === 'category') out.categories.push(named);
		else if (kind === 'weapon') out.weapons.push(named);
		else if (kind === 'section')
			out.sections.push({ ...named, ryu: ryu!, category: category!, ...(weapon ? { weapon } : {}) });
		else out.techniques.push({ ...named, section: section! });
	}
	return out;
}

/** A proposal's new entries, at once in every catalogue already loaded (the server's snapshot
 * follows a moment later): the pages using one show them. */
export async function addToCatalog(created: CreatedEntry[]) {
	if (!created.length) return;
	for (const [lang, catalog] of loaded) {
		const current = await catalog.catch(() => null);
		if (current) loaded.set(lang, Promise.resolve(withEntries(current, created)));
	}
	changes.count++;
}

/** Fetch in the background; replace the catalogue only if it changed. */
async function revalidate(lang: Lang) {
	checkedAt.set(lang, Date.now());
	try {
		const [fresh, current] = await Promise.all([getCatalog(lang), loaded.get(lang)]);
		if (JSON.stringify(fresh) !== JSON.stringify(current)) {
			loaded.set(lang, Promise.resolve(fresh));
			changes.count++;
		}
	} catch {
		// offline or server down: keep showing what we have
	}
}

// --- The path: school › category › (weapon, under Buki) › section › technique ---
// URLs and the annotation form use each step's own name; sections and techniques
// are found by their full ID, built from the path.

export const BUKI = 'buki';

/** A place in the catalogue, by each step's name (as in the URL). */
export interface CatalogPath {
	ryu: string;
	category?: string;
	weapon?: string;
	/** The section's name (last part of its ID). */
	section?: string;
	/** The technique's name (last part of its ID). */
	technique?: string;
}

/** The last part of a dotted ID: a section's or technique's name. */
export const lastPart = (id: string) => id.slice(id.lastIndexOf('.') + 1);

export const sectionId = (p: CatalogPath) =>
	[p.ryu, p.category, p.category === BUKI ? p.weapon : undefined, p.section].filter(Boolean).join('.');

export const techniqueId = (p: CatalogPath) => `${sectionId(p)}.${p.technique}`;

const unique = <T>(items: T[]) => [...new Set(items)];

export const findSchool = (catalog: Catalog, id: string) => catalog.schools.find((s) => s.id === id);

/** The categories a school has (in the categories' order). */
export function categoriesOf(catalog: Catalog, ryu: string): Category[] {
	const ids = new Set(catalog.sections.filter((s) => s.ryu === ryu).map((s) => s.category));
	return catalog.categories.filter((c) => ids.has(c.id));
}

/** The weapons a school teaches (in the weapons' order). */
export function weaponsOf(catalog: Catalog, ryu: string): Weapon[] {
	const ids = new Set(unique(catalog.sections.filter((s) => s.ryu === ryu && s.weapon).map((s) => s.weapon)));
	return catalog.weapons.filter((w) => ids.has(w.id));
}

/** A school's sections in a category (under Buki: of one weapon). */
export const sectionsOf = (catalog: Catalog, ryu: string, category: string, weapon?: string) =>
	catalog.sections.filter(
		(s) => s.ryu === ryu && s.category === category && (category !== BUKI || s.weapon === weapon)
	);

export const techniquesOf = (catalog: Catalog, section: string) =>
	catalog.techniques.filter((t) => t.section === section);

// `?? []`: a catalogue cached offline before segments existed has none.
export const segmentsOf = (catalog: Catalog, technique: string) =>
	(catalog.segments ?? []).filter((s) => s.technique === technique);

/** Every segment under a place of the catalogue: a school, category, weapon,
 * section or technique (as far as the path goes). */
export function segmentsUnder(catalog: Catalog, p: CatalogPath): Segment[] {
	if (p.technique) return segmentsOf(catalog, techniqueId(p));
	const sections = new Set(
		catalog.sections
			.filter(
				(s) =>
					s.ryu === p.ryu &&
					(!p.category || s.category === p.category) &&
					(!p.weapon || s.weapon === p.weapon) &&
					(!p.section || s.id === sectionId(p))
			)
			.map((s) => s.id)
	);
	const techniques = new Set(catalog.techniques.filter((t) => sections.has(t.section)).map((t) => t.id));
	return (catalog.segments ?? []).filter((s) => techniques.has(s.technique));
}

/** Everything a path names, each step only if it exists below the previous one;
 * `found`: the whole path exists. */
export function resolvePath(catalog: Catalog, p: CatalogPath) {
	const school = findSchool(catalog, p.ryu);
	const category = school && p.category ? categoriesOf(catalog, school.id).find((c) => c.id === p.category) : undefined;
	const weapon =
		school && category?.id === BUKI && p.weapon
			? weaponsOf(catalog, school.id).find((w) => w.id === p.weapon)
			: undefined;
	const sectionParent = category && (category.id !== BUKI || weapon);
	const section = sectionParent && p.section ? catalog.sections.find((s) => s.id === sectionId(p)) : undefined;
	const technique = section && p.technique ? catalog.techniques.find((t) => t.id === techniqueId(p)) : undefined;
	const found =
		!!school &&
		(!p.category || !!category) &&
		(!p.weapon || !!weapon) &&
		(!p.section || !!section) &&
		(!p.technique || !!technique);
	return { school, category, weapon, section, technique, found };
}

/** The path of a section or technique, from its ID (e.g. to fill the annotation form). */
export function pathOf(catalog: Catalog, techniqueOrSection: string): CatalogPath | undefined {
	const technique = catalog.techniques.find((t) => t.id === techniqueOrSection);
	const section = catalog.sections.find((s) => s.id === (technique ? technique.section : techniqueOrSection));
	if (!section) return undefined;
	return {
		ryu: section.ryu,
		category: section.category,
		weapon: section.weapon,
		section: lastPart(section.id),
		technique: technique && lastPart(technique.id)
	};
}

/** A technique's place in the catalogue as the annotation forms choose it, step by step
 * (school, category, weapon under Buki, section and technique IDs); empty strings: not chosen. */
export interface Place {
	school: string;
	category: string;
	weapon: string;
	section: string;
	technique: string;
}

export const emptyPlace = (): Place => ({ school: '', category: '', weapon: '', section: '', technique: '' });

/** The place of a technique (unknown or none: nothing chosen). */
export function placeOf(catalog: Catalog, technique: string | null | undefined): Place {
	const path = technique ? pathOf(catalog, technique) : undefined;
	if (!path || !technique) return emptyPlace();
	return {
		school: path.ryu,
		category: path.category ?? '',
		weapon: path.weapon ?? '',
		section: sectionId(path),
		technique
	};
}

// --- URLs: /schools/<ryu>/<category>/<section>/<technique>, under Buki /schools/<ryu>/buki/<weapon>/<section>/<technique> ---

const part = encodeURIComponent;
export const schoolHref = (ryu: string) => url(`/schools/${part(ryu)}`);

/** The page of the path's last step. */
export function catalogHref(p: CatalogPath) {
	const steps = [p.ryu, p.category, p.category === BUKI ? p.weapon : undefined, p.section, p.technique];
	const last = steps.findLastIndex((s) => s);
	return url(
		`/schools/${steps
			.slice(0, last + 1)
			.filter((s) => s !== undefined)
			.map((s) => part(s!))
			.join('/')}`
	);
}

/** Breadcrumbs: Schools › school › category › weapon › section › technique, as far as they exist. */
export function catalogCrumbs(catalog: Catalog | undefined, p?: CatalogPath) {
	const items = [{ label: t('nav.schools'), href: url('/schools') }];
	if (!catalog || !p) return items;
	const { school, category, weapon, section, technique } = resolvePath(catalog, p);
	if (!school) return items;
	items.push({ label: school.romaji, href: catalogHref({ ryu: school.id }) });
	if (!category) return items;
	items.push({ label: category.romaji, href: catalogHref({ ryu: school.id, category: category.id }) });
	if (category.id === BUKI) {
		if (!weapon) return items;
		items.push({ label: weapon.romaji, href: catalogHref({ ryu: school.id, category: BUKI, weapon: weapon.id }) });
	}
	if (!section) return items;
	items.push({ label: section.romaji, href: catalogHref({ ...p, technique: undefined }) });
	if (technique) items.push({ label: technique.romaji, href: catalogHref(p) });
	return items;
}
