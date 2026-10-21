import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

// Real backend (tests/e2e/backend.sh), fresh database: the tests depend on each other.
test.describe.configure({ mode: 'serial' });

const USERNAME = 'admin';
let password = 'correct horse battery';
let totpSecret = '';

const code = () => new TOTP({ secret: totpSecret }).generate();

function setupToken(): string {
	const match = readFileSync('.e2e/server.log', 'utf8').match(/Setup token: (\S+)/);
	if (!match) throw new Error('No setup token in .e2e/server.log');
	return match[1];
}

async function logIn(page: Page) {
	await page.goto('/login');
	await page.getByLabel('Username').fill(USERNAME);
	await page.getByLabel('Password').fill(password);
	await page.getByLabel('Authenticator code').fill(code());
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByText(`Logged in as`)).toBeVisible();
}

async function logOut(page: Page) {
	await page.goto('/');
	await page.getByRole('button', { name: 'Log out' }).click();
	await expect(page).toHaveURL('/login');
}

test('setup wizard creates the admin account', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL('/setup');

	await page.getByLabel('Setup token').fill(setupToken());
	await page.getByRole('button', { name: 'Continue' }).click();

	await page.getByLabel('Password (at least').fill(password);
	await page.getByLabel('Confirm password').fill(password);
	await page.getByRole('button', { name: 'Continue' }).click();

	totpSecret = (await page.locator('code.secret').textContent()) ?? '';
	expect(totpSecret).toMatch(/^[A-Z2-7]{32}$/);
	// As copied from an authenticator app: "123 456".
	const typed = code();
	await page.getByLabel('Authenticator code').fill(`${typed.slice(0, 3)} ${typed.slice(3)}`);
	await page.getByRole('button', { name: 'Create' }).click();

	await expect(page.getByText('Video Ninja is ready')).toBeVisible();
});

test('setup is closed afterwards', async ({ request }) => {
	const res = await request.post('/api/setup/verify', { data: { token: 'anything' } });
	expect(res.status()).toBe(404);
});

test('wrong password is refused', async ({ page }) => {
	await page.goto('/login');
	await page.getByLabel('Username').fill(USERNAME);
	await page.getByLabel('Password').fill('wrong password!');
	await page.getByLabel('Authenticator code').fill(code());
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page).toHaveURL('/login');
});

test('log in, then log out', async ({ page }) => {
	await logIn(page);
	await page.getByRole('button', { name: 'Log out' }).click();
	await expect(page).toHaveURL('/login');

	// The session is gone on the server too.
	await page.goto('/');
	await expect(page).toHaveURL('/login');
});

test('profile: change the display name', async ({ page }) => {
	await logIn(page);
	await page.getByRole('link', { name: 'Profile' }).click();
	const section = page.getByRole('region', { name: 'Display name' });
	await section.getByLabel('Name').fill('Sensei');
	await section.getByRole('button', { name: 'Save name' }).click();
	await expect(section.getByRole('status')).toHaveText('Name saved.');

	await page.goto('/');
	await expect(page.getByText('Logged in as Sensei')).toBeVisible();
});

test('profile: change the password', async ({ page }) => {
	await logIn(page);
	await page.goto('/profile');
	const section = page.getByRole('region', { name: 'Password' });
	const newPassword = 'another long passphrase';

	await section.getByLabel('Current password').fill('wrong password!');
	await section.getByLabel(/^New password/).fill(newPassword);
	await section.getByLabel('Confirm new password').fill(newPassword);
	await section.getByRole('button', { name: 'Change password' }).click();
	await expect(section.getByRole('alert')).toHaveText('Wrong current password');

	await section.getByLabel('Current password').fill(password);
	await section.getByRole('button', { name: 'Change password' }).click();
	await expect(section.getByRole('status')).toContainText('Password changed');
	password = newPassword;

	await logOut(page);
	await logIn(page);
});

test('profile: replace the authenticator', async ({ page }) => {
	await logIn(page);
	await page.goto('/profile');
	const section = page.getByRole('region', { name: 'Authenticator' });
	await section.getByRole('button', { name: 'Set up a new authenticator' }).click();

	const newSecret = (await section.locator('code.secret').textContent()) ?? '';
	expect(newSecret).toMatch(/^[A-Z2-7]{32}$/);
	expect(newSecret).not.toBe(totpSecret);
	await section.getByLabel('Code from the new app').fill(new TOTP({ secret: newSecret }).generate());
	await section.getByLabel('Current password').fill(password);
	await section.getByRole('button', { name: 'Confirm' }).click();
	await expect(section.getByRole('status')).toContainText('Authenticator replaced');
	totpSecret = newSecret;

	await logOut(page);
	await logIn(page);
});
