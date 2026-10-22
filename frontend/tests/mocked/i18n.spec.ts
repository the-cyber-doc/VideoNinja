import { expect, test, type Page } from '@playwright/test';

// The API is faked: the UI language, the language menu, and the language sent to the API.
async function loggedIn(page: Page) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => {
		const fr = r.request().headers()['accept-language'] === 'fr';
		r.fulfill({
			json: {
				username: 'kenji',
				name: null,
				role: 'user',
				role_name: fr ? 'Utilisateur' : 'User',
				access: ['segment']
			}
		});
	});
}

test('English by default, switch to French from the flag menu, remembered', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/');
	await expect(page.getByText('Logged in as kenji (User).')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');

	const flag = page.getByRole('button', { name: 'Language: English' });
	await flag.click();
	const choices = page.getByRole('menuitemradio');
	await expect(choices).toHaveText(['English', 'Français']);
	await expect(choices.first()).toHaveAttribute('aria-checked', 'true');
	await expect(choices.locator('svg')).toHaveCount(2); // a flag each

	await page.getByRole('menuitemradio', { name: 'Français' }).click();
	await expect(page.getByRole('menu')).toBeHidden();
	// UI strings switch at once; the role name is reloaded in French from the API.
	await expect(page.getByText('Connecté en tant que kenji (Utilisateur).')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await page.getByRole('button', { name: 'Menu utilisateur' }).click();
	await expect(page.getByRole('menuitem')).toHaveText(['Profil', 'Se déconnecter']);

	await page.reload();
	await expect(page.getByRole('button', { name: 'Langue : Français' })).toBeVisible();
});

test.describe('French browser', () => {
	test.use({ locale: 'fr-FR' });

	test('follows the browser language', async ({ page }) => {
		await loggedIn(page);
		await page.goto('/');
		await expect(page.getByText('Connecté en tant que kenji (Utilisateur).')).toBeVisible();
	});

	test('the login page too', async ({ page }) => {
		await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
		await page.goto('/login');
		await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
	});
});

test.describe('unsupported browser language', () => {
	test.use({ locale: 'de-DE' });

	test('falls back to English', async ({ page }) => {
		await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
		await page.goto('/login');
		await expect(page.getByRole('heading', { name: 'Log in' })).toBeVisible();
	});
});
