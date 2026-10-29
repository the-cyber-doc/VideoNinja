import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const rules = JSON.parse(readFileSync(new URL('../../../server/app/validation.json', import.meta.url), 'utf8'));

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
	await expect(page.getByLabel('Username')).toHaveAttribute('maxlength', String(rules.username.max_length));
	await expect(page.getByLabel('Password')).toHaveAttribute('maxlength', String(rules.password.max_length));
});

test("a refused login says why, in the user's language, and clears the code", async ({ page }) => {
	await page.route('/api/auth/login', (r) =>
		r.fulfill({
			status: 401,
			json: { code: 'auth.invalid_credentials', detail: 'Invalid username, password or code', params: {} }
		})
	);
	await page.getByLabel('Username').fill('admin');
	await page.getByLabel('Password').fill('x'.repeat(rules.password.min_length));
	await page.getByLabel('Authenticator code').fill('123456');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByRole('alert')).toHaveText('Wrong username, password or code.');
	await expect(page.getByLabel('Authenticator code')).toHaveValue('');
	await page.evaluate(() => localStorage.setItem('lang', 'fr'));
	await page.reload();
	await page.getByLabel("Nom d'utilisateur").fill('admin');
	await page.getByLabel('Mot de passe').fill('x'.repeat(rules.password.min_length));
	await page.getByLabel(/Code/).fill('123456');
	await page.getByRole('button', { name: 'Se connecter' }).click();
	await expect(page.getByRole('alert')).toHaveText("Nom d'utilisateur, mot de passe ou code incorrect.");
});

test("too many failed attempts (429): the wait, in the user's language", async ({ page }) => {
	await page.route('/api/auth/login', (r) =>
		r.fulfill({
			status: 429,
			json: { code: 'throttled', detail: 'Too many failed attempts, try again in 11 min', params: { minutes: 11 } },
			headers: { 'Retry-After': '601' }
		})
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
	[
		'nginx rate limit (429 "rate_limited")',
		429,
		{ code: 'rate_limited', detail: 'Too many requests', params: {} },
		'Too many requests at once. Try again in a moment.',
		'Trop de requêtes à la fois. Réessayez dans un instant.'
	],
	[
		'every password check busy (503 "busy")',
		503,
		{ code: 'busy', detail: 'The server is busy, try again in a moment', params: {} },
		'The server is busy. Try again in a moment.',
		'Le serveur est occupé. Réessayez dans un instant.'
	],
	[
		'an error this version does not know (a newer server)',
		409,
		{ code: 'auth.something_new', detail: 'New', params: {} },
		'The server refused the request (HTTP 409).',
		'Le serveur a refusé la requête (HTTP 409).'
	],
	[
		"an answer without JSON (a proxy's page)",
		502,
		'<html>Bad Gateway</html>',
		'The server refused the request (HTTP 502).',
		'Le serveur a refusé la requête (HTTP 502).'
	]
] as const) {
	test(`${name}: said in the user's language`, async ({ page }) => {
		await page.route('/api/auth/login', (r) =>
			typeof body === 'string'
				? r.fulfill({ status, body, contentType: 'text/html' })
				: r.fulfill({ status, json: body, headers: { 'Retry-After': '5' } })
		);
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

test('a server failure shows its request ID to quote; a refusal does not', async ({ page }) => {
	const ID = '0123456789abcdef0123456789abcdef';
	let status = 500;
	await page.route('/api/auth/login', (r) =>
		r.fulfill(
			status === 500
				? { status, json: { code: 'internal', detail: 'Internal error', params: {} }, headers: { 'X-Request-ID': ID } }
				: {
						status,
						json: { code: 'auth.invalid_credentials', detail: '…', params: {} },
						headers: { 'X-Request-ID': ID }
					}
		)
	);
	const logIn = async () => {
		await page.getByLabel('Username').fill('admin');
		await page.getByLabel('Password').fill('x'.repeat(rules.password.min_length));
		await page.getByLabel('Authenticator code').fill('123456');
		await page.getByRole('button', { name: 'Log in' }).click();
	};
	await logIn();
	const alert = page.getByRole('alert');
	await expect(alert).toContainText('Something went wrong on the server. Try again later.');
	await expect(alert).toContainText(`Reference: ${ID}`);
	status = 401;
	await logIn();
	await expect(alert).toHaveText('Wrong username, password or code.'); // a 4xx: no reference
});

test('not set up yet: redirects to the setup wizard', async ({ page }) => {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: false } }));
	await page.goto('/login');
	await expect(page).toHaveURL('/setup');
});
