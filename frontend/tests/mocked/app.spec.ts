import { expect, test, type Page } from '@playwright/test';

// The API is faked: these tests check the pages only, in Chromium and WebKit.
const ADMIN = {
	username: 'admin',
	name: 'Sensei',
	role: 'admin',
	role_name: 'Admin',
	access: ['segment', 'user_mgmt']
};
const USER = { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment'] };

async function loggedInAs(page: Page, user: object) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => r.fulfill({ json: user }));
}

test('menu without user management access', async ({ page }) => {
	await loggedInAs(page, USER);
	await page.goto('/');
	await expect(page.getByText('Logged in as kenji')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Log out' })).toHaveCount(0); // only in the menu

	await page.getByRole('button', { name: 'User menu' }).click();
	await expect(page.getByRole('menuitem')).toHaveText(['Profile', 'About', 'Log out']);
	// Click outside closes it.
	await page.getByText('Logged in as').click();
	await expect(page.getByRole('menu')).toBeHidden();
});

test.describe('in Tokyo', () => {
	test.use({ timezoneId: 'Asia/Tokyo' });

	test('API calls send the timezone, for the dates the server writes', async ({ page }) => {
		await loggedInAs(page, USER);
		const me = page.waitForRequest('/api/auth/me');
		await page.goto('/');
		expect((await me).headers()['time-zone']).toBe('Asia/Tokyo');
	});
});

test('menu with user management access', async ({ page }) => {
	await loggedInAs(page, ADMIN);
	await page.goto('/');
	await page.getByRole('button', { name: 'User menu' }).click();
	await expect(page.getByRole('menuitem')).toHaveText(['Profile', 'User Management', 'About', 'Log out']);
});

test('About: the app, its version and build, the database version, links and copyright', async ({ page }) => {
	await loggedInAs(page, USER);
	await page.route('/api/about', (r) => r.fulfill({ json: { db_version: 1, db_schema: 1 } }));
	await page.goto('/');
	await page.getByRole('button', { name: 'User menu' }).click();
	await page.getByRole('menuitem', { name: 'About' }).click();
	await expect(page).toHaveURL('/about');

	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'About' })).toBeVisible();
	await expect(main.getByText('Video Ninja')).toBeVisible();
	// Set by the build: the release (CI on a tag) or "dev"; the commit, "-dirty" with local changes.
	await expect(main.getByText(/^Version (dev|\d+\.\d+\.\d+)$/)).toBeVisible();
	await expect(main.getByText(/^Build ([0-9a-f]{7}(-dirty)?|unknown) of \w{3} \d+, \d{4}$/)).toBeVisible();
	await expect(main.getByText('Database version 1', { exact: true })).toBeVisible();
	await expect(main.getByText('this release ships')).toHaveCount(0);

	for (const [name, href] of [
		['Source code on GitHub', 'https://github.com/the-cyber-doc/VideoNinja'],
		['Docker images on Docker Hub', 'https://hub.docker.com/u/thecyberdoc'],
		['Licensed under the GNU GPL v3', 'https://github.com/the-cyber-doc/VideoNinja/blob/main/LICENSE']
	]) {
		const link = main.getByRole('link', { name });
		await expect(link).toHaveAttribute('href', href);
		await expect(link).toHaveAttribute('target', '_blank');
		await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
	}
	await expect(main.getByText(`© ${new Date().getUTCFullYear()} the-cyber-doc`)).toBeVisible();
});

test('About: a database older than the release says so; in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await loggedInAs(page, USER);
	await page.route('/api/about', (r) => r.fulfill({ json: { db_version: 1, db_schema: 2 } }));
	await page.goto('/about');
	const main = page.getByRole('main');
	await expect(main.getByRole('heading', { name: 'À propos' })).toBeVisible();
	await expect(main.getByText('Version de la base de données 1')).toBeVisible();
	await expect(main.getByText('(cette version fournit la version 2)')).toBeVisible();
	await expect(main.getByRole('link', { name: 'Code source sur GitHub' })).toBeVisible();
});

