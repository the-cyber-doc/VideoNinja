// The app's side of the PWA (the service worker is src/service-worker/).
import { dev } from '$app/env';
import { DATA } from './pwa-caches';

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
		navigator.serviceWorker.register('/service-worker.js').catch((e) => console.error(e));
	}
}

/** Ask the browser not to evict the caches under storage pressure (best effort). */
export function persistStorage() {
	navigator.storage?.persist?.().catch(() => {});
}

/** Forget the previous user's data: on logout, and after a login. */
export async function clearUserData() {
	try {
		await caches.delete(DATA);
	} catch {
		// no Cache API (insecure context, storage blocked): nothing stored
	}
}

/** Call `listener(lang)` when the service worker got a newer catalogue. */
export function onCatalogUpdated(listener: (lang: string) => void) {
	navigator.serviceWorker?.addEventListener('message', (event) => {
		if (event.data?.type === 'catalog-updated') listener(event.data.lang);
	});
}
