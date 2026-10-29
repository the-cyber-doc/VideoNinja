import { expect, test } from '@playwright/test';

// The API is faked: these tests check the page only, in Chromium and WebKit.
const ME = { username: 'kenji', name: 'Kenji', role: 'user', role_name: 'User', access: ['segment'] };

test.beforeEach(async ({ page }) => {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
});

test('not logged in: redirects to login', async ({ page }) => {
	await page.route('/api/auth/me', (r) =>
		r.fulfill({ status: 401, json: { code: 'auth.not_logged_in', detail: 'Not logged in', params: {} } })
	);
	await page.goto('/profile');
	await expect(page).toHaveURL('/login');
});

test.describe('logged in', () => {
	test.beforeEach(async ({ page }) => {
		await page.route('/api/auth/me', (r) => r.fulfill({ json: ME }));
		await page.goto('/profile');
	});

	test('shows the username, read-only, and the current name', async ({ page }) => {
		await expect(page.getByText('Username: kenji')).toBeVisible();
		await expect(page.getByRole('region', { name: 'Display name' }).getByLabel('Name')).toHaveValue('Kenji');
	});

	test('new passwords must match, nothing is sent', async ({ page }) => {
		let sent = false;
		await page.route('/api/profile/password', (r) => {
			sent = true;
			return r.fulfill({ status: 204 });
		});
		const section = page.getByRole('region', { name: 'Password' });
		await section.getByLabel('Current password').fill('x'.repeat(12));
		await section.getByLabel(/^New password/).fill('a'.repeat(12));
		await section.getByLabel('Confirm new password').fill('b'.repeat(12));
		await section.getByRole('button', { name: 'Change password' }).click();
		await expect(section.getByRole('alert')).toHaveText('The new passwords do not match.');
		expect(sent).toBe(false);
	});

	test('new authenticator: cancel keeps the current one', async ({ page }) => {
		await page.route('/api/profile/totp', (r) =>
			r.fulfill({ json: { secret: 'A'.repeat(32), uri: 'otpauth://x', qr: 'data:,' } })
		);
		const section = page.getByRole('region', { name: 'Authenticator' });
		await section.getByRole('button', { name: 'Set up a new authenticator' }).click();
		await section.getByLabel('Code from the new app').fill('123 456');
		await expect(section.getByLabel('Code from the new app')).toHaveValue('123456');
		await section.getByRole('button', { name: 'Cancel' }).click();
		await expect(section.getByRole('button', { name: 'Set up a new authenticator' })).toBeVisible();
	});
});
