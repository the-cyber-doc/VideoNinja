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

	it('a newer catalogue from the service worker: loaded again', async () => {
		server.getCatalog.mockResolvedValue(version(1));
		await module.loadCatalog();
		server.getCatalog.mockResolvedValue(version(2));
		server.updated!('en');
		expect(await module.loadCatalog()).toEqual(version(2));
	});
});
