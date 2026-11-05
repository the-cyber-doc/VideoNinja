// The searcher: its sources loaded once, refreshed when due, the index rebuilt only when
// one changed; videos and books only with their access; another user starts afresh.
import { describe, expect, it, vi } from 'vitest';
import type { BookRow, VideoRow } from '../api/types';
import type { Catalog } from '../catalog.svelte';
import { REFRESH_MS, Searcher, type SearchDeps } from './searcher.svelte';

const catalog = (description: string) =>
	({
		schools: [{ id: 'gyokko', kanji: '玉虎流', romaji: 'Gyokko Ryu', description }],
		categories: [],
		weapons: [],
		sections: [],
		techniques: [],
		segments: []
	}) as Catalog;
const EN = catalog('Jewel tiger');
const FR = catalog('Tigre de jade');
const VIDEOS = [{ id: 1, original_filename: 'kata.mp4', tags: [] }] as unknown as VideoRow[];
const BOOKS = [
	{ id: 2, status: 'published', original_filename: 'b.pdf', tags: [], reference: { title: 'Ninjutsu' } }
] as unknown as BookRow[];

function setup(accesses: string[] = ['video_mgmt', 'book_mgmt']) {
	let now = 0;
	let user: string | undefined = 'aiko';
	const deps = {
		catalog: vi.fn(async (lang: string) => (lang === 'fr' ? FR : EN)),
		videos: vi.fn(async () => VIDEOS),
		books: vi.fn(async () => BOOKS),
		can: (access: string) => accesses.includes(access),
		user: () => user,
		now: () => now
	} satisfies SearchDeps;
	const searcher = new Searcher(deps);
	const kinds = (q: string) => searcher.hits(q).map((h) => h.kind);
	return {
		deps,
		searcher,
		kinds,
		later: (ms: number) => (now += ms),
		become: (name: string | undefined) => (user = name)
	};
}

describe('Searcher', () => {
	it('nothing before the first load; then every language and every source', async () => {
		const { searcher, kinds } = setup();
		expect(kinds('tigre')).toEqual([]);
		await searcher.refresh();
		expect(kinds('tigre')).toEqual(['school']);
		expect(kinds('jewel')).toEqual(['school']);
		expect(kinds('kata')).toEqual(['video']);
		expect(kinds('ninjutsu')).toEqual(['book']);
		expect(searcher.version).toBe(1);
		expect(searcher.failed).toBe(false);
	});

	it('one load at a time; videos and books fetched again only when due; the index only when changed', async () => {
		const { deps, searcher, later } = setup();
		await Promise.all([searcher.refresh(), searcher.refresh()]);
		expect(deps.videos).toHaveBeenCalledTimes(1);
		await searcher.refresh(); // not due: kept, nothing changed
		expect(deps.videos).toHaveBeenCalledTimes(1);
		expect(deps.catalog).toHaveBeenCalledTimes(4); // the catalogues check themselves
		expect(searcher.version).toBe(1);
		later(REFRESH_MS);
		deps.books.mockResolvedValueOnce([...BOOKS]);
		await searcher.refresh();
		expect(deps.videos).toHaveBeenCalledTimes(2);
		expect(searcher.version).toBe(2); // the books changed
	});

	it('without the accesses: no videos, no books', async () => {
		const { deps, searcher, kinds } = setup([]);
		await searcher.refresh();
		expect(deps.videos).not.toHaveBeenCalled();
		expect(deps.books).not.toHaveBeenCalled();
		expect(kinds('kata')).toEqual([]);
	});

	it('offline: what was loaded is kept; never loaded: the search is unavailable', async () => {
		const { deps, searcher, kinds, later } = setup();
		await searcher.refresh();
		later(REFRESH_MS);
		deps.catalog.mockRejectedValue(new Error('offline'));
		deps.videos.mockRejectedValueOnce(new Error('offline'));
		deps.books.mockRejectedValueOnce(new Error('offline'));
		await searcher.refresh();
		expect(kinds('kata')).toEqual(['video']);
		expect(searcher.failed).toBe(false);

		const fresh = setup();
		fresh.deps.catalog.mockRejectedValue(new Error('offline'));
		await fresh.searcher.refresh();
		expect(fresh.searcher.failed).toBe(true);
		expect(fresh.kinds('tigre')).toEqual([]);
	});

	it('another user: everything loaded again', async () => {
		const { deps, searcher, become } = setup();
		await searcher.refresh();
		become('kenji');
		await searcher.refresh();
		expect(deps.videos).toHaveBeenCalledTimes(2);
		expect(searcher.version).toBe(2);
	});
});
