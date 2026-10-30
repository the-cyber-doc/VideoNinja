// What is saved on this device for offline use: the clips (downloaded one at a time,
// saved by the service worker) and the whole videos (saved here).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MEDIA } from './pwa-caches';
import { FakeCacheStorage, FakeContainer, ORIGIN } from './testing/browser';

type Offline = typeof import('./offline.svelte');
let offline: Offline;
let storage: FakeCacheStorage;
let container: FakeContainer;
let fetched: string[];
/** The server's answer per path (default: 200 with a body). */
let answers: Record<string, () => Response>;

beforeEach(async () => {
	vi.resetModules(); // the module's state (what is saved, the queue) starts empty
	storage = new FakeCacheStorage();
	container = new FakeContainer();
	fetched = [];
	answers = {};
	vi.stubGlobal('caches', storage);
	vi.stubGlobal('navigator', { serviceWorker: container });
	vi.stubGlobal('location', new URL(`${ORIGIN}/schools`));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (path: string, init: RequestInit = {}) => {
			init.signal?.throwIfAborted();
			fetched.push(path);
			return (answers[path] ?? (() => new Response('bytes')))();
		})
	);
	offline = await import('./offline.svelte');
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const settle = () => new Promise((resolve) => setTimeout(resolve));
const until = async (condition: () => boolean) => {
	for (let i = 0; i < 100 && !condition(); i++) await settle();
};

describe('following what is saved', () => {
	it('loaded from the cache, then kept up to date by the service worker', async () => {
		await (await storage.open(MEDIA)).put('/media/segment/1', new Response('clip'));
		offline.watchSavedMedia();
		offline.watchSavedMedia(); // once
		await until(() => offline.isSaved('/media/segment/1'));
		expect(offline.offline.available).toBe(true);
		container.send({ type: 'media-saved', url: `${ORIGIN}/media/segment/2` });
		container.send({ type: 'media-deleted', url: `${ORIGIN}/media/segment/1` });
		container.send({ type: 'other' });
		container.send(null);
		expect([offline.isSaved('/media/segment/1'), offline.isSaved('/media/segment/2')]).toEqual([false, true]);
	});

	it('available once a service worker takes control', () => {
		container.controller = null;
		offline.watchSavedMedia();
		expect(offline.offline.available).toBe(false);
		container.dispatchEvent(new Event('controllerchange'));
		expect(offline.offline.available).toBe(true);
	});

	it('nothing without the Cache API', () => {
		vi.stubGlobal('caches', undefined);
		offline.watchSavedMedia();
		expect(offline.offline.available).toBe(false);
	});

	it('read again: the whole videos being saved are stopped', async () => {
		let aborted = false;
		vi.mocked(fetch).mockImplementationOnce(
			(_, init) =>
				new Promise((_, reject) =>
					init!.signal!.addEventListener('abort', () => ((aborted = true), reject(new Error('aborted'))))
				)
		);
		offline.saveVideo('/media/video/7');
		await offline.reloadSavedMedia();
		expect(aborted).toBe(true);
	});

	it('read again after logout: nothing saved, the service worker told; storage blocked: nothing', async () => {
		await (await storage.open(MEDIA)).put('/media/segment/1', new Response('clip'));
		await offline.reloadSavedMedia();
		expect(offline.isSaved('/media/segment/1')).toBe(true);
		await storage.delete(MEDIA);
		await offline.reloadSavedMedia();
		expect(offline.isSaved('/media/segment/1')).toBe(false);
		expect(container.posted).toEqual([{ type: 'media-changed' }, { type: 'media-changed' }]);
		await (await storage.open(MEDIA)).put('/media/segment/1', new Response('clip'));
		storage.has = async () => Promise.reject(new Error('blocked'));
		await offline.reloadSavedMedia();
		expect(offline.isSaved('/media/segment/1')).toBe(false);
	});
});

