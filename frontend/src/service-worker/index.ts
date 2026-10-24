// Service worker: the app opens offline, with the last catalogue seen.
// - App shell (build output, static files, "/"): precached per version, cache first.
// - Page loads: network first, else the cached shell (single-page app).
// - /api/catalog: stale-while-revalidate, one entry per language. The browser's
//   HTTP cache revalidates with the ETag, so an unchanged catalogue costs a 304.
//   When it changed, the open pages are told: {type: 'catalog-updated', lang},
//   and the saved clips and thumbnails of segments removed or re-timed since
//   (Videos page) are deleted: their URLs carry only the segment's ID.
// - /api/setup/status, /api/auth/me, /api/techniques/<id>/comments: network first
//   (always the latest when online), the cached copy only offline.
// - /media/segment/<id>: the segment's clip, kept for offline use. A segment's
//   clip does not change: cache first, with Range requests answered from it
//   (range.ts). Not saved yet: downloaded once, for the player and the cache at
//   the same time (see clip()). Never two requests for one clip: the server
//   sends one clip per user at a time and answers 429 to a second.
// - /media/segment/<id>/thumbnail: cache first, checked in the background.
// - Anything else (other API calls): network only, never cached.
// DATA and MEDIA hold user data: deleted on logout and login (clearUserData in $lib/pwa.ts).
// Type-checked with its own tsconfig.json (WebWorker types, no DOM).
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self as sw } from '$app/service-worker';
import { DATA, MEDIA } from '#lib/pwa-caches.js';
import { rangeResponse } from './range';

const SHELL = `shell-${version}`;
// The app's base path ('' or e.g. '/videoninja'): the service worker is at <base>/service-worker.js.
const BASE = new URL('.', sw.location.href).pathname.replace(/\/$/, '');
const ROOT = `${BASE}/`; // the single-page app's shell
const escaped = BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const path = (pattern: string) => new RegExp(`^${escaped}${pattern}$`);
// Manifest paths are relative to the base path, where the service worker is.
const ASSETS = new Set(
	[...immutable, ...assets].map((file) => new URL(file.path, sw.location.href).pathname)
);
// API reads also kept for offline use (network first).
const OFFLINE_API = [path('/api/setup/status'), path('/api/auth/me'), path('/api/techniques/[^/]+/comments')];
const CATALOG = `${BASE}/api/catalog`;
const CLIP = path('/media/segment/\\d+');
const THUMBNAIL = path('/media/segment/\\d+/thumbnail');

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((cache) => cache.addAll([...ASSETS, ROOT]))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key.startsWith('shell-') && key !== SHELL) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	const url = new URL(request.url);
	if (request.method !== 'GET' || url.origin !== sw.location.origin) return;

	if (ASSETS.has(url.pathname)) event.respondWith(cacheFirst(request));
	else if (request.mode === 'navigate') event.respondWith(page(request));
	else if (url.pathname === CATALOG) event.respondWith(catalog(event));
	else if (OFFLINE_API.some((path) => path.test(url.pathname))) event.respondWith(networkFirst(request));
	else if (CLIP.test(url.pathname)) event.respondWith(clip(event));
	else if (THUMBNAIL.test(url.pathname)) event.respondWith(thumbnail(event));
});

// ignoreVary: the server's Vary (Origin, Accept-Encoding) would make a module
// script or a stylesheet (requested with an Origin header) miss the copy cached
// at install. Shell files are hashed or versioned: the URL is enough.
const SHELL_MATCH = { cacheName: SHELL, ignoreVary: true };

async function cacheFirst(request: Request): Promise<Response> {
	return (await caches.match(request, SHELL_MATCH)) ?? fetch(request);
}

async function page(request: Request): Promise<Response> {
	try {
		return await fetch(request);
	} catch (e) {
		return (await caches.match(ROOT, SHELL_MATCH)) ?? Promise.reject(e);
	}
}

async function catalog(event: FetchEvent): Promise<Response> {
	const request = event.request;
	const lang = request.headers.get('Accept-Language') ?? '';
	const key = `${CATALOG}?lang=${encodeURIComponent(lang)}`; // same URL for every language
	const cache = await caches.open(DATA);
	const cached = await cache.match(key);
	const before = cached?.clone(); // the page reads `cached` itself

	const update = fetch(request).then(async (response) => {
		if (response.ok) {
			await cache.put(key, response.clone());
			if (cached && cached.headers.get('ETag') !== response.headers.get('ETag')) {
				if (before) await forgetChangedSegments(before, response.clone());
				for (const client of await sw.clients.matchAll()) {
					client.postMessage({ type: 'catalog-updated', lang });
				}
			}
		}
		return response;
	});
	if (!cached) return update;
	event.waitUntil(update.catch(() => {})); // offline: keep the cached copy
	return cached;
}

