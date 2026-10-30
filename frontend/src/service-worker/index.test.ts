// The service worker's routing and caching, on a fake worker scope: its events are
// sent by the tests, its caches are in memory, the network is a table of answers.
// (tests/pwa runs it in a real browser too.)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA, MEDIA } from '#lib/pwa-caches.js';
import { FakeCacheStorage, ORIGIN, urlOf } from '#lib/testing/browser.js';

const sw = vi.hoisted(() => {
	const listeners = new Map<string, (event: unknown) => void>();
	return {
		listeners,
		location: new URL('https://app.test/service-worker.js'),
		addEventListener: (type: string, listener: (event: unknown) => void) => listeners.set(type, listener),
		skipWaiting: vi.fn(async () => {}),
		posted: [] as unknown[],
		clients: {
			claim: vi.fn(async () => {}),
			matchAll: async () => [{ postMessage: (message: unknown) => sw.posted.push(message) }]
		}
	};
});
vi.mock('$app/service-worker', () => ({ self: sw }));
vi.mock('$app/env', () => ({ version: '2' }));
vi.mock('$app/manifest', () => ({
	assets: [{ path: 'favicon.svg' }],
	immutable: [{ path: '_app/immutable/app.js' }]
}));

let storage: FakeCacheStorage;
/** The network: an answer per path (a function, called for each request), else 404. */
let network: Record<string, () => Response | Promise<Response>>;
let requested: string[];

beforeEach(async () => {
	vi.resetModules();
	sw.listeners.clear();
	sw.posted.length = 0;
	storage = new FakeCacheStorage();
	network = {};
	requested = [];
	vi.stubGlobal('caches', storage);
	vi.stubGlobal(
		'fetch',
		vi.fn(async (request: RequestInfo | { url: string }) => {
			const path = new URL(urlOf(request)).pathname;
			requested.push(path);
			const answer = network[path];
			return answer ? answer() : new Response('not found', { status: 404 });
		})
	);
	await import('./index');
	await settle(); // loadSavedVideos at start
});

afterEach(() => vi.unstubAllGlobals());

const settle = () => new Promise((resolve) => setTimeout(resolve));
const offline = () => Promise.reject(new TypeError('Failed to fetch'));

interface Sent {
	response?: Promise<Response>;
	waits: Promise<unknown>[];
}

/** A fetch event; its answer (if the worker gave one) and what it waits for. */
function request(path: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}): Sent {
	const sent: Sent = { waits: [] };
	sw.listeners.get('fetch')!({
		request: {
			url: new URL(path, ORIGIN).href,
			method: init.method ?? 'GET',
			mode: init.mode ?? 'cors',
			headers: new Headers(init.headers)
		},
		respondWith: (response: Promise<Response>) => (sent.response = response),
		waitUntil: (promise: Promise<unknown>) => sent.waits.push(promise)
	});
	return sent;
}
const text = async (sent: Sent) => (await sent.response!).text();
const done = async (sent: Sent) => void (await Promise.all(sent.waits));

function lifecycle(type: 'install' | 'activate') {
	const waits: Promise<unknown>[] = [];
	sw.listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
	return Promise.all(waits);
}

describe('versions of the app', () => {
	it('installed: its files and the shell cached, active at once', async () => {
		for (const path of ['/favicon.svg', '/_app/immutable/app.js', '/']) network[path] = () => new Response(path);
		await lifecycle('install');
		const shell = await storage.open('shell-2');
		expect(new Set((await shell.keys()).map((r) => new URL(r.url).pathname))).toEqual(
			new Set(['/favicon.svg', '/_app/immutable/app.js', '/'])
		);
		expect(sw.skipWaiting).toHaveBeenCalled();
	});

	it("activated: the older versions' files deleted, the user's data kept", async () => {
		for (const name of ['shell-1', 'shell-2', DATA, MEDIA]) await storage.open(name);
		await lifecycle('activate');
		expect(await storage.keys()).toEqual(['shell-2', DATA, MEDIA]);
		expect(sw.clients.claim).toHaveBeenCalled();
	});
});

describe('routing', () => {
	it('not touched: writes, other sites, other API calls, whole videos not saved', () => {
		expect(request('/api/comments/1', { method: 'POST' }).response).toBeUndefined();
		expect(request('https://elsewhere.test/x.js').response).toBeUndefined();
		expect(request('/api/videos').response).toBeUndefined();
		expect(request('/media/video/7').response).toBeUndefined();
	});

	it("the app's files: from the cache, else the network", async () => {
		await (await storage.open('shell-2')).put('/_app/immutable/app.js', new Response('cached'));
		expect(await text(request('/_app/immutable/app.js'))).toBe('cached');
		network['/favicon.svg'] = () => new Response('icon');
		expect(await text(request('/favicon.svg'))).toBe('icon');
	});

	it('pages: the network, offline the cached shell (else the error)', async () => {
		network['/schools'] = () => new Response('page');
		expect(await text(request('/schools', { mode: 'navigate' }))).toBe('page');
		network['/schools'] = offline;
		await expect(request('/schools', { mode: 'navigate' }).response).rejects.toThrow('Failed to fetch');
		await (await storage.open('shell-2')).put('/', new Response('shell'));
		expect(await text(request('/schools', { mode: 'navigate' }))).toBe('shell');
	});
});

