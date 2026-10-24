// Which clips and whole videos are saved on this device (cache MEDIA), by path:
// thumbnails show a phone (saved) or a cloud (not downloaded). Loaded once from
// the cache, then kept up to date by the service worker's messages ('media-saved',
// 'media-deleted') and by saveVideo. No Cache API: nothing is saved.
//
// Clips are saved by the service worker as they play. Whole videos (hundreds of
// MB) are saved here, by the Videos page: a service worker is stopped by the
// browser after a while (Firefox: about 30 s), which would cut the download.
import { SvelteSet } from 'svelte/reactivity';
import { MEDIA } from './pwa-caches';

const saved = new SvelteSet<string>();
let watching = false;

export const isSaved = (path: string) => saved.has(path);

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
