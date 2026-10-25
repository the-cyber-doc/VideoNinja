import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

// Real backend (tests/e2e/backend.sh), fresh database: the tests depend on each other.
test.describe.configure({ mode: 'serial' });

interface Account {
	username: string;
	password: string;
	totpSecret: string;
}
const admin: Account = { username: 'admin', password: 'correct horse battery', totpSecret: '' };
const kenji: Account = { username: 'kenji', password: "kenji's long password", totpSecret: '' };
let inviteLink = '';

const code = (account: Account) => new TOTP({ secret: account.totpSecret }).generate();

function setupToken(): string {
	const match = readFileSync('.e2e/server.log', 'utf8').match(/Setup token: (\S+)/);
	if (!match) throw new Error('No setup token in .e2e/server.log');
	return match[1];
}

async function fillLogin(page: Page, account: Account, password = account.password) {
	await page.goto('/login');
	await page.getByLabel('Username').fill(account.username);
	await page.getByLabel('Password').fill(password);
	await page.getByLabel('Authenticator code').fill(account.totpSecret ? code(account) : '123456');
	await page.getByRole('button', { name: 'Log in' }).click();
}

async function logIn(page: Page, account = admin) {
	await fillLogin(page, account);
	await expect(page.getByText('Logged in as')).toBeVisible();
}

async function openMenu(page: Page) {
	await page.getByRole('button', { name: 'User menu' }).click();
	return page.getByRole('menu');
}

async function logOut(page: Page) {
	await (await openMenu(page)).getByRole('menuitem', { name: 'Log out' }).click();
	await expect(page).toHaveURL('/login');
}

/** Fill the account + authenticator steps of the wizard; return the TOTP secret. */
async function createAccount(page: Page, password: string): Promise<string> {
	await page.getByLabel('Password (at least').fill(password);
	await page.getByLabel('Confirm password').fill(password);
	await page.getByRole('button', { name: 'Continue' }).click();

	const secret = (await page.locator('code.secret').textContent()) ?? '';
	expect(secret).toMatch(/^[A-Z2-7]{32}$/);
	// As copied from an authenticator app: "123 456".
	const typed = new TOTP({ secret }).generate();
	await page.getByLabel('Authenticator code').fill(`${typed.slice(0, 3)} ${typed.slice(3)}`);
	await page.getByRole('button', { name: 'Create' }).click();
	return secret;
}

test('setup wizard creates the admin account', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL('/setup');

	await page.getByLabel('Setup token').fill(setupToken());
	await page.getByRole('button', { name: 'Continue' }).click();
	admin.totpSecret = await createAccount(page, admin.password);

	// Builds the whole database (schema, catalogue, admin): more than 5 s on a busy CI runner.
	await expect(page.getByText('Video Ninja is ready')).toBeVisible({ timeout: 30_000 });
});

test('setup is closed afterwards', async ({ request }) => {
	const res = await request.post('/api/setup/verify', { data: { token: 'anything' } });
	expect(res.status()).toBe(404);
});

test('media requests reach the backend (as nginx does in production)', async ({ request }) => {
	// Not logged in: the app's 401 (JSON), not a 404 page from the frontend server.
	const res = await request.get('/media/segment/1/thumbnail');
	expect(res.status()).toBe(401);
	expect(await res.json()).toEqual({ detail: 'Not logged in' });
});

test('wrong password is refused', async ({ page }) => {
	await fillLogin(page, admin, 'wrong password!');
	await expect(page.getByRole('alert')).toBeVisible();
	await expect(page).toHaveURL('/login');
});

test('log in, then log out from the user menu', async ({ page }) => {
	await logIn(page);
	await logOut(page);

	// The session is gone on the server too.
	await page.goto('/');
	await expect(page).toHaveURL('/login');
});

test('user menu: Profile first, User Management for admins, Log out last', async ({ page }) => {
	await logIn(page);
	const menu = await openMenu(page);
	await expect(menu.getByRole('menuitem')).toHaveText(['Profile', 'User Management', 'Log out']);
	await page.keyboard.press('Escape');
	await expect(menu).toBeHidden();
});

test('profile: change the display name', async ({ page }) => {
	await logIn(page);
	await (await openMenu(page)).getByRole('menuitem', { name: 'Profile' }).click();
	const section = page.getByRole('region', { name: 'Display name' });
	await section.getByLabel('Name').fill('Sensei');
	await section.getByRole('button', { name: 'Save name' }).click();
	await expect(section.getByRole('status')).toHaveText('Name saved.');

	await page.getByRole('link', { name: 'Video Ninja' }).click();
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

	await section.getByLabel('Current password').fill(admin.password);
	await section.getByRole('button', { name: 'Change password' }).click();
	await expect(section.getByRole('status')).toContainText('Password changed');
	admin.password = newPassword;

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
	expect(newSecret).not.toBe(admin.totpSecret);
	await section.getByLabel('Code from the new app').fill(new TOTP({ secret: newSecret }).generate());
	await section.getByLabel('Current password').fill(admin.password);
	await section.getByRole('button', { name: 'Confirm' }).click();
	await expect(section.getByRole('status')).toContainText('Authenticator replaced');
	admin.totpSecret = newSecret;

	await logOut(page);
	await logIn(page);
});

