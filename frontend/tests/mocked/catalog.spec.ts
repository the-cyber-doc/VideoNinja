import { expect, test, type Page } from '@playwright/test';

// The API is faked: school → levels → techniques → technique page, and back.
const CATALOG = {
	schools: [
		{ id: 'togakure', kanji: '戸隠流', romaji: 'Togakure Ryu' },
		{ id: 'gyokko', kanji: '玉虎流', romaji: 'Gyokko Ryu' }
	],
	levels: [
		{ id: 'shoden', kanji: '初伝', romaji: 'Shoden', description: 'The initial transmission' },
		{ id: 'chuden', kanji: '中伝', romaji: 'Chuden', description: 'The intermediate transmission' },
		{ id: 'okuden', kanji: '奥伝', romaji: 'Okuden', description: 'The deep transmission' }
	],
	techniques: [
		{ id: 'gyokko.koku', kanji: '虚空', romaji: 'Koku', ryu: 'gyokko', level: 'shoden',
			description: 'Description will be added later.' },
		{ id: 'gyokko.keto', kanji: '闕倒', romaji: 'Keto', ryu: 'gyokko', level: 'shoden' },
		{ id: 'gyokko.deep', kanji: '奥', romaji: 'Deep', ryu: 'gyokko', level: 'okuden' },
		{ id: 'togakure.x', kanji: '戸', romaji: 'Other school', ryu: 'togakure', level: 'shoden' }
	],
	segments: [
		{ id: 7, video: 1, technique: 'gyokko.koku', begin_s: 12, end_s: 27, performer: 'p' },
		{ id: 8, video: 1, technique: 'gyokko.koku', begin_s: 75, end_s: 90, performer: 'p' },
		{ id: 9, video: 1, technique: 'gyokko.keto', begin_s: 1, end_s: 5, performer: 'p' }
	]
};
const COMMENTS = [
	// Newest first, as sent by the server.
	{ id: 3, user: 'Hana', created_at: '2027-01-15T09:00:00+01:00', lang: 'fr', text: 'Très bien' },
	{ id: 1, user: 'kenji', created_at: '2023-11-14T23:13:20+01:00', lang: 'en', text: 'First\nsecond line' }
];

async function loggedIn(page: Page) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) =>
		r.fulfill({
			json: { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment'] }
		})
	);
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.route('/api/techniques/gyokko.koku/comments', (r) => r.fulfill({ json: COMMENTS }));
	await page.route('/api/techniques/gyokko.keto/comments', (r) => r.fulfill({ json: [] }));
	// 1×1 PNG for every thumbnail.
	await page.route('/media/segment/*/thumbnail', (r) =>
		r.fulfill({
			contentType: 'image/png',
			body: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
				'base64'
			)
		})
	);
}

const crumbs = (page: Page, label = 'Breadcrumb') =>
	page.getByRole('navigation', { name: label }).getByRole('listitem');
const cards = (page: Page) => page.locator('.catalog-card');

test('school → levels → techniques → technique, breadcrumbs back up', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools');
	await cards(page).filter({ hasText: 'Gyokko Ryu' }).click();

	// Levels: all three, with their emblems.
	await expect(page).toHaveURL('/schools/gyokko');
	await expect(page.getByRole('heading', { name: 'Levels' })).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu']);
	await expect(cards(page)).toHaveText(['初伝 Shoden', '中伝 Chuden', '奥伝 Okuden']);
	for (const id of ['shoden', 'chuden', 'okuden']) {
		const image = await page
			.locator(`[data-id="${id}"]`)
			.evaluate((e) => getComputedStyle(e).backgroundImage);
		expect(image).toMatch(/^url\(/);
	}
	await page.locator('[data-id="shoden"]').click();

	// Techniques of Gyokko + Shoden only, without background image.
	await expect(page).toHaveURL('/schools/gyokko/shoden');
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Shoden']);
	await expect(cards(page)).toHaveText(['虚空 Koku', '闕倒 Keto']);
	expect(await cards(page).first().evaluate((e) => getComputedStyle(e).backgroundImage)).toBe('none');
	await cards(page).first().click();

	// Technique page.
	await expect(page).toHaveURL('/schools/gyokko/shoden/gyokko.koku');
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Shoden', 'Koku']);
	await expect(crumbs(page).last().locator('[aria-current="page"]')).toHaveText('Koku');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('虚空 Koku');
	await expect(page.getByText('Description will be added later.')).toBeVisible();

	// Breadcrumbs go back up the hierarchy.
	await crumbs(page).getByRole('link', { name: 'Shoden' }).click();
	await expect(page).toHaveURL('/schools/gyokko/shoden');
	await crumbs(page).getByRole('link', { name: 'Gyokko Ryu' }).click();
	await expect(page).toHaveURL('/schools/gyokko');
	await crumbs(page).getByRole('link', { name: 'Schools' }).click();
	await expect(page).toHaveURL('/schools');
});