type Times = Map<number, string>;

async function segmentTimes(catalog: Response): Promise<Times> {
	try {
		const { segments = [] } = (await catalog.json()) as { segments?: { id: number; begin_s: number; end_s: number }[] };
		return new Map(segments.map((s) => [s.id, `${s.begin_s}-${s.end_s}`]));
	} catch {
		return new Map(); // not JSON: nothing to compare
	}
}

/** Saved media of segments gone or re-timed between two catalogues: deleted. */
async function forgetChangedSegments(before: Response, after: Response) {
	const [old, now] = await Promise.all([segmentTimes(before), segmentTimes(after)]);
	const media = await caches.open(MEDIA);
	for (const [id, times] of old) {
		if (now.get(id) === times) continue;
		await media.delete(`${BASE}/media/segment/${id}`);
		await media.delete(`${BASE}/media/segment/${id}/thumbnail`);
	}
}

async function networkFirst(request: Request): Promise<Response> {
	const cache = await caches.open(DATA);
	try {
		const response = await fetch(request);
		if (response.ok) await cache.put(request, response.clone());
		else await cache.delete(request); // e.g. 401: logged out, forget the user
		return response;
	} catch (e) {
		return (await cache.match(request)) ?? Promise.reject(e);
	}
}

// Clips being downloaded and saved (URL → settled once saved, or not), so that
// one is downloaded once, not per request.
const saving = new Map<string, Promise<void>>();

/** The whole clip, downloaded once: the response, also saved as it arrives.
 * Registered before the request is sent, so that a request arriving meanwhile
 * waits for it instead of downloading the clip again. */
function download(event: FetchEvent, key: string, cache: Cache) {
	const response = fetch(key, { credentials: 'same-origin' }); // without Range
	// Cloned in the first callback of `response`: before the caller can read its body.
	const saved = response
		.then((whole) => (whole.status === 200 ? cache.put(key, whole.clone()) : undefined))
		.catch(() => {}) // offline, storage full, or the download cut: saved next time
		.finally(() => saving.delete(key));
	saving.set(key, saved);
	event.waitUntil(saved);
	return { response, saved };
}

async function clip(event: FetchEvent): Promise<Response> {
	const request = event.request;
	const key = request.url;
	const range = request.headers.get('Range');
	const cache = await caches.open(MEDIA);
	const cached = await cache.match(key);
	if (cached) return rangeResponse(cached, range);
	// Never two requests for one clip: the server sends one clip per user at a
	// time, and answers 429 to a second one.
	const pending = saving.get(key);
	if (pending) {
		// Being downloaded (Chrome seeking, Safari's next part): from the saved clip.
		await pending;
		return fromSaved(cache, key, request);
	}

	// The whole clip asked for (Chrome, Firefox: "bytes=0-"): one download, split
	// between the player (it plays as the bytes arrive) and the cache. A 200 answer
	// to such a request is valid HTTP: the browser takes the whole file.
	const { response, saved } = download(event, key, cache);
	if (!range || /^bytes=0-$/.test(range.trim())) return response;
	// A part (Safari's first request "bytes=0-1", a seek): the whole clip saved
	// first, then the part from it.
	const whole = await response;
	if (whole.status !== 200) return whole; // e.g. 429: another clip is downloading
	await saved;
	whole.body?.cancel().catch(() => {}); // the cache's copy is the one read
	return fromSaved(cache, key, request);
}

/** The part asked for, from the saved clip; from the network if it could not be
 * saved (storage full, download cut): alone by then. */
async function fromSaved(cache: Cache, key: string, request: Request): Promise<Response> {
	const saved = await cache.match(key);
	return saved ? rangeResponse(saved, request.headers.get('Range')) : fetch(request);
}

async function thumbnail(event: FetchEvent): Promise<Response> {
	const request = event.request;
	const cache = await caches.open(MEDIA);
	const cached = await cache.match(request);
	const check = fetch(request).then(async (response) => {
		if (response.ok) await cache.put(request, response.clone());
		else if (response.status === 404) await cache.delete(request); // segment removed
		return response;
	});
	if (!cached) return check;
	event.waitUntil(check.catch(() => {})); // offline: keep the cached copy
	return cached;
}
