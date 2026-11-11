// The catalogue as the pages get it: fetched once per language, checked again in the
// background, replaced (and the pages told) only when it changed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog } from './catalog.svelte';

const server = vi.hoisted(() => ({ getCatalog: vi.fn(), updated: null as ((lang: string) => void) | null }));
vi.mock('./api/catalog', () => ({ getCatalog: server.getCatalog }));
vi.mock('./pwa', () => ({ onCatalogUpdated: (listener: (lang: string) => void) => (server.updated = listener) }));

type Module = typeof import('./catalog.svelte');
let module: Module;
let now: number;
const version = (n: number) => ({ schools: [{ id: `v${n}` }] }) as unknown as Catalog;
const settle = () => new Promise((resolve) => setTimeout(resolve));

beforeEach(async () => {
	vi.resetModules();
	server.getCatalog.mockReset();
	server.updated = null;
	now = 1_000_000;
	vi.spyOn(Date, 'now').mockImplementation(() => now);
	vi.stubGlobal('window', {}); // in a page: follows the service worker's news
	module = await import('./catalog.svelte');
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('loadCatalog', () => {
	it('fetched once, then from memory', async () => {
		server.getCatalog.mockResolvedValue(version(1));
		expect(await module.loadCatalog()).toEqual(version(1));
		expect(await module.loadCatalog()).toEqual(version(1));
		expect(server.getCatalog).toHaveBeenCalledTimes(1);
	});

	it('checked again after a while: replaced only when it changed', async () => {
		server.getCatalog.mockResolvedValue(version(1));
		await module.loadCatalog();
		now += 31_000;
		await module.loadCatalog(); // same: kept
		await settle();
		server.getCatalog.mockResolvedValue(version(2));
		now += 31_000;
		expect(await module.loadCatalog()).toEqual(version(1)); // the check runs in the background
		await settle();
		expect(await module.loadCatalog()).toEqual(version(2));
		expect(server.getCatalog).toHaveBeenCalledTimes(3);
	});

	it('a failed load is tried again on the next call; a failed check keeps what is shown', async () => {
		server.getCatalog.mockRejectedValueOnce(new Error('offline'));
		await expect(module.loadCatalog()).rejects.toThrow('offline');
		await settle();
		server.getCatalog.mockResolvedValue(version(1));
		expect(await module.loadCatalog()).toEqual(version(1));
		server.getCatalog.mockRejectedValueOnce(new Error('offline'));
		module.refreshCatalog();
		await settle();
		expect(await module.loadCatalog()).toEqual(version(1));
	});

	it('refreshed on request (one of my uploads published), not before the first load', async () => {
		module.refreshCatalog();
		expect(server.getCatalog).not.toHaveBeenCalled();
		server.getCatalog.mockResolvedValue(version(1));
		await module.loadCatalog();
		module.refreshCatalog();
		expect(server.getCatalog).toHaveBeenCalledTimes(2);
	});

	it('in another language: its own copy, asked in that language', async () => {
		server.getCatalog.mockImplementation(async (lang: string) => version(lang === 'fr' ? 2 : 1));
		expect(await module.loadCatalogIn('fr')).toEqual(version(2));
		expect(await module.loadCatalog()).toEqual(version(1)); // the page's (English)
		expect(server.getCatalog.mock.calls).toEqual([['fr'], ['en']]);
	});

	it('a newer catalogue from the service worker: loaded again', async () => {
		server.getCatalog.mockResolvedValue(version(1));
		await module.loadCatalog();
		server.getCatalog.mockResolvedValue(version(2));
		server.updated!('en');
		expect(await module.loadCatalog()).toEqual(version(2));
	});
});

describe('addToCatalog', () => {
	const created = [
		{ kind: 'school' as const, id: 'kasumi', kanji: '', romaji: 'Kasumi' },
		{ kind: 'category' as const, id: 'jutai', kanji: '柔', romaji: 'Jutai' },
		{ kind: 'weapon' as const, id: 'fundo', kanji: '', romaji: 'Fundo' },
		{
			kind: 'section' as const,
			id: 'kasumi.buki.fundo.k',
			kanji: '',
			romaji: 'K',
			ryu: 'kasumi',
			category: 'buki',
			weapon: 'fundo'
		},
		{
			kind: 'section' as const,
			id: 'kasumi.jutai.k',
			kanji: '',
			romaji: 'K',
			ryu: 'kasumi',
			category: 'jutai',
			weapon: null
		},
		{ kind: 'technique' as const, id: 'kasumi.jutai.k.t', kanji: '', romaji: 'T', section: 'kasumi.jutai.k' }
	];
	const empty = { schools: [], categories: [], weapons: [], sections: [], techniques: [], segments: [] } as Catalog;

	it('each new entry in its list, marked proposed, in every loaded language', async () => {
		server.getCatalog.mockImplementation(async (lang: string) => (lang === 'fr' ? { ...empty } : { ...empty }));
		await module.loadCatalog();
		await module.loadCatalogIn('fr');
		server.getCatalog.mockRejectedValue(new Error('offline'));
		await module.addToCatalog(created);
		for (const c of [await module.loadCatalog(), await module.loadCatalogIn('fr')]) {
			expect(c.schools).toEqual([{ id: 'kasumi', kanji: '', romaji: 'Kasumi', proposed: true }]);
			expect(c.categories.map((x) => x.id)).toEqual(['jutai']);
			expect(c.weapons.map((x) => x.id)).toEqual(['fundo']);
			expect(c.sections).toEqual([
				{
					id: 'kasumi.buki.fundo.k',
					kanji: '',
					romaji: 'K',
					proposed: true,
					ryu: 'kasumi',
					category: 'buki',
					weapon: 'fundo'
				},
				{ id: 'kasumi.jutai.k', kanji: '', romaji: 'K', proposed: true, ryu: 'kasumi', category: 'jutai' }
			]);
			expect(c.techniques).toEqual([
				{ id: 'kasumi.jutai.k.t', kanji: '', romaji: 'T', proposed: true, section: 'kasumi.jutai.k' }
			]);
		}
		expect(empty.schools).toEqual([]); // the loaded copy is replaced, never changed
	});

	it('nothing created, or a catalogue that failed to load: left alone', async () => {
		server.getCatalog.mockRejectedValueOnce(new Error('offline'));
		const failing = module.loadCatalog();
		await module.addToCatalog(created); // still loading, then failed: skipped
		await expect(failing).rejects.toThrow('offline');
		await module.addToCatalog([]);
		server.getCatalog.mockResolvedValue(empty);
		expect((await module.loadCatalog()).schools).toEqual([]);
	});
});
