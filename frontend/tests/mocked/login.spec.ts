import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const rules = JSON.parse(
	readFileSync(new URL('../../../server/app/validation.json', import.meta.url), 'utf8')
);

// The API is faked: these tests check the page only, in Chromium and WebKit.
test.beforeEach(async ({ page }) => {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.goto('/login');
});

test('a pasted TOTP code keeps its digits only', async ({ page }) => {
	const code = page.getByLabel('Authenticator code');
	await code.fill('123 456');
	await expect(code).toHaveValue('123456');
	await code.fill('12-34 56 78');
	await expect(code).toHaveValue('123456');
});

test('fields follow the shared length rules', async ({ page }) => {
	await expect(page.getByLabel('Username')).toHaveAttribute(
		'maxlength',
		String(rules.username.max_length)
	);
	await expect(page.getByLabel('Password')).toHaveAttribute(
		'maxlength',
		String(rules.password.max_length)
	);
});

test('a refused login shows the server message and clears the code', async ({ page }) => {
	await page.route('/api/auth/login', (r) =>
		r.fulfill({ status: 401, json: { detail: 'Invalid credentials' } })
	);
	await page.getByLabel('Username').fill('admin');
	await page.getByLabel('Password').fill('x'.repeat(rules.password.min_length));
	await page.getByLabel('Authenticator code').fill('123456');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByRole('alert')).toHaveText('Invalid credentials');
	await expect(page.getByLabel('Authenticator code')).toHaveValue('');
});

test('not set up yet: redirects to the setup wizard', async ({ page }) => {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: false } }));
	await page.goto('/login');
	await expect(page).toHaveURL('/setup');
});
