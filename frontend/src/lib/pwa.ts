// The app's side of the PWA (the service worker is src/service-worker/).
import { dev } from '$app/env';
import { url } from './base';
import { reloadSavedMedia, stopDownloads } from './offline.svelte';
import { DATA, MEDIA, UPLOAD_DB } from './pwa-caches';

/** Production build only (SvelteKit's automatic registration is off, see vite.config.ts).
 * In development the service worker is an ES module, which Firefox cannot run, and
 * would have nothing to cache: remove one left by an earlier production test instead. */
export function registerServiceWorker() {
	if (!('serviceWorker' in navigator)) return;
	if (dev) {
		navigator.serviceWorker
			.getRegistrations()
			.then((all) => all.forEach((registration) => registration.unregister()));
	} else {
		navigator.serviceWorker
			.register(url('/service-worker.js'), { scope: url('/') })
			.then(checkForUpdates, (e) => console.error(e));
	}
}

const UPDATE_CHECK_MS = 60 * 60 * 1000;

/** The browser looks for a new service worker only when a page loads: an
 * installed app is resumed instead, and SvelteKit navigations load no page.
 * So: when the app comes back to the foreground, and every hour while open. */
function checkForUpdates(registration: ServiceWorkerRegistration) {
	const check = () => registration.update().catch(() => {}); // offline: next time
	document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && check());
	setInterval(check, UPDATE_CHECK_MS);
}

/** Call `listener` when a new version of the app took over (its service worker
 * activates at once and deletes the old files): the page still runs the old code
 * until it is reloaded. Not on the first install (the page had no service worker). */
export function onAppUpdated(listener: () => void) {
	const container = navigator.serviceWorker;
	if (!container) return;
	let controlled = !!container.controller;
	container.addEventListener('controllerchange', () => {
		if (controlled) listener();
		controlled = true;
	});
}

/** Ask the browser not to evict the caches under storage pressure (best effort). */
export function persistStorage() {
	navigator.storage?.persist?.().catch(() => {});
}

/** Forget the previous user's data: on logout, and after a login. */
export async function clearUserData() {
	stopDownloads(); // before the caches go: a clip saved afterwards would come back
	try {
		await caches.delete(DATA);
		await caches.delete(MEDIA);
		await reloadSavedMedia(); // thumbnails: nothing saved any more
	} catch {
		// no Cache API (insecure context, storage blocked): nothing stored
	}
	try {
		indexedDB.deleteDatabase(UPLOAD_DB); // upload drafts
	} catch {
		// no IndexedDB: nothing stored
	}
}

/** Call `listener(lang)` when the service worker got a newer catalogue. */
export function onCatalogUpdated(listener: (lang: string) => void) {
	navigator.serviceWorker?.addEventListener('message', (event) => {
		if (event.data?.type === 'catalog-updated') listener(event.data.lang);
	});
}