test('About offline: the database version is unknown, the rest is there', async ({ page }) => {
	await loggedInAs(page, USER);
	await page.route('/api/about', (r) => r.abort());
	await page.goto('/about');
	await expect(page.getByText('Database version —')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Source code on GitHub' })).toBeVisible();
});

test('user management page is not reachable without access, not even for a moment', async ({ page }) => {
	await loggedInAs(page, USER);
	let listed = false; // the page's API calls: never made without the access
	await page.route('/api/admin/**', (r) => ((listed = true), r.fulfill({ json: [] })));
	// Records whether the page's heading ever appears, before the redirect.
	await page.addInitScript(() => {
		const seen = () => [...document.querySelectorAll('h1')].some((h) => h.textContent === 'User Management');
		new MutationObserver(() => {
			if (seen()) (window as unknown as { flashed: boolean }).flashed = true;
		}).observe(document, { childList: true, subtree: true });
	});
	await page.goto('/admin/users');
	await expect(page).toHaveURL('/');
	expect(await page.evaluate(() => (window as unknown as { flashed?: boolean }).flashed ?? false)).toBe(false);
	expect(listed).toBe(false);
});

test('user list: the role names follow the language (translated by the server)', async ({ page }) => {
	await loggedInAs(page, ADMIN);
	const NAMES: Record<string, string> = { en: 'User', fr: 'Utilisateur' };
	await page.route('/api/admin/roles', (r) =>
		r.fulfill({ json: [{ id: 'user', name: NAMES[r.request().headers()['accept-language']] }] })
	);
	await page.route('/api/admin/users', (r) =>
		r.fulfill({ json: [{ id: 2, username: 'kenji', name: null, role: 'user', status: 'registered' }] })
	);
	await page.goto('/admin/users');
	const row = page.getByRole('row', { name: /kenji/ });
	await expect(row).toContainText('User');
	await page.getByRole('button', { name: 'Language: English' }).click();
	await page.getByRole('menuitemradio', { name: 'Français' }).click();
	await expect(row).toContainText('Utilisateur'); // loaded again (depends('app:lang'))
});

test('user list: status icons and actions', async ({ page }) => {
	await loggedInAs(page, ADMIN);
	await page.route('/api/admin/roles', (r) =>
		r.fulfill({
			json: [
				{ id: 'admin', name: 'Admin' },
				{ id: 'user', name: 'User' }
			]
		})
	);
	await page.route('/api/admin/users', (r) =>
		r.fulfill({
			json: [
				{ id: 1, username: 'admin', name: 'Sensei', role: 'admin', status: 'registered' },
				{ id: 2, username: 'hana', name: 'Hana', role: 'user', status: 'registered' },
				{ id: 3, username: 'kenji', name: null, role: 'user', status: 'invited' },
				{ id: 4, username: 'taro', name: null, role: 'user', status: 'expired' }
			]
		})
	);
	await page.goto('/admin/users');

	const row = (name: string) => page.getByRole('row', { name: new RegExp(name) });
	const cell = (name: string) => row(name).getByRole('cell').first();

	// Registered: green check + reset (not for one's own account).
	await expect(cell('hana')).toHaveAttribute('title', 'Registered');
	await expect(cell('hana').locator('svg')).toHaveCount(1);
	await expect(row('hana').getByRole('button', { name: 'Reset account' })).toHaveAttribute('title', 'Reset account');
	await expect(row('admin').getByRole('button')).toHaveCount(0);

	// Invited: no icon + copy link.
	await expect(cell('kenji').locator('svg')).toHaveCount(0);
	await expect(row('kenji').getByRole('button', { name: 'Copy invite link' })).toHaveAttribute(
		'title',
		'Copy invite link'
	);
	await expect(row('kenji').getByRole('button', { name: 'Reset account' })).toHaveCount(0);

	// Expired: red cross + reset instead of copy.
	await expect(cell('taro')).toHaveAttribute('title', 'Invitation expired');
	await expect(cell('taro').locator('svg')).toHaveCount(1);
	await expect(row('taro').getByRole('button', { name: 'Reset account' })).toBeVisible();
	await expect(row('taro').getByRole('button', { name: 'Copy invite link' })).toHaveCount(0);

	// Copy: the link is shown (and copied when the browser allows it).
	await page.route('/api/admin/users/3/invite', (r) =>
		r.fulfill({ json: { token: 'tok-123', expires_at: '2033-05-18T05:33:20+02:00' } })
	);
	await row('kenji').getByRole('button', { name: 'Copy invite link' }).click();
	await expect(page.getByLabel('Invitation link')).toHaveValue(/\/register#tok-123$/);

	// Reset of an expired invitation: no confirmation needed, new link shown.
	await page.route('/api/admin/users/4/reset', (r) =>
		r.fulfill({ json: { token: 'tok-456', expires_at: '2033-05-18T05:33:20+02:00' } })
	);
	await row('taro').getByRole('button', { name: 'Reset account' }).click();
	await expect(page.getByLabel('Invitation link')).toHaveValue(/\/register#tok-456$/);
});

test('registration with an invalid link explains what to do', async ({ page }) => {
	await page.route('/api/register/verify', (r) =>
		r.fulfill({ status: 404, json: { code: 'invite.invalid', detail: 'Invalid or expired invitation', params: {} } })
	);
	await page.goto('/register#made-up');
	await expect(page.getByRole('alert')).toHaveText('This invitation link is invalid or has expired.');
	await expect(page.getByText('Ask an administrator for a new invitation link.')).toBeVisible();
});