test('user management: create a user and get the invitation link', async ({ page }) => {
	await logIn(page);
	await (await openMenu(page)).getByRole('menuitem', { name: 'User Management' }).click();
	await expect(page).toHaveURL('/admin/users');

	await page.getByLabel('Username').fill(kenji.username);
	await page.getByLabel('Role').selectOption({ label: 'User' });
	await page.getByRole('button', { name: 'Create' }).click();

	inviteLink = await page.getByLabel('Invitation link').inputValue();
	expect(inviteLink).toMatch(/^https:\/\/localhost:\d+\/register#[\w-]{40,}$/);
	const row = page.getByRole('row', { name: /kenji/ });
	await expect(row).toContainText('Invitation pending');
	await expect(row.getByRole('button', { name: 'Copy invite link' })).toBeVisible();
	await expect(row.getByRole('button', { name: 'Reset account' })).toHaveCount(0);
});

test('an invited user without password and TOTP cannot log in', async ({ page }) => {
	for (const password of ['', "kenji's long password", 'x'.repeat(12)]) {
		await page.goto('/login');
		await page.getByLabel('Username').fill(kenji.username);
		await page.getByLabel('Password').fill(password || 'something');
		await page.getByLabel('Authenticator code').fill('123456');
		await page.getByRole('button', { name: 'Log in' }).click();
		await expect(page.getByRole('alert')).toBeVisible();
		await expect(page).toHaveURL('/login');
	}
});

test('the invitation link opens the registration wizard', async ({ page }) => {
	await page.goto(inviteLink);
	await expect(page.getByText('Username: kenji')).toBeVisible();
	await expect(page).toHaveURL('/register'); // token removed from the address bar
	kenji.totpSecret = await createAccount(page, kenji.password);
	await expect(page.getByText('Your account is ready')).toBeVisible();

	// Single use (opened afresh, as from an e-mail).
	await page.goto('about:blank');
	await page.goto(inviteLink);
	await expect(page.getByRole('alert')).toHaveText('Invalid or expired invitation');
});

test('a user without user management access sees no menu entry and gets 403', async ({ page }) => {
	await logIn(page, kenji);
	const menu = await openMenu(page);
	await expect(menu.getByRole('menuitem')).toHaveText(['Profile', 'Log out']);

	await page.goto('/admin/users');
	await expect(page).toHaveURL('/');
	expect((await page.request.get('/api/admin/users')).status()).toBe(403);
	expect((await page.request.post('/api/admin/users', { data: { username: 'evil', role: 'admin' } })).status()).toBe(403);
});

test('user management: reset a registered account', async ({ page }) => {
	await logIn(page);
	await page.goto('/admin/users');
	const row = page.getByRole('row', { name: /kenji/ });
	await expect(row).toContainText('Registered');
	// Own account: no reset button.
	await expect(page.getByRole('row', { name: /admin/ }).getByRole('button')).toHaveCount(0);

	page.once('dialog', (dialog) => dialog.accept());
	await row.getByRole('button', { name: 'Reset account' }).click();
	await expect(row).toContainText('Invitation pending');
	await expect(page.getByLabel('Invitation link')).toHaveValue(/\/register#/);

	// The old credentials no longer work.
	await logOut(page);
	await fillLogin(page, kenji);
	await expect(page.getByRole('alert')).toBeVisible();
});

test('comments: add, edit and delete my own, saved in the database', async ({ page }) => {
	page.on('dialog', (d) => d.accept());
	await logIn(page);
	await page.goto('/schools/gyokko/taijutsu/jo_ryaku/koku');
	const comments = page.locator('.comment');
	await expect(page.getByText('No comments yet.')).toBeVisible();

	await page.getByRole('button', { name: 'Add a comment' }).click();
	await page.getByPlaceholder('Your comment').fill('Très bien, 二回目');
	await page.getByLabel('Language of the comment').selectOption({ label: 'Français' });
	await page.getByRole('button', { name: 'Save' }).click();
	await expect(comments).toHaveCount(1);
	await page.reload(); // stored by the server
	await expect(comments).toHaveText([/Sensei.*Très bien, 二回目/]); // display name set by the profile test
	await expect(comments.getByRole('img', { name: 'Language: Français' })).toBeVisible();
	await expect(comments).not.toContainText('(edited)');

	// Times are kept to the second: an edit within the same second as the
	// creation would not be told apart ("(edited)").
	await page.waitForTimeout(1100);
	await comments.getByRole('button', { name: 'Edit' }).click();
	await comments.getByPlaceholder('Your comment').fill('Encore mieux');
	await comments.getByRole('button', { name: 'Save' }).click();
	await page.reload();
	await expect(comments).toHaveText([/Encore mieux.*/]);
	await expect(comments).toContainText('(edited)');

	await comments.getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByText('No comments yet.')).toBeVisible();
	await page.reload();
	await expect(page.getByText('No comments yet.')).toBeVisible();
});