test('technique page: segment thumbnails, then comments newest first', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/gyokko/shoden/gyokko.koku');

	const videos = page.locator('section').first();
	const thumbs = videos.getByRole('img');
	await expect(thumbs).toHaveCount(2);
	await expect(thumbs.first()).toHaveAttribute('src', '/media/segment/7/thumbnail');
	await expect(thumbs.first()).toHaveAttribute('alt', 'Segment 0:12–0:27');
	await expect(videos.getByText('1:15–1:30')).toBeVisible();

	const comments = page.locator('.comment');
	await expect(comments).toHaveCount(2);
	await expect(comments.first()).toContainText('Hana');
	await expect(comments.first()).toContainText('Très bien');
	await expect(comments.first().getByRole('img', { name: 'Language: Français' })).toBeVisible();
	await expect(comments.first().locator('svg.flag')).toHaveAttribute('width', '16'); // the menu's flag, smaller
	await expect(comments.last()).toContainText('kenji');
	await expect(comments.last().getByRole('img', { name: 'Language: English' })).toBeVisible();
	await expect(comments.last().locator('time')).toHaveAttribute('datetime', '2023-11-14T22:13:20.000Z');
	// Section order: description, videos, comments.
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Videos', 'Comments']);
});

test('technique without videos or comments', async ({ page }) => {
	await loggedIn(page);
	await page.route('/media/segment/*/thumbnail', (r) => r.fulfill({ status: 404 })); // newest route wins
	await page.goto('/schools/gyokko/shoden/gyokko.keto');
	// The thumbnail is missing: a placeholder keeps the place.
	await expect(page.getByRole('img', { name: 'Segment 0:01–0:05' })).toHaveClass(/placeholder/);
	await expect(page.getByText('No comments yet.')).toBeVisible();
});

test('level without techniques', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/gyokko/chuden');
	await expect(page.getByText('No techniques for this level yet.')).toBeVisible();
	await expect(cards(page)).toHaveCount(0);
});

test('unknown IDs: not found, breadcrumbs to what exists', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/nope');
	await expect(page.getByText('Not found.')).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools']);

	// A technique of another school is not found under this one.
	await page.goto('/schools/gyokko/shoden/togakure.x');
	await expect(page.getByText('Not found.')).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Shoden']);
	await crumbs(page).getByRole('link', { name: 'Shoden' }).click();
	await expect(page).toHaveURL('/schools/gyokko/shoden');
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await loggedIn(page);
	await page.goto('/schools/gyokko/shoden/gyokko.koku');
	await expect(crumbs(page, "Fil d'Ariane")).toHaveText(['Écoles', 'Gyokko Ryu', 'Shoden', 'Koku']);
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Vidéos', 'Commentaires']);
	await expect(page.locator('.comment').first().getByRole('img', { name: 'Langue : Français' })).toBeVisible();
});

test('a segment published later shows without reloading the app', async ({ page }) => {
	await page.clock.install();
	await loggedIn(page);
	let catalog = { ...CATALOG, segments: [] as typeof CATALOG.segments };
	await page.route('/api/catalog', (r) => r.fulfill({ json: catalog }));
	await page.goto('/schools/gyokko/shoden/gyokko.koku');
	await expect(page.getByText('No videos yet.')).toBeVisible();

	// Published on the server meanwhile; the user goes on navigating in the app.
	catalog = CATALOG;
	await crumbs(page).getByRole('link', { name: 'Shoden' }).click();
	await page.clock.fastForward('00:31');
	await page.getByRole('link', { name: /Koku/ }).click();
	await expect(page.locator('section').first().getByRole('img')).toHaveCount(2);
});
