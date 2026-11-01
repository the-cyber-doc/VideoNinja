import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Cookie, type Locator, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

// The Options page on the real backend, after account.spec.ts (project "options": it
// depends on "e2e", whose admin it logs in as: .e2e/admin.json). Serial: the tests
// build on each other (one tag created, changed, then deleted).
test.describe.configure({ mode: 'serial' });

// The admin logs in once, every test reuses the session: on the real stack, nginx limits
// credential POSTs (60/min, burst 30), and account.spec.ts has used most of them.
let adminCookies: Cookie[] = [];

test.beforeAll(async ({ browser }) => {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		ignoreHTTPSErrors: true,
		locale: 'en-US'
	});
	await logIn(await context.newPage());
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

interface Account {
	username: string;
	password: string;
	totpSecret: string;
}

async function logIn(page: Page, account?: Account) {
	const who: Account = account ?? JSON.parse(readFileSync('.e2e/admin.json', 'utf8'));
	await page.goto('login');
	await page.getByLabel('Username').fill(who.username);
	await page.getByLabel('Password').fill(who.password);
	await page.getByLabel('Authenticator code').fill(new TOTP({ secret: who.totpSecret }).generate());
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByText('Logged in as')).toBeVisible();
}

const tag = (page: Page, name: string): Locator =>
	page.locator('details.tag', { has: page.locator('summary', { hasText: name }) });

async function openTag(page: Page, name: string): Promise<Locator> {
	const found = tag(page, name);
	await found.locator('summary').click();
	return found;
}

/** The tags as the upload page gets them (its rules). */
async function uploadTags(page: Page) {
	const res = await page.request.get('api/tags');
	expect(res.status()).toBe(200);
	return Object.fromEntries((await res.json()).map((t: { id: string }) => [t.id, t]));
}

test('Options from the user menu: the seeded tags and their formats', async ({ page }) => {
	await page.goto('./');
	await page.getByRole('button', { name: 'User menu' }).click();
	await page.getByRole('menu').getByRole('menuitem', { name: 'Options' }).click();
	await expect(page).toHaveURL('options');
	await expect(page.getByRole('heading', { name: 'Tags' })).toBeVisible();
	await expect(page.locator('details.tag summary')).toHaveText([
		/Country\s*country\s*One of a list/,
		/Event\s*event\s*One of a list/,
		/Location\s*location\s*One of a list/,
		/Source\s*source\s*One of a list/,
		/Year\s*year\s*Text matching a regular expression/
	]);
	const year = await openTag(page, 'Year');
	await expect(year.getByLabel('Expression', { exact: true })).toHaveValue('[12][0-9]{3}');
	await expect(year.getByLabel('Keyboard')).toHaveValue('numeric');
	await expect(year.getByLabel('Hint (English)')).toHaveValue('A year, e.g. 2024');
	const tryIt = year.getByLabel('Try a value');
	await tryIt.fill('1987');
	await expect(year.getByRole('status')).toHaveText('Accepted.');
	await tryIt.fill('3000');
	await expect(year.getByRole('status')).toHaveText('Year: the value does not have the expected form.');

	const country = await openTag(page, 'Country');
	await expect(country.getByRole('group', { name: 'Values (249)' })).toBeVisible();
	await country.getByLabel('Filter the values').fill('suisse');
	await expect(country.locator('.value')).toHaveCount(1);
	await expect(country.locator('.value').getByLabel('Value ID')).toHaveValue('CHE');
	await expect(country.getByText('tag_value.country.CHE.name')).toBeVisible();
});

test('create a list tag: translation IDs follow the IDs, saved in the database', async ({ page }) => {
	await page.goto('options');
	await page.getByRole('button', { name: 'New tag' }).click();
	const venue = page.locator('details.tag').first();
	await venue.getByLabel('ID', { exact: true }).fill('venue');
	await expect(venue.getByText('tag.venue.name')).toBeVisible();
	await venue.getByLabel('Name (English)').fill('Venue');
	await venue.getByLabel('Name (Français)').fill('Salle');
	for (const [id, en, fr] of [
		['hall', 'Hall', 'Gymnase'],
		['park', 'Park', 'Parc']
	]) {
		await venue.getByRole('button', { name: 'Add a value' }).click();
		const value = venue.locator('.value').last();
		await value.getByLabel('Value ID').fill(id);
		await expect(value.getByText(`tag_value.venue.${id}.name`)).toBeVisible();
		await value.getByLabel('Name (English)').fill(en);
		await value.getByLabel('Name (Français)').fill(fr);
	}
	await venue.getByRole('button', { name: 'Save' }).click();
	await expect(venue.getByRole('status')).toHaveText('Saved.');

	await page.reload();
	const saved = await openTag(page, 'Venue');
	await expect(saved.locator('.value')).toHaveCount(2);
	await expect(saved.locator('.value').nth(0).getByLabel('Value ID')).toHaveValue('hall');
	await expect(saved.locator('.value').nth(1).getByLabel('Value ID')).toHaveValue('park');
	const tags = await uploadTags(page);
	expect(tags.venue).toEqual({
		id: 'venue',
		name: 'Venue',
		format: 'list',
		input_mode: 'text',
		values: [
			{ id: 'hall', name: 'Hall' },
			{ id: 'park', name: 'Park' }
		]
	});
});

