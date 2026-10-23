import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { CLIP, fulfillClip } from '../clip';

// The service worker, on the production build. The API is faked with context.route,
// which (unlike page.route) also sees the service worker's requests. Run at the
// domain's root (project pwa) and under /videoninja (project subpath): `at(path)`
// is an app path as the browser requests it.
const test = base.extend<{ at: (path: string) => string }>({
	at: async ({ baseURL }, use) => {
		const prefix = new URL(baseURL!).pathname.replace(/\/$/, '');
		await use((path) => prefix + path);
	}
});
const USER = { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment'] };
const school = (id: string) => ({ id, kanji: `${id}流`, romaji: `${id} Ryu` });
const COMMENTS = [
	{ id: 1, user: 'Hana', created_at: '2027-01-15T09:00:00+01:00', modified_at: '2027-01-15T09:00:00+01:00', lang: 'fr', text: 'Très bien', mine: false }
];
const LEVEL = { id: 'shoden', kanji: '初伝', romaji: 'Shoden' };
const technique = { id: 'togakure.t', kanji: '技', romaji: 'Waza', ryu: 'togakure', level: 'shoden' };
const SEGMENT = { id: 7, video: 1, technique: 'togakure.t', begin_s: 12, end_s: 27, performer: 'p' };
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);
const catalog = (ids: string[], segment = SEGMENT) => ({
	schools: ids.map(school),
	levels: [LEVEL],
	techniques: [technique],
	segments: [segment]
});

async function fakeApi(context: BrowserContext, schools = ['togakure', 'gyokko'], segment = SEGMENT) {
	await context.route('**/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await context.route('**/api/auth/me', (r) => r.fulfill({ json: USER }));
	await context.route('**/api/auth/logout', (r) => r.fulfill({ status: 204 }));
	await context.route('**/api/catalog', (r) =>
		r.fulfill({ json: catalog(schools, segment), headers: { ETag: `"${schools.length}-${segment.begin_s}"` } })
	);
	await context.route('**/api/techniques/*/comments', (r) => r.fulfill({ json: COMMENTS }));
	await context.route('**/media/segment/7', fulfillClip);
	await context.route('**/media/segment/7/thumbnail', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
}

/** The paths in a cache, as the browser requests them. */
const cachedPaths = (page: Page, cache: string) =>
	page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname), cache);

/** Open the page, wait for the service worker, reload so that it serves the page. */
async function controlled(page: Page, path: string) {
	await page.goto(path);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const cards = (page: Page) => page.locator('.catalog-card');

test('installable: manifest and icons', async ({ page, request, at }) => {
	await page.goto(at('/login'));
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', at('/manifest.webmanifest'));
	const manifestUrl = new URL(at('/manifest.webmanifest'), page.url());
	const manifest = await (await request.get(manifestUrl.href)).json();
	// Relative to the manifest: right at the root and under a base path alike.
	expect(manifest).toMatchObject({ name: 'Video Ninja', start_url: './', scope: './', display: 'standalone' });
	expect(new URL(manifest.start_url, manifestUrl).pathname).toBe(at('/'));
	expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toEqual(['any', 'any', 'maskable']);
	for (const icon of manifest.icons) {
		const r = await request.get(new URL(icon.src, manifestUrl).href);
		expect(r.ok(), icon.src).toBe(true);
		expect(r.headers()['content-type']).toBe('image/png');
	}
});

test('works offline with the last catalogue seen', async ({ page, context, at }) => {
	await fakeApi(context);
	await controlled(page, at('/schools'));
	await expect(cards(page)).toHaveCount(2);

	await context.unrouteAll({ behavior: 'ignoreErrors' });
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('link', { name: 'Schools' })).toBeVisible(); // shell + user, cached
	await expect(cards(page)).toHaveText(['togakure流 togakure Ryu', 'gyokko流 gyokko Ryu']);
});

test('comments seen online are shown offline', async ({ page, context, at }) => {
	await fakeApi(context);
	await controlled(page, at('/schools/togakure/shoden/togakure.t'));
	await expect(page.locator('.comment')).toHaveText([/Hana.*Très bien/]);

	await context.unrouteAll({ behavior: 'ignoreErrors' });
	await context.setOffline(true);
	await page.reload();
	await expect(page.locator('.comment')).toHaveText([/Hana.*Très bien/]);
});

