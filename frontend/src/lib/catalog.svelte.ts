// The catalogue (schools, levels, techniques, segments), kept in memory per language
// and checked again in the background when a page uses it (at most every 30 s;
// usually a 304), so new segments show without reloading the app.
// Same shape and IDs as the server's snapshot: nulls omitted, names stored once.
import { api } from './api';
import { url } from './base';
import { i18n, t, type Lang } from './i18n.svelte';
import { onCatalogUpdated } from './pwa';

export interface School {
	id: string;
	kanji: string;
	romaji: string;
	description?: string;
}

export interface Level {
	id: string;
	kanji: string;
	romaji: string;
	description?: string;
}

export interface Technique {
	id: string;
	kanji: string;
	romaji: string;
	/** School ID. */
	ryu: string;
	/** Level ID. */
	level: string;
	description?: string;
}

/** A part of a source video showing a technique; times in whole seconds. */
export interface Segment {
	id: number;
	video: number;
	technique: string;
	begin_s: number;
	end_s: number;
	performer: string;
}

export interface Catalog {
	schools: School[];
	levels: Level[];
	techniques: Technique[];
	segments: Segment[];
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
	void changes.count;
	const lang = i18n.lang;
	let catalog = loaded.get(lang);
	if (!catalog) {
		checkedAt.set(lang, Date.now());
		catalog = api<Catalog>('/api/catalog');
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

/** Fetch in the background; replace the catalogue only if it changed. */
async function revalidate(lang: Lang) {
	checkedAt.set(lang, Date.now());
	try {
		const [fresh, current] = await Promise.all([api<Catalog>('/api/catalog'), loaded.get(lang)]);
		if (JSON.stringify(fresh) !== JSON.stringify(current)) {
			loaded.set(lang, Promise.resolve(fresh));
			changes.count++;
		}
	} catch {
		// offline or server down: keep showing what we have
	}
}

// --- Lookups (same IDs as the URL) ---

export const findSchool = (catalog: Catalog, id: string) => catalog.schools.find((s) => s.id === id);

export const findLevel = (catalog: Catalog, id: string) => catalog.levels.find((l) => l.id === id);

/** The technique, only if it belongs to that school and level (as in its URL). */
export const findTechnique = (catalog: Catalog, ryu: string, level: string, id: string) =>
	catalog.techniques.find((t) => t.id === id && t.ryu === ryu && t.level === level);

export const techniquesOf = (catalog: Catalog, ryu: string, level: string) =>
	catalog.techniques.filter((t) => t.ryu === ryu && t.level === level);

// `?? []`: a catalogue cached offline before segments existed has none.
export const segmentsOf = (catalog: Catalog, technique: string) =>
	(catalog.segments ?? []).filter((s) => s.technique === technique);

// --- URLs: /schools/<ryu>/<level>/<technique> ---

const part = encodeURIComponent;
export const schoolHref = (ryu: string) => url(`/schools/${part(ryu)}`);
export const levelHref = (ryu: string, level: string) => `${schoolHref(ryu)}/${part(level)}`;
export const techniqueHref = (ryu: string, level: string, technique: string) =>
	`${levelHref(ryu, level)}/${part(technique)}`;

/** Breadcrumbs: Schools › school › level › technique, as far as given. */
export function catalogCrumbs(school?: School, level?: Level, technique?: Technique) {
	const items = [{ label: t('nav.schools'), href: url('/schools') }];
	if (school) items.push({ label: school.romaji, href: schoolHref(school.id) });
	if (school && level) items.push({ label: level.romaji, href: levelHref(school.id, level.id) });
	if (school && level && technique) {
		items.push({ label: technique.romaji, href: techniqueHref(school.id, level.id, technique.id) });
	}
	return items;
}
