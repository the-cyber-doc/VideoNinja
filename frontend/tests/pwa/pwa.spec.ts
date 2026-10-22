import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// The service worker, on the production build. The API is faked with context.route,
// which (unlike page.route) also sees the service worker's requests.
const USER = { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment'] };
const school = (id: string) => ({ id, kanji: `${id}流`, romaji: `${id} Ryu` });
const catalog = (ids: string[]) => ({ schools: ids.map(school), levels: [], techniques: [] });

async function fakeApi(context: BrowserContext, schools = ['togakure', 'gyokko']) {
	await context.route('**/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await context.route('**/api/auth/me', (r) => r.fulfill({ json: USER }));
	await context.route('**/api/auth/logout', (r) => r.fulfill({ status: 204 }));
	await context.route('**/api/catalog', (r) =>
		r.fulfill({ json: catalog(schools), headers: { ETag: `"${schools.length}"` } })
	);
}

/** Open the page, wait for the service worker, reload so that it serves the page. */
async function controlled(page: Page, path: string) {
	await page.goto(path);
	await page.evaluate(() => navigator.serviceWorker.ready);
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

const cards = (page: Page) => page.locator('.school-card');

test('installable: manifest and icons', async ({ page, request }) => {
	await page.goto('/login');
	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
	const manifest = await (await request.get('/manifest.webmanifest')).json();
	expect(manifest).toMatchObject({ name: 'Video Ninja', start_url: '/', display: 'standalone' });
	expect(manifest.icons.map((i: { purpose: string }) => i.purpose)).toEqual(['any', 'any', 'maskable']);
	for (const icon of manifest.icons) {
		const r = await request.get(icon.src);
		expect(r.ok(), icon.src).toBe(true);
		expect(r.headers()['content-type']).toBe('image/png');
	}
});

test('works offline with the last catalogue seen', async ({ page, context }) => {
	await fakeApi(context);
	await controlled(page, '/schools');
	await expect(cards(page)).toHaveCount(2);

	await context.unrouteAll({ behavior: 'ignoreErrors' });
	await context.setOffline(true);
	await page.reload();
	await expect(page.getByRole('link', { name: 'Schools' })).toBeVisible(); // shell + user, cached
	await expect(cards(page)).toHaveText(['togakure流 togakure Ryu', 'gyokko流 gyokko Ryu']);
});

test('a newer catalogue replaces the cached one on the open page', async ({ page, context }) => {
	await fakeApi(context);
	await controlled(page, '/schools');
	await expect(cards(page)).toHaveCount(2);

	// Changed on the server: the page gets the cached copy at once, then the new one.
	await context.unroute('**/api/catalog');
	await fakeApi(context, ['togakure', 'gyokko', 'koto']);
	await page.reload();
	await expect(cards(page)).toHaveCount(3);
});

test('logout deletes the cached user data', async ({ page, context }) => {
	await fakeApi(context);
	await controlled(page, '/schools');
	await expect(cards(page)).toHaveCount(2);
	const cached = () =>
		page.evaluate(async () =>
			(await (await caches.open('data')).keys()).map((r) => new URL(r.url).pathname)
		);
	expect(await cached()).toEqual(expect.arrayContaining(['/api/auth/me', '/api/catalog']));

	await page.getByRole('button', { name: 'User menu' }).click();
	await page.getByRole('menuitem', { name: 'Log out' }).click();
	await expect(page).toHaveURL('/login');
	// The login page caches /api/setup/status again: not user data.
	expect((await cached()).filter((path) => path !== '/api/setup/status')).toEqual([]);
});
