import { expect, test, type Page } from '@playwright/test';

// The Books page (/books, the 'book_mgmt' access): in the menu between Upload and Videos,
// unreachable without the access. The API is faked (only the login's).
const BOOKS = {
	username: 'aiko',
	name: null,
	role: 'book_mgmt',
	role_name: 'Book manager',
	access: ['segment', 'comment', 'annotate', 'upload', 'book_mgmt']
};

async function setup(page: Page, user: object = BOOKS) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => r.fulfill({ json: user }));
}

test('Books: in the menu between Upload and Videos, only with the book_mgmt access', async ({ page }) => {
	await setup(page, { ...BOOKS, role: 'content_mgmt', access: [...BOOKS.access, 'video_mgmt'] });
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Books', 'Videos']);
	await nav.getByRole('link', { name: 'Books' }).click();
	await expect(page).toHaveURL('/books');
	await expect(page.getByRole('heading', { name: 'Books', level: 1 })).toBeVisible();
});

test('without the book_mgmt access: no menu entry, back to the home page', async ({ page }) => {
	await setup(page, { ...BOOKS, role: 'video_mgmt', access: ['upload', 'video_mgmt'] });
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Videos']);
	await page.goto('/books');
	await expect(page).toHaveURL('/');
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.goto('/books');
	await expect(page.getByRole('heading', { name: 'Livres', level: 1 })).toBeVisible();
	await expect(page.getByText('Pas encore de livre.')).toBeVisible();
});
