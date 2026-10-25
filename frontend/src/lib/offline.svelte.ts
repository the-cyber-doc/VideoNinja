// Which clips and whole videos are saved on this device (cache MEDIA), by path:
// thumbnails show a phone (saved) or a cloud (not downloaded). Loaded once from
// the cache, then kept up to date by the service worker's messages ('media-saved',
// 'media-deleted') and by saveVideo. No Cache API: nothing is saved.
//
// Clips are saved by the service worker as they play, or on request for a whole
// branch of the catalogue (download / remove below: the cards' cloud and phone).
// Whole videos (hundreds of MB) are saved here, by the Videos page: a service
// worker is stopped by the browser after a while (Firefox: about 30 s), which
// would cut the download.
import { SvelteSet } from 'svelte/reactivity';
import { MEDIA } from './pwa-caches';

const saved = new SvelteSet<string>();
let watching = false;

/** Saving for offline use is possible: a service worker controls the page (it
 * saves the clips and plays them from the device). Not in development, nor on the
 * very first visit until it takes control. */
export const offline = $state({ available: false });

const pathOf = (url: string) => new URL(url, location.href).pathname;

export const isSaved = (path: string) => saved.has(pathOf(path));

// --- Clips of a branch of the catalogue: one queue for the whole app, one clip at
// a time (nginx sends one clip per user at a time and refuses a second: 429). ---

const queued = new SvelteSet<string>(); // waiting or downloading (paths)
const queue: string[] = [];
let current: { path: string; abort: AbortController } | null = null;
const RETRY_MS = 2000;
const RETRIES = 5;

export const isQueued = (path: string) => queued.has(pathOf(path));

/** Download the clips (paths /media/segment/<id>) not saved yet, after those already queued. */
export function download(paths: string[]) {
	if (!offline.available) return;
	for (const path of paths.map(pathOf)) {
		if (saved.has(path) || queued.has(path)) continue;
		queued.add(path);
		queue.push(path);
	}
	if (!current) pump();
}

/** Stop downloading these clips (those already saved stay). */
export function cancel(paths: string[]) {
	for (const path of paths.map(pathOf)) {
		queued.delete(path);
		if (current?.path === path) current.abort.abort();
	}
}

/** Delete these clips (and their thumbnails) from the device. */
export async function remove(paths: string[]) {
	cancel(paths);
	try {
		if (!(await caches.has(MEDIA))) return;
		const cache = await caches.open(MEDIA);
		for (const path of paths.map(pathOf)) {
			await cache.delete(path);
			await cache.delete(`${path}/thumbnail`);
			saved.delete(path);
		}
	} catch {
		// storage blocked: nothing was saved
	}
}

/** Stop every download (logout: before the caches are emptied). */
export function stopDownloads() {
	cancel([...queued]);
	queue.length = 0;
}

async function pump() {
	while (queue.length) {
		const path = queue.shift()!;
		if (!queued.has(path)) continue; // cancelled
		current = { path, abort: new AbortController() };
		try {
			await fetchClip(path, current.abort.signal);
		} catch {
			// offline, cancelled, refused: that clip stays missing
		} finally {
			queued.delete(path);
			current = null;
		}
	}
}

const sleep = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(resolve, ms);
		signal.addEventListener('abort', () => (clearTimeout(timer), reject(signal.reason)), { once: true });
	});

/** The whole clip, through the service worker, which saves it as it arrives (and
 * tells the pages: media-saved). Read to the end: the transfer is over before the
 * next one starts. Then its thumbnail, for offline. */
async function fetchClip(path: string, signal: AbortSignal) {
	for (let attempt = 0; attempt <= RETRIES; attempt++) {
		const response = await fetch(path, { credentials: 'same-origin', signal });
		if (response.status === 429) {
			await response.body?.cancel();
			await sleep(RETRY_MS, signal); // a clip being played meanwhile
			continue;
		}
		if (!response.ok) throw new Error(String(response.status));
		await response.arrayBuffer();
		await fetch(`${path}/thumbnail`, { credentials: 'same-origin', signal })
			.then((r) => r.arrayBuffer())
			.catch(() => {});
		return;
	}
}

const saving = new Map<string, AbortController>();

/** Save a whole video on the device, in the background (once; nothing if it is
 * saved, or without a service worker to play it from there later). Its requests
 * meanwhile go to the network: nginx allows 4 per user, the editor uses 3. */
export function saveVideo(path: string) {
	if (saved.has(path) || saving.has(path) || typeof caches === 'undefined' || !navigator.serviceWorker?.controller) return;
	const abort = new AbortController();
	saving.set(path, abort);
	(async () => {
		const response = await fetch(path, { credentials: 'same-origin', signal: abort.signal });
		if (response.status !== 200) return; // e.g. 429: next time
		await (await caches.open(MEDIA)).put(path, response); // streamed to the disk
		saved.add(new URL(path, location.href).pathname);
		mediaChanged();
	})()
		.catch(() => {}) // offline, storage full (a long video), left the app: next time
		.finally(() => saving.delete(path));
}

/** The service worker answers saved whole videos itself: tell it what changed. */
function mediaChanged() {
	navigator.serviceWorker?.controller?.postMessage({ type: 'media-changed' });
}

/** Start following the cache (once; from the app's layout). */
export function watchSavedMedia() {
	if (watching || typeof caches === 'undefined') return;
	watching = true;
	offline.available = !!navigator.serviceWorker?.controller;
	navigator.serviceWorker?.addEventListener('controllerchange', () => (offline.available = true));
	navigator.serviceWorker?.addEventListener('message', (event) => {
		const { type, url } = event.data ?? {};
		if (type === 'media-saved') saved.add(new URL(url).pathname);
		else if (type === 'media-deleted') saved.delete(new URL(url).pathname);
	});
	reloadSavedMedia();
}

/** Read the cache again (e.g. after it was emptied on logout); stops the saves in progress. */
export async function reloadSavedMedia() {
	for (const abort of saving.values()) abort.abort();
	mediaChanged();
	try {
		// has() first: open() would create the cache again (just deleted on logout).
		const keys = (await caches.has(MEDIA)) ? await (await caches.open(MEDIA)).keys() : [];
		saved.clear();
		for (const request of keys) saved.add(new URL(request.url).pathname);
	} catch {
		saved.clear(); // storage blocked: nothing saved
	}
}
