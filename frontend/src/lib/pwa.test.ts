import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA, MEDIA, UPLOAD_DB } from './pwa-caches';
import { FakeCacheStorage, FakeContainer, FakeIndexedDB } from './testing/browser';

const env = vi.hoisted(() => ({ dev: false }));
vi.mock('$app/env', () => ({
	get dev() {
		return env.dev;
	}
}));

type Pwa = typeof import('./pwa');
let pwa: Pwa;
let container: FakeContainer;

beforeEach(async () => {
	vi.resetModules();
	env.dev = false;
	container = new FakeContainer();
	vi.stubGlobal('navigator', { serviceWorker: container });
	pwa = await import('./pwa');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('the service worker', () => {
	it('registered in production; then checked for updates in the foreground and hourly', async () => {
		vi.useFakeTimers();
		const update = vi.fn(async () => {});
		const register = vi.spyOn(container, 'register').mockResolvedValue({ update } as never);
		const page = Object.assign(new EventTarget(), { visibilityState: 'hidden' });
		vi.stubGlobal('document', page);
		pwa.registerServiceWorker();
		await vi.advanceTimersByTimeAsync(0);
		expect(register).toHaveBeenCalledWith('/service-worker.js', { scope: '/' });
		page.dispatchEvent(new Event('visibilitychange')); // hidden: no check
		page.visibilityState = 'visible';
		page.dispatchEvent(new Event('visibilitychange'));
		expect(update).toHaveBeenCalledTimes(1);
		update.mockRejectedValueOnce(new Error('offline'));
		await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
		expect(update).toHaveBeenCalledTimes(2);
	});

	it('a failed registration is logged', async () => {
		vi.spyOn(container, 'register').mockRejectedValue(new Error('insecure'));
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		pwa.registerServiceWorker();
		await settle();
		expect(error).toHaveBeenCalled();
	});

	it('in development: one left by a production test removed', async () => {
		env.dev = true;
		const unregister = vi.fn();
		container.registrations = [{ unregister }];
		const register = vi.spyOn(container, 'register');
		pwa.registerServiceWorker();
		await settle();
		expect([unregister.mock.calls.length, register.mock.calls.length]).toEqual([1, 0]);
	});

	it('nothing where browsers have none', () => {
		vi.stubGlobal('navigator', {});
		expect(() => pwa.registerServiceWorker()).not.toThrow();
		expect(() => pwa.onAppUpdated(() => {})).not.toThrow();
		expect(() => pwa.onCatalogUpdated(() => {})).not.toThrow();
	});
});

describe('signals from the service worker', () => {
	it('a new version took over: not on the first install', () => {
		container.controller = null;
		const updated = vi.fn();
		pwa.onAppUpdated(updated);
		container.dispatchEvent(new Event('controllerchange')); // the first install
		expect(updated).not.toHaveBeenCalled();
		container.dispatchEvent(new Event('controllerchange'));
		expect(updated).toHaveBeenCalledTimes(1);
	});

	it('a newer catalogue, per language', () => {
		const updated = vi.fn();
		pwa.onCatalogUpdated(updated);
		container.send({ type: 'catalog-updated', lang: 'fr' });
		container.send({ type: 'media-saved', url: 'x' });
		container.send(null);
		expect(updated.mock.calls).toEqual([['fr']]);
	});
});

describe('storage', () => {
	it('kept under pressure if the browser agrees (best effort)', async () => {
		const persist = vi.fn(async () => Promise.reject(new Error('denied')));
		vi.stubGlobal('navigator', { storage: { persist } });
		pwa.persistStorage();
		await settle();
		expect(persist).toHaveBeenCalled();
		vi.stubGlobal('navigator', {});
		expect(() => pwa.persistStorage()).not.toThrow();
	});

	it("the previous user's data forgotten: caches, saved media, drafts", async () => {
		const storage = new FakeCacheStorage();
		const idb = new FakeIndexedDB();
		vi.stubGlobal('caches', storage);
		vi.stubGlobal('indexedDB', idb);
		vi.stubGlobal('location', new URL('https://app.test/'));
		await storage.open(DATA);
		await storage.open(MEDIA);
		await pwa.clearUserData();
		expect(await storage.keys()).toEqual([]);
		expect(idb.deleted).toEqual([UPLOAD_DB]);
		expect(container.posted).toEqual([{ type: 'media-changed' }]);
	});

	it('nothing to forget without the Cache API or IndexedDB', async () => {
		vi.stubGlobal('caches', undefined);
		vi.stubGlobal('indexedDB', undefined);
		await expect(pwa.clearUserData()).resolves.toBeUndefined();
	});
});
