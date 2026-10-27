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

test('too many failed attempts (429): the wait, in the user\'s language', async ({ page }) => {
	await page.route('/api/auth/login', (r) =>
		r.fulfill({ status: 429, json: { detail: 'Too many failed attempts' }, headers: { 'Retry-After': '601' } })
	);
	const logIn = async (button: string) => {
		await page.getByLabel(/Username|Nom d'utilisateur/).fill('admin');
		await page.getByLabel(/Password|Mot de passe/).fill('x'.repeat(rules.password.min_length));
		await page.getByLabel(/Authenticator code|Code/).fill('123456');
		await page.getByRole('button', { name: button }).click();
	};
	await logIn('Log in');
	await expect(page.getByRole('alert')).toHaveText('Too many failed attempts. Try again in 11 min.');
	await page.evaluate(() => localStorage.setItem('lang', 'fr'));
	await page.reload();
	await logIn('Se connecter');
	await expect(page.getByRole('alert')).toHaveText('Trop de tentatives échouées. Réessayez dans 11 min.');
});

for (const [name, status, body, en, fr] of [
	['nginx rate limit (429 "Too many requests")', 429, { detail: 'Too many requests' }, 'Too many requests at once. Try again in a moment.', 'Trop de requêtes à la fois. Réessayez dans un instant.'],
	['every password check busy (503 + Retry-After)', 503, { detail: 'The server is busy, try again in a moment' }, 'The server is busy. Try again in a moment.', 'Le serveur est occupé. Réessayez dans un instant.']
] as const) {
	test(`${name}: said in the user's language`, async ({ page }) => {
		await page.route('/api/auth/login', (r) => r.fulfill({ status, json: body, headers: { 'Retry-After': '5' } }));
		const logIn = async (button: string) => {
			await page.getByLabel(/Username|Nom d'utilisateur/).fill('admin');
			await page.getByLabel(/Password|Mot de passe/).fill('x'.repeat(rules.password.min_length));
			await page.getByLabel(/Authenticator code|Code/).fill('123456');
			await page.getByRole('button', { name: button }).click();
		};
		await logIn('Log in');
		await expect(page.getByRole('alert')).toHaveText(en);
		await page.evaluate(() => localStorage.setItem('lang', 'fr'));
		await page.reload();
		await logIn('Se connecter');
		await expect(page.getByRole('alert')).toHaveText(fr);
	});
}

test('not set up yet: redirects to the setup wizard', async ({ page }) => {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: false } }));
	await page.goto('/login');
	await expect(page).toHaveURL('/setup');
});
