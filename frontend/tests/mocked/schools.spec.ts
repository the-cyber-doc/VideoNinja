import { expect, test, type Page } from '@playwright/test';

// The API is faked: the main navigation and the Schools page.
const SCHOOLS = [
	{ id: 'togakure', kanji: '戸隠流', romaji: 'Togakure Ryu' },
	{ id: 'gyokko', kanji: '玉虎流', romaji: 'Gyokko Ryu' },
	{ id: 'kukishinden', kanji: '九鬼神伝流', romaji: 'Kukishinden Ryu' },
	{ id: 'koto', kanji: '虎倒流', romaji: 'Koto Ryu' },
	{ id: 'shinden', kanji: '神伝不動流', romaji: 'Shinden Fudo Ryu' },
	{ id: 'takagi', kanji: '高木揚心流', romaji: 'Takagi Yoshin Ryu' },
	{ id: 'gikan', kanji: '義鑑流', romaji: 'Gikan Ryu' },
	{ id: 'gyokushin', kanji: '玉心流', romaji: 'Gyokushin Ryu' },
	{ id: 'kumogakure', kanji: '雲隠流', romaji: 'Kumogakure Ryu' }
];

async function loggedIn(page: Page, schools = SCHOOLS) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) =>
		r.fulfill({
			json: { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment'] }
		})
	);
	await page.route('/api/catalog', (r) =>
		r.fulfill({ json: { schools, categories: [], weapons: [], sections: [], techniques: [], segments: [] } })
	);
}

test('Schools entry centred in the header, opens the schools page', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	const link = nav.getByRole('link', { name: 'Schools' });
	await expect(link).toBeVisible();
	await expect(link).not.toHaveAttribute('aria-current');

	const header = (await page.locator('header').boundingBox())!;
	const box = (await nav.boundingBox())!;
	expect(Math.abs(box.x + box.width / 2 - (header.x + header.width / 2))).toBeLessThan(2);

	await link.click();
	await expect(page).toHaveURL('/schools');
	await expect(link).toHaveAttribute('aria-current', 'page');
	await expect(page.getByRole('heading', { name: 'Schools' })).toBeVisible();

	const cards = page.locator('.catalog-card');
	await expect(cards).toHaveCount(9);
	await expect(cards.first().locator('span')).toHaveText(['戸隠流', 'Togakure Ryu']);
	await expect(cards.last().locator('span')).toHaveText(['雲隠流', 'Kumogakure Ryu']);
});

test('cards centred on the screen, as many per row as fit', async ({ page }) => {
	await page.setViewportSize({ width: 1920, height: 1080 });
	await loggedIn(page);
	await page.goto('/schools');
	const cards = page.locator('.catalog-card');
	await expect(cards).toHaveCount(9);
	const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
	expect(new Set(boxes.map((b) => b.top)).size).toBe(1); // one row on a large screen
	const left = boxes[0].left;
	const right = 1920 - boxes[8].right;
	expect(Math.abs(left - right)).toBeLessThan(2); // same space on both sides
});

test('phone: two cards per row, the last one centred', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 900 });
	await loggedIn(page);
	await page.goto('/schools');
	const cards = page.locator('.catalog-card');
	await expect(cards).toHaveCount(9);
	const boxes = await cards.evaluateAll((els) => els.map((e) => e.getBoundingClientRect()));
	expect(boxes[0].top).toBe(boxes[1].top);
	expect(boxes[2].top).toBeGreaterThan(boxes[1].top);
	const last = boxes[8];
	expect(Math.abs(last.left + last.width / 2 - 195)).toBeLessThan(2);
});

test('a school without its own emblem gets the generic one', async ({ page }) => {
	const unknown = (id: string) => ({ id, kanji: '新流', romaji: id });
	await loggedIn(page, [SCHOOLS[0], SCHOOLS[1], unknown('new_a'), unknown('new_b')]);
	await page.goto('/schools');
	await expect(page.locator('.catalog-card')).toHaveCount(4);
	// Small emblems are inlined (data: URLs): compare the images, not their file names.
	const image = (id: string) => page.locator(`[data-id="${id}"]`).evaluate((e) => getComputedStyle(e).backgroundImage);
	const [togakure, gyokko, newA, newB] = await Promise.all(['togakure', 'gyokko', 'new_a', 'new_b'].map(image));
	for (const img of [togakure, gyokko, newA]) expect(img).toMatch(/^url\(/);
	expect(togakure).not.toBe(gyokko);
	expect(newA).toBe(newB);
	expect(newA).not.toBe(togakure);
});

test('navigation in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await loggedIn(page);
	await page.goto('/schools');
	await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toHaveText('Écoles');
	await expect(page.getByRole('heading', { name: 'Écoles' })).toBeVisible();
});