describe('network first (the user, the setup status, comments)', () => {
	it('kept for offline; a refusal forgets it; offline: the kept copy, else the error', async () => {
		network['/api/auth/me'] = () => new Response('kenji');
		expect(await text(request('/api/auth/me'))).toBe('kenji');
		network['/api/auth/me'] = offline;
		expect(await text(request('/api/auth/me'))).toBe('kenji');
		network['/api/auth/me'] = () => new Response('logged out', { status: 401 });
		expect((await request('/api/auth/me').response!).status).toBe(401);
		network['/api/auth/me'] = offline;
		await expect(request('/api/auth/me').response).rejects.toThrow('Failed to fetch');
	});
});

describe('the catalogue (stale-while-revalidate, per language)', () => {
	const catalogue = (etag: string, segments: { id: number; begin_s: number; end_s: number }[]) => () =>
		new Response(JSON.stringify({ segments }), { headers: { ETag: etag } });

	it('first from the network; then the cached copy at once, checked behind', async () => {
		network['/api/catalog'] = catalogue('"1"', []);
		const first = request('/api/catalog', { headers: { 'Accept-Language': 'fr' } });
		expect(JSON.parse(await text(first))).toEqual({ segments: [] });
		const second = request('/api/catalog', { headers: { 'Accept-Language': 'fr' } });
		expect(JSON.parse(await text(second))).toEqual({ segments: [] });
		await done(second);
		expect(sw.posted).toEqual([]); // unchanged (same ETag): nobody told
		expect(requested.filter((p) => p === '/api/catalog')).toHaveLength(2);
	});

	it('changed: the pages told; saved clips of removed or re-timed segments deleted', async () => {
		network['/api/catalog'] = catalogue('"1"', [
			{ id: 1, begin_s: 0, end_s: 5 },
			{ id: 2, begin_s: 5, end_s: 9 },
			{ id: 3, begin_s: 9, end_s: 12 }
		]);
		await done(request('/api/catalog', { headers: { 'Accept-Language': 'en' } }));
		const media = await storage.open(MEDIA);
		for (const path of [
			'/media/segment/1',
			'/media/segment/1/thumbnail',
			'/media/segment/2',
			'/media/segment/3/thumbnail'
		])
			await media.put(path, new Response('x'));
		network['/api/catalog'] = catalogue('"2"', [
			{ id: 1, begin_s: 0, end_s: 5 }, // unchanged
			{ id: 2, begin_s: 6, end_s: 9 } // re-timed; 3 removed
		]);
		const sent = request('/api/catalog', { headers: { 'Accept-Language': 'en' } });
		await text(sent);
		await done(sent);
		expect([...media.entries.keys()].map((u) => new URL(u).pathname)).toEqual([
			'/media/segment/1',
			'/media/segment/1/thumbnail'
		]);
		expect(sw.posted).toEqual([
			{ type: 'media-deleted', url: `${ORIGIN}/media/segment/2` },
			{ type: 'catalog-updated', lang: 'en' }
		]);
	});

	it('not JSON (a proxy page), refused, or offline: nothing deleted, the cached copy kept', async () => {
		network['/api/catalog'] = () => new Response('<html>', { headers: { ETag: '"1"' } });
		await done(request('/api/catalog'));
		await (await storage.open(MEDIA)).put('/media/segment/1', new Response('x'));
		network['/api/catalog'] = catalogue('"2"', []);
		await done(request('/api/catalog'));
		expect(await storage.match('/media/segment/1')).toBeDefined();
		network['/api/catalog'] = () => new Response('busy', { status: 503 });
		await done(request('/api/catalog'));
		network['/api/catalog'] = offline;
		const sent = request('/api/catalog');
		expect(JSON.parse(await text(sent))).toEqual({ segments: [] });
		await done(sent);
	});
});

