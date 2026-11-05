// The search's data and index, app-wide: loaded when a search box is first used, the
// sources refreshed when one is used again (the catalogues revalidate themselves; videos
// and books at most every REFRESH_MS), the index rebuilt only when a source changed.
// Videos and books only for the users who may open them; offline, the catalogue alone.
import type MiniSearch from 'minisearch';
import type { BookRow, VideoRow } from '../api/types';
import type { Catalog } from '../catalog.svelte';
import { LANGUAGES, type Lang } from '../i18n.svelte';
import { buildIndex, documents, find, type Doc, type Hit, type Sources } from './search';

export const REFRESH_MS = 60_000;

/** What the searcher loads (the app's functions; tests give fakes). */
export interface SearchDeps {
	catalog: (lang: Lang) => Promise<Catalog>;
	videos: () => Promise<VideoRow[]>;
	books: () => Promise<BookRow[]>;
	can: (access: string) => boolean;
	/** The logged-in user: another one (after a logout) starts afresh. */
	user: () => string | undefined;
	now: () => number;
}

export class Searcher {
	/** Bumped when the index changed: results derived from `hits` run again. */
	version = $state(0);
	/** The catalogue could not be loaded (nothing to search). */
	failed = $state(false);
	sources: Sources = { catalogs: {}, videos: null, books: null };
	private index: MiniSearch<Doc> | null = null;
	private fetchedAt = -Infinity;
	private loading: Promise<void> | null = null;
	private user: string | undefined;

	constructor(private deps: SearchDeps) {}

	/** Load or refresh the sources (one at a time); the index follows. */
	refresh(): Promise<void> {
		this.loading ??= this.load().finally(() => (this.loading = null));
		return this.loading;
	}

	private async load() {
		if (this.deps.user() !== this.user) {
			this.user = this.deps.user();
			this.sources = { catalogs: {}, videos: null, books: null };
			this.index = null;
			this.fetchedAt = -Infinity;
		}
		const langs = Object.keys(LANGUAGES) as Lang[];
		const due = this.deps.now() - this.fetchedAt >= REFRESH_MS;
		const optional = <T>(access: string, get: () => Promise<T[]>, kept: T[] | null) =>
			!this.deps.can(access) ? Promise.resolve(null) : due ? get().catch(() => kept) : Promise.resolve(kept);
		const [catalogs, videos, books] = await Promise.all([
			Promise.all(langs.map((l) => this.deps.catalog(l).catch(() => this.sources.catalogs[l]))),
			optional('video_mgmt', this.deps.videos, this.sources.videos),
			optional('book_mgmt', this.deps.books, this.sources.books)
		]);
		if (due) this.fetchedAt = this.deps.now();
		const fresh: Sources = { catalogs: Object.fromEntries(langs.map((l, i) => [l, catalogs[i]])), videos, books };
		const same =
			this.index &&
			langs.every((l) => fresh.catalogs[l] === this.sources.catalogs[l]) &&
			fresh.videos === this.sources.videos &&
			fresh.books === this.sources.books;
		this.failed = !catalogs.some(Boolean);
		if (same) return;
		this.sources = fresh;
		this.index = buildIndex(documents(fresh));
		this.version++;
	}

	/** The hits for this query (none before the first load). Reactive on `version`. */
	hits(query: string): Hit[] {
		void this.version;
		return this.index ? find(this.index, query) : [];
	}
}