test('a clip watched online plays offline, with its thumbnail', async ({ page, context, at }) => {
	await fakeApi(context);
	await controlled(page, at('/schools/togakure/shoden/togakure.t'));
	const play = page.getByRole('button', { name: 'Play the segment (0:15)' });
	await play.click();
	const video = page.locator('dialog video');
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
	// Saved while it played: one download for the player and the cache.
	await expect
		.poll(() => cachedPaths(page, 'media'))
		.toEqual(expect.arrayContaining([at('/media/segment/7'), at('/media/segment/7/thumbnail')]));
	await page.keyboard.press('Escape');

	await context.unrouteAll({ behavior: 'ignoreErrors' });
	await context.setOffline(true);
	await page.reload();
	await expect(play.locator('img')).toHaveJSProperty('complete', true); // the cached picture
	expect(await play.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
	await play.click();
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
	// Seeking (and so frame stepping) works in the saved clip.
	await page.getByRole('button', { name: 'Next frame' }).click(); // pauses
	await video.evaluate((v: HTMLVideoElement) => (v.currentTime = 2));
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(2);
	// Range requests (seeking; Safari needs them) are answered from the saved clip.
	const part = await page.evaluate(async (clip) => {
		const r = await fetch(clip, { headers: { Range: 'bytes=0-1' } });
		return { status: r.status, range: r.headers.get('Content-Range'), length: (await r.arrayBuffer()).byteLength };
	}, at('/media/segment/7'));
	expect(part).toEqual({ status: 206, range: `bytes 0-1/${CLIP.length}`, length: 2 });
});

test('a re-timed segment: its saved clip and thumbnail are deleted', async ({ page, context, at }) => {
	await fakeApi(context);
	await controlled(page, at('/schools/togakure/shoden/togakure.t'));
	await page.getByRole('button', { name: 'Play the segment (0:15)' }).click();
	const saved = [at('/media/segment/7'), at('/media/segment/7/thumbnail')];
	await expect.poll(() => cachedPaths(page, 'media')).toEqual(expect.arrayContaining(saved));
	await page.keyboard.press('Escape');

	// A newer catalogue, the segment unchanged: kept.
	await context.unroute('**/api/catalog');
	await fakeApi(context, ['togakure', 'gyokko', 'koto']);
	await page.reload();
	await page.goto(at('/schools'));
	await expect(page.locator('.catalog-card')).toHaveCount(3);
	expect(await cachedPaths(page, 'media')).toEqual(expect.arrayContaining(saved));

	// Re-timed on the Videos page: the saved copies would show the old cut.
	await context.unroute('**/api/catalog');
	await fakeApi(context, ['togakure', 'gyokko', 'koto'], { ...SEGMENT, begin_s: 13 });
	await page.reload();
	await expect.poll(() => cachedPaths(page, 'media')).toEqual([]);
});

test('a newer catalogue replaces the cached one on the open page', async ({ page, context, at }) => {
	await fakeApi(context);
	await controlled(page, at('/schools'));
	await expect(cards(page)).toHaveCount(2);

	// Changed on the server: the page gets the cached copy at once, then the new one.
	await context.unroute('**/api/catalog');
	await fakeApi(context, ['togakure', 'gyokko', 'koto']);
	await page.reload();
	await expect(cards(page)).toHaveCount(3);
});

test('logout deletes the cached user data', async ({ page, context, at }) => {
	await fakeApi(context);
	await controlled(page, at('/schools'));
	await expect(cards(page)).toHaveCount(2);
	const cached = () => cachedPaths(page, 'data');
	expect(await cached()).toEqual(expect.arrayContaining([at('/api/auth/me'), at('/api/catalog')]));
	await page.evaluate(async (clip) => (await caches.open('media')).put(clip, new Response('clip')), at('/media/segment/7'));

	await page.getByRole('button', { name: 'User menu' }).click();
	await page.getByRole('menuitem', { name: 'Log out' }).click();
	await expect(page).toHaveURL(at('/login'));
	// The login page caches /api/setup/status again: not user data.
	expect((await cached()).filter((path) => path !== at('/api/setup/status'))).toEqual([]);
	expect(await page.evaluate(() => caches.has('media'))).toBe(false); // clips and thumbnails too
});