test('rename a value: its translation ID follows', async ({ page }) => {
	await page.goto('options');
	const venue = await openTag(page, 'Venue');
	const park = venue.locator('.value').nth(1);
	await park.getByLabel('Value ID').fill('garden');
	await expect(park.getByText('tag_value.venue.garden.name')).toBeVisible();
	await park.getByLabel('Name (English)').fill('Garden');
	await venue.getByRole('button', { name: 'Save' }).click();
	await expect(venue.getByRole('status')).toHaveText('Saved.');
	await page.reload();
	expect((await uploadTags(page)).venue.values).toEqual([
		{ id: 'garden', name: 'Garden' },
		{ id: 'hall', name: 'Hall' }
	]);
});

test('switch to a regular expression: refused until valid, the test field, saved', async ({ page }) => {
	await page.goto('options');
	const venue = await openTag(page, 'Venue');
	await venue.getByLabel('Value', { exact: true }).selectOption({ label: 'Text matching a regular expression' });
	const regexp = venue.getByLabel('Expression', { exact: true });
	const save = venue.getByRole('button', { name: 'Save' });
	await expect(save).toBeDisabled(); // empty
	await regexp.fill('room-[0-9');
	await expect(venue.getByText('This is not a valid regular expression.')).toBeVisible();
	await expect(save).toBeDisabled();
	await regexp.fill('room-[0-9]+');
	await expect(save).toBeEnabled();

	const tryIt = venue.getByLabel('Try a value');
	await tryIt.fill('room-12');
	await expect(venue.getByRole('status')).toHaveText('Accepted.');
	await tryIt.fill('hall');
	await expect(venue.getByRole('status')).toHaveText('Venue: the value does not have the expected form.');

	await venue.getByLabel('Hint (English)').fill('room-<number>');
	await venue.getByLabel('Hint (Français)').fill('room-<numéro>');
	await save.click();
	await expect(venue.getByText('Saved.')).toBeVisible();
	await page.reload();
	await expect(tag(page, 'Venue').locator('summary')).toContainText('Text matching a regular expression');
	expect((await uploadTags(page)).venue).toEqual({
		id: 'venue',
		name: 'Venue',
		format: 'regexp',
		pattern: 'room-[0-9]+',
		hint: 'room-<number>',
		input_mode: 'text'
	});
});

test('the server checks again what the page lets through', async ({ page }) => {
	// Sent by hand: a name missing in a language, an ID already taken.
	const bad = await page.request.put('api/admin/tags/venue', {
		data: { id: 'venue', names: { en: 'Venue' }, format: null }
	});
	expect((await bad.json()).code).toBe('validation.translations');
	const taken = await page.request.put('api/admin/tags/venue', {
		data: { id: 'year', names: { en: 'Venue', fr: 'Salle' }, format: null }
	});
	expect([taken.status(), (await taken.json()).code]).toEqual([409, 'tag.exists']);
});

test('delete the tag', async ({ page }) => {
	page.on('dialog', (d) => d.accept());
	await page.goto('options');
	const venue = await openTag(page, 'Venue');
	await venue.getByRole('button', { name: 'Delete the tag' }).click();
	await expect(tag(page, 'Venue')).toHaveCount(0);
	await page.reload();
	await expect(page.locator('details.tag')).toHaveCount(5);
	expect((await uploadTags(page)).venue).toBeUndefined();
});

/** A user with the "user" role, registered through the API (an invitation, then the registration). */
async function newUser(page: Page, browser: Browser, baseURL?: string): Promise<Page> {
	const username = `hana${Date.now() % 100000}`;
	const invite = await (await page.request.post('api/admin/users', { data: { username, role: 'user' } })).json();
	const { secret } = await (await page.request.post('api/register/totp', { data: { token: invite.token } })).json();
	const account = { username, password: 'hana long password', totpSecret: secret };
	const done = await page.request.post('api/register/complete', {
		data: {
			token: invite.token,
			password: account.password,
			totp_secret: secret,
			totp_code: new TOTP({ secret }).generate()
		}
	});
	expect(done.status()).toBe(204);
	// A context of its own (test.use's storageState applies to the test's context only).
	const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: true, locale: 'en-US' });
	const other = await context.newPage();
	await logIn(other, account);
	return other;
}

test('without the options access: no menu entry, no page, 403', async ({ page, browser, baseURL }) => {
	const hana = await newUser(page, browser, baseURL);
	await hana.getByRole('button', { name: 'User menu' }).click();
	await expect(hana.getByRole('menu').getByRole('menuitem')).toHaveText(['Profile', 'About', 'Log out']);
	await hana.goto('options');
	await expect(hana).toHaveURL('./');
	expect((await hana.request.get('api/admin/tags')).status()).toBe(403);
	expect((await hana.request.delete('api/admin/tags/year')).status()).toBe(403);
	await hana.context().close();
});
