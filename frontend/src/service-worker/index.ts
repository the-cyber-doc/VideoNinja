// Service worker: the app opens offline, with the last catalogue seen.
// - App shell (build output, static files, "/"): precached per version, cache first.
// - Page loads: network first, else the cached shell (single-page app).
// - /api/catalog: stale-while-revalidate, one entry per language. The browser's
//   HTTP cache revalidates with the ETag, so an unchanged catalogue costs a 304.
//   When it changed, the open pages are told: {type: 'catalog-updated', lang}.
// - /api/setup/status, /api/auth/me, /api/techniques/<id>/comments: network first
//   (always the latest when online), the cached copy only offline.
// - Anything else (other API calls, media): network only, never cached.
// DATA holds user data: deleted on logout and login (clearUserData in $lib/pwa.ts).
// Type-checked with its own tsconfig.json (WebWorker types, no DOM).
import { version } from '$app/env';
import { assets, immutable } from '$app/manifest';
import { self as sw } from '$app/service-worker';
import { DATA } from '#lib/pwa-caches.js';

const SHELL = `shell-${version}`;
// Manifest paths are relative to the base path, where the service worker is.
const ASSETS = new Set(
	[...immutable, ...assets].map((file) => new URL(file.path, sw.location.href).pathname)
);
// API reads also kept for offline use (network first).
const OFFLINE_API = [/^\/api\/setup\/status$/, /^\/api\/auth\/me$/, /^\/api\/techniques\/[^/]+\/comments$/];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((cache) => cache.addAll([...ASSETS, '/']))
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
	else if (url.pathname === '/api/catalog') event.respondWith(catalog(event));
	else if (OFFLINE_API.some((path) => path.test(url.pathname))) event.respondWith(networkFirst(request));
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
		return (await caches.match('/', SHELL_MATCH)) ?? Promise.reject(e);
	}
}

async function catalog(event: FetchEvent): Promise<Response> {
	const request = event.request;
	const lang = request.headers.get('Accept-Language') ?? '';
	const key = `/api/catalog?lang=${encodeURIComponent(lang)}`; // same URL for every language
	const cache = await caches.open(DATA);
	const cached = await cache.match(key);

	const update = fetch(request).then(async (response) => {
		if (response.ok) {
			await cache.put(key, response.clone());
			if (cached && cached.headers.get('ETag') !== response.headers.get('ETag')) {
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