describe('downloading clips', () => {
	beforeEach(() => offline.watchSavedMedia());

	it('one at a time, each with its thumbnail; saved or queued ones skipped', async () => {
		container.send({ type: 'media-saved', url: `${ORIGIN}/media/segment/3` });
		offline.download(['/media/segment/1', '/media/segment/2', '/media/segment/3']);
		offline.download(['/media/segment/1']); // queued already
		expect(offline.isQueued('/media/segment/2')).toBe(true);
		await until(() => !offline.isQueued('/media/segment/2'));
		expect(fetched).toEqual([
			'/media/segment/1',
			'/media/segment/1/thumbnail',
			'/media/segment/2',
			'/media/segment/2/thumbnail'
		]);
	});

	it('not without a service worker to save them', () => {
		offline.offline.available = false;
		offline.download(['/media/segment/1']);
		expect(fetched).toEqual([]);
	});

	it('429 (another clip downloading): tried again a little later', async () => {
		vi.useFakeTimers();
		let refused = 2;
		answers['/media/segment/1'] = () => (refused-- > 0 ? new Response('busy', { status: 429 }) : new Response('clip'));
		offline.download(['/media/segment/1']);
		await vi.advanceTimersByTimeAsync(5000);
		expect(fetched.filter((p) => p === '/media/segment/1')).toHaveLength(3);
		expect(offline.isQueued('/media/segment/1')).toBe(false);
	});

	it('a refused clip stays missing; the queue goes on', async () => {
		answers['/media/segment/1'] = () => new Response('gone', { status: 404 });
		answers['/media/segment/2/thumbnail'] = () => {
			throw new TypeError('offline');
		};
		offline.download(['/media/segment/1', '/media/segment/2']);
		await until(() => !offline.isQueued('/media/segment/2'));
		expect(fetched).toEqual(['/media/segment/1', '/media/segment/2', '/media/segment/2/thumbnail']);
	});

	it('cancelled: the current one stopped, the waiting ones dropped, the others kept', async () => {
		vi.useFakeTimers();
		answers['/media/segment/1'] = () => new Response('busy', { status: 429 }); // waits between attempts
		offline.download(['/media/segment/1', '/media/segment/2', '/media/segment/3']);
		await vi.advanceTimersByTimeAsync(0);
		offline.cancel(['/media/segment/1', '/media/segment/2']);
		await vi.runAllTimersAsync();
		expect(fetched).toEqual(['/media/segment/1', '/media/segment/3', '/media/segment/3/thumbnail']);
	});

	it('all stopped (logout)', async () => {
		vi.useFakeTimers();
		answers['/media/segment/1'] = () => new Response('busy', { status: 429 });
		offline.download(['/media/segment/1', '/media/segment/2']);
		await vi.advanceTimersByTimeAsync(0);
		offline.stopDownloads();
		await vi.runAllTimersAsync();
		expect(fetched).toEqual(['/media/segment/1']);
		expect(offline.isQueued('/media/segment/2')).toBe(false);
	});

	it('removed from the device with their thumbnails', async () => {
		const media = await storage.open(MEDIA);
		await media.put('/media/segment/1', new Response('clip'));
		await media.put('/media/segment/1/thumbnail', new Response('jpg'));
		container.send({ type: 'media-saved', url: `${ORIGIN}/media/segment/1` });
		await offline.remove(['/media/segment/1']);
		expect(media.entries.size).toBe(0);
		expect(offline.isSaved('/media/segment/1')).toBe(false);
	});

	it('removing without anything saved, or with storage blocked: nothing happens', async () => {
		await offline.remove(['/media/segment/1']);
		expect(await storage.has(MEDIA)).toBe(false); // not created by remove
		storage.has = async () => Promise.reject(new Error('blocked'));
		await expect(offline.remove(['/media/segment/1'])).resolves.toBeUndefined();
	});
});

describe('whole videos (the Videos page)', () => {
	it('saved once, in the background; the service worker told', async () => {
		offline.saveVideo('/media/video/7');
		offline.saveVideo('/media/video/7'); // being saved
		await until(() => offline.isSaved('/media/video/7'));
		expect(await (await storage.open(MEDIA)).match('/media/video/7')).toBeDefined();
		expect(offline.savedVideos()).toEqual(['/media/video/7']);
		expect(container.posted).toEqual([{ type: 'media-changed' }]);
		offline.saveVideo('/media/video/7'); // saved
		expect(fetched).toEqual(['/media/video/7']);
	});

	it('not without a service worker or the Cache API; refused: next time', async () => {
		container.controller = null;
		offline.saveVideo('/media/video/7');
		vi.stubGlobal('caches', undefined);
		container.controller = { postMessage: () => {} };
		offline.saveVideo('/media/video/7');
		expect(fetched).toEqual([]);
		vi.stubGlobal('caches', storage);
		answers['/media/video/8'] = () => new Response('busy', { status: 429 });
		offline.saveVideo('/media/video/8');
		await until(() => fetched.length === 1);
		await settle();
		expect(offline.isSaved('/media/video/8')).toBe(false);
		answers['/media/video/9'] = () => {
			throw new TypeError('offline');
		};
		offline.saveVideo('/media/video/9');
		await settle();
		expect(offline.isSaved('/media/video/9')).toBe(false);
	});

	it('removed together: saves in progress stopped, clips and thumbnails kept', async () => {
		const media = await storage.open(MEDIA);
		for (const path of ['/media/video/7', '/media/video/7/thumbnail', '/media/segment/1'])
			await media.put(path, new Response('x'));
		offline.watchSavedMedia();
		await until(() => offline.savedVideos().length === 1);
		let release!: () => void;
		answers['/media/video/8'] = () => {
			throw new Error('unreachable');
		};
		vi.mocked(fetch).mockImplementationOnce(
			(_, init) =>
				new Promise((_, reject) => {
					release = () => reject(new Error('aborted'));
					init!.signal!.addEventListener('abort', () => release());
				})
		);
		offline.saveVideo('/media/video/8');
		await offline.removeVideos();
		expect([...media.entries.keys()].map((u) => new URL(u).pathname)).toEqual([
			'/media/video/7/thumbnail',
			'/media/segment/1'
		]);
		expect(offline.savedVideos()).toEqual([]);
		storage.has = async () => Promise.reject(new Error('blocked'));
		await expect(offline.removeVideos()).resolves.toBeUndefined();
	});
});
