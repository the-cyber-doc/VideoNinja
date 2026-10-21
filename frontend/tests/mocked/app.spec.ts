import { expect, test, type Page } from '@playwright/test';

// The API is faked: these tests check the pages only, in Chromium and WebKit.
const ADMIN = { username: 'admin', name: 'Sensei', role: 'admin', access: ['segment', 'user_mgmt'] };
const USER = { username: 'kenji', name: null, role: 'user', access: ['segment'] };

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
	await expect(page.getByRole('menuitem')).toHaveText(['Profile', 'Log out']);
	// Click outside closes it.
	await page.getByText('Logged in as').click();
	await expect(page.getByRole('menu')).toBeHidden();
});

test('menu with user management access', async ({ page }) => {
	await loggedInAs(page, ADMIN);
	await page.goto('/');
	await page.getByRole('button', { name: 'User menu' }).click();
	await expect(page.getByRole('menuitem')).toHaveText(['Profile', 'User Management', 'Log out']);
});

test('user management page is not reachable without access', async ({ page }) => {
	await loggedInAs(page, USER);
	await page.goto('/admin/users');
	await expect(page).toHaveURL('/');
});

test('user list: status icons and actions', async ({ page }) => {
	await loggedInAs(page, ADMIN);
	await page.route('/api/admin/roles', (r) =>
		r.fulfill({ json: [{ id: 'admin', name: 'Admin' }, { id: 'user', name: 'User' }] })
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
	await expect(row('hana').getByRole('button', { name: 'Reset account' })).toHaveAttribute(
		'title',
		'Reset account'
	);
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
		r.fulfill({ json: { token: 'tok-123', expires_s: 2_000_000_000 } })
	);
	await row('kenji').getByRole('button', { name: 'Copy invite link' }).click();
	await expect(page.getByLabel('Invitation link')).toHaveValue(/\/register#tok-123$/);

	// Reset of an expired invitation: no confirmation needed, new link shown.
	await page.route('/api/admin/users/4/reset', (r) =>
		r.fulfill({ json: { token: 'tok-456', expires_s: 2_000_000_000 } })
	);
	await row('taro').getByRole('button', { name: 'Reset account' }).click();
	await expect(page.getByLabel('Invitation link')).toHaveValue(/\/register#tok-456$/);
});

test('registration with an invalid link explains what to do', async ({ page }) => {
	await page.route('/api/register/verify', (r) =>
		r.fulfill({ status: 404, json: { detail: 'Invalid or expired invitation' } })
	);
	await page.goto('/register#made-up');
	await expect(page.getByRole('alert')).toHaveText('Invalid or expired invitation');
	await expect(page.getByText('Ask an administrator for a new invitation link.')).toBeVisible();
});
