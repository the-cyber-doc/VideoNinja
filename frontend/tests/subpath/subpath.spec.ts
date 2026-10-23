import { expect, test } from '@playwright/test';

// The app built under /videoninja (BASE_PATH), as served at https://example.org/videoninja/:
// every request and link stays under it. The API is faked with context.route.
const BASE = '/videoninja';
const USER = { username: 'kenji', name: null, role: 'admin', role_name: 'Admin', access: ['segment', 'upload', 'user_mgmt'] };
const CATALOG = {
	schools: [{ id: 'gyokko', kanji: '玉虎流', romaji: 'Gyokko Ryu' }],
	levels: [{ id: 'shoden', kanji: '初伝', romaji: 'Shoden' }],
	techniques: [{ id: 'gyokko.koku', kanji: '虚空', romaji: 'Koku', ryu: 'gyokko', level: 'shoden' }],
	segments: [{ id: 7, video: 1, technique: 'gyokko.koku', begin_s: 12, end_s: 27, performer: 'p' }]
};

test('every request, link and the service worker stay under the base path', async ({ page, context }) => {
	const requested: string[] = [];
	page.on('request', (r) => requested.push(new URL(r.url()).pathname));
	await context.route('**/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await context.route('**/api/auth/me', (r) => r.fulfill({ json: USER }));
	await context.route('**/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await context.route('**/api/techniques/*/comments', (r) => r.fulfill({ json: [] }));
	await context.route('**/media/segment/**', (r) => r.fulfill({ status: 404 }));

	await page.goto(`${BASE}/`);
	await expect(page.getByText('Logged in as')).toBeVisible(); // the home page, under the base path
	const header = page.getByRole('banner');
	await expect(header.getByRole('link', { name: 'Video Ninja' })).toHaveAttribute('href', `${BASE}/`);
	await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveText(['Schools', 'Upload']);
	for (const link of await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link').all()) {
		expect(await link.getAttribute('href')).toMatch(new RegExp(`^${BASE}/`));
	}
	await page.getByRole('link', { name: 'Schools' }).click();
	await expect(page).toHaveURL(`${BASE}/schools`);
	await expect(page.getByRole('link', { name: 'Schools' })).toHaveAttribute('aria-current', 'page');

	await page.getByRole('link', { name: /Gyokko Ryu/ }).click();
	await page.getByRole('link', { name: /Shoden/ }).last().click();
	await page.getByRole('link', { name: /Koku/ }).click();
	await expect(page).toHaveURL(`${BASE}/schools/gyokko/shoden/gyokko.koku`);
	const clip = page.waitForRequest((r) => new URL(r.url()).pathname === `${BASE}/media/segment/7`);
	await page.getByRole('button', { name: 'Play the segment (0:15)' }).click();
	await clip;
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'User menu' }).click();
	await expect(page.getByRole('menuitem', { name: 'Profile' })).toHaveAttribute('href', `${BASE}/profile`);
	await expect(page.getByRole('menuitem', { name: 'User Management' })).toHaveAttribute('href', `${BASE}/admin/users`);

	const outside = requested.filter((path) => !path.startsWith(`${BASE}/`));
	expect(outside).toEqual([]);
	expect(requested).toEqual(expect.arrayContaining([`${BASE}/api/catalog`, `${BASE}/api/auth/me`]));

	const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
	expect(new URL(scope).pathname).toBe(`${BASE}/`);
});
