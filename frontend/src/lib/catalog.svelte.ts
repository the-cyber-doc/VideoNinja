// The catalogue (schools, levels, techniques), loaded once per language.
// Same shape and IDs as the server's snapshot: nulls omitted, names stored once.
import { api } from './api';
import { i18n, type Lang } from './i18n.svelte';
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
}

export interface Catalog {
	schools: School[];
	levels: Level[];
	techniques: Technique[];
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
