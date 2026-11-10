// The searcher: its sources loaded once, refreshed when due, the index rebuilt only when
// one changed; videos and books only with their access; another user starts afresh.
import { describe, expect, it, vi } from 'vitest';
import type { BookRow, VideoRow } from '../api/types';
import type { Catalog } from '../catalog.svelte';
import type { SearchHits } from '../api/types';
import { DEBOUNCE_MS, REFRESH_MS, Searcher, type SearchDeps } from './searcher.svelte';

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

const hitsFor = (q: string): SearchHits => ({
	pages: [{ book: 2, page: 1, snippet: q }],
	annotations: [],
	comments: []
});

function setup(accesses: string[] = ['video_mgmt', 'book_mgmt']) {
	let now = 0;
	let user: string | undefined = 'aiko';
	const deps = {
		catalog: vi.fn(async (lang: string) => (lang === 'fr' ? FR : EN)),
		videos: vi.fn(async () => VIDEOS),
		books: vi.fn(async () => BOOKS),
		remote: vi.fn(async (q: string) => hitsFor(q)),
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

describe("lookup (the server's full text)", () => {
	it('asked a moment after the last key, kept for its query; nothing for blanks or the same query', async () => {
		vi.useFakeTimers();
		try {
			const { deps, searcher } = setup();
			searcher.lookup('ka');
			searcher.lookup('kamae ');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(deps.remote.mock.calls).toEqual([['kamae']]);
			expect(searcher.remoteHits(' kamae')).toEqual(hitsFor('kamae'));
			expect(searcher.remoteHits('ka')).toBeUndefined();
			searcher.lookup('kamae');
			searcher.lookup('  ');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(deps.remote).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
		}
	});

	it('an older answer arriving late is dropped; a failure said, until an answer comes', async () => {
		vi.useFakeTimers();
		try {
			const { deps, searcher } = setup();
			let answer!: (hits: SearchHits) => void;
			deps.remote.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
			searcher.lookup('first');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			searcher.lookup('second');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			answer(hitsFor('first'));
			await vi.advanceTimersByTimeAsync(0);
			expect(searcher.remote?.query).toBe('second');

			deps.remote.mockRejectedValueOnce(new Error('offline'));
			searcher.lookup('third');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(searcher.remoteFailed).toBe(true);
			let fail!: (e: Error) => void;
			deps.remote.mockImplementationOnce(() => new Promise((_, reject) => (fail = reject)));
			searcher.lookup('fourth');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			searcher.lookup('fifth');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			expect(searcher.remoteFailed).toBe(false);
			fail(new Error('late'));
			await vi.advanceTimersByTimeAsync(0);
			expect(searcher.remoteFailed).toBe(false); // an older failure: not said
		} finally {
			vi.useRealTimers();
		}
	});

	it('another user: the answer forgotten', async () => {
		vi.useFakeTimers();
		try {
			const { searcher, become } = setup();
			searcher.lookup('kamae');
			await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
			become('kenji');
			await searcher.refresh();
			expect(searcher.remoteHits('kamae')).toBeUndefined();
		} finally {
			vi.useRealTimers();
		}
	});
});
