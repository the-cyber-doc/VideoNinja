// The catalogue (schools, levels, techniques, segments), loaded once per language.
// Same shape and IDs as the server's snapshot: nulls omitted, names stored once.
import { api } from './api';
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
// Bumped when the service worker has a newer catalogue: pages using it reload it.
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
		catalog = api<Catalog>('/api/catalog');
		catalog.catch(() => loaded.delete(lang)); // retry on the next call
		loaded.set(lang, catalog);
	}
	return catalog;
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
export const schoolHref = (ryu: string) => `/schools/${part(ryu)}`;
export const levelHref = (ryu: string, level: string) => `${schoolHref(ryu)}/${part(level)}`;
export const techniqueHref = (ryu: string, level: string, technique: string) =>
	`${levelHref(ryu, level)}/${part(technique)}`;

/** Breadcrumbs: Schools › school › level › technique, as far as given. */
export function catalogCrumbs(school?: School, level?: Level, technique?: Technique) {
	const items = [{ label: t('nav.schools'), href: '/schools' }];
	if (school) items.push({ label: school.romaji, href: schoolHref(school.id) });
	if (school && level) items.push({ label: level.romaji, href: levelHref(school.id, level.id) });
	if (school && level && technique) {
		items.push({ label: technique.romaji, href: techniqueHref(school.id, level.id, technique.id) });
	}
	return items;
}