describe('clips', () => {
	const clip = () => new Response(new Uint8Array([0, 1, 2, 3, 4]), { headers: { 'Content-Type': 'video/mp4' } });

	it('downloaded once, for the player and the cache; the pages told; then from the cache', async () => {
		network['/media/segment/1'] = clip;
		const sent = request('/media/segment/1', { headers: { Range: 'bytes=0-' } });
		expect((await sent.response!).status).toBe(200);
		await done(sent);
		expect(sw.posted).toEqual([{ type: 'media-saved', url: `${ORIGIN}/media/segment/1` }]);
		const part = await request('/media/segment/1', { headers: { Range: 'bytes=1-2' } }).response!;
		expect([part.status, [...new Uint8Array(await part.arrayBuffer())]]).toEqual([206, [1, 2]]);
		expect(requested).toEqual(['/media/segment/1']);
	});

	it('a part first (Safari): the whole clip saved, then the part from it; a second request waits for it', async () => {
		let release!: () => void;
		network['/media/segment/1'] = () => new Promise((resolve) => (release = () => resolve(clip())));
		const first = request('/media/segment/1', { headers: { Range: 'bytes=0-1' } });
		await settle();
		const second = request('/media/segment/1', { headers: { Range: 'bytes=3-4' } });
		await settle();
		release();
		const [a, b] = await Promise.all([first.response!, second.response!]);
		expect([...new Uint8Array(await a.arrayBuffer())]).toEqual([0, 1]);
		expect([...new Uint8Array(await b.arrayBuffer())]).toEqual([3, 4]);
		expect(requested).toEqual(['/media/segment/1']); // never two downloads of one clip
	});

	it('429 (another clip downloading): passed on, not saved', async () => {
		network['/media/segment/1'] = () => new Response('busy', { status: 429 });
		const sent = request('/media/segment/1', { headers: { Range: 'bytes=0-1' } });
		expect((await sent.response!).status).toBe(429);
		await done(sent);
		expect(await storage.match('/media/segment/1')).toBeUndefined();
	});

	it('could not be saved (storage full): the part from the network', async () => {
		network['/media/segment/1'] = clip;
		const media = await storage.open(MEDIA);
		media.put = async () => Promise.reject(new Error('QuotaExceededError'));
		const sent = request('/media/segment/1', { headers: { Range: 'bytes=0-1' } });
		expect((await sent.response!).status).toBe(200); // the network's own answer
		expect(requested).toEqual(['/media/segment/1', '/media/segment/1']);
	});
});

describe('whole videos saved by the Videos page', () => {
	it('answered from the device once the page says so; gone meanwhile: the network', async () => {
		const media = await storage.open(MEDIA);
		await media.put('/media/video/7', new Response(new Uint8Array([0, 1, 2, 3])));
		await media.put('/media/segment/1', new Response('clip'));
		const waits: Promise<unknown>[] = [];
		sw.listeners.get('message')!({
			data: { type: 'media-changed' },
			waitUntil: (p: Promise<unknown>) => waits.push(p)
		});
		sw.listeners.get('message')!({ data: { type: 'other' }, waitUntil: () => {} });
		await Promise.all(waits);
		const part = await request('/media/video/7', { headers: { Range: 'bytes=2-' } }).response!;
		expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([2, 3]);
		await media.delete('/media/video/7'); // logout, before the page's message
		network['/media/video/7'] = () => new Response('network');
		expect(await text(request('/media/video/7'))).toBe('network');
	});

	it('nothing saved yet: the media cache not created by the check', async () => {
		const waits: Promise<unknown>[] = [];
		sw.listeners.get('message')!({
			data: { type: 'media-changed' },
			waitUntil: (p: Promise<unknown>) => waits.push(p)
		});
		await Promise.all(waits);
		expect(await storage.has(MEDIA)).toBe(false);
	});
});

describe('thumbnails', () => {
	it('from the cache at once, checked behind; a removed segment’s deleted; offline: kept', async () => {
		network['/media/segment/1/thumbnail'] = () => new Response('jpg');
		expect(await text(request('/media/segment/1/thumbnail'))).toBe('jpg');
		network['/media/segment/1/thumbnail'] = () => new Response('gone', { status: 404 });
		const sent = request('/media/segment/1/thumbnail');
		expect(await text(sent)).toBe('jpg');
		await done(sent);
		expect(await storage.match('/media/segment/1/thumbnail')).toBeUndefined();
		network['/media/video/7/thumbnail'] = () => new Response('jpg');
		await done(request('/media/video/7/thumbnail'));
		network['/media/video/7/thumbnail'] = offline;
		const kept = request('/media/video/7/thumbnail');
		expect(await text(kept)).toBe('jpg');
		await done(kept);
		network['/media/video/7/thumbnail'] = () => new Response('busy', { status: 503 });
		await done(request('/media/video/7/thumbnail'));
		expect(await storage.match('/media/video/7/thumbnail')).toBeDefined(); // only a 404 deletes
	});
});
