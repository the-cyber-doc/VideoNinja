import { readFileSync } from 'node:fs';
import {
	expect,
	test,
	type APIRequestContext,
	type APIResponse,
	type Browser,
	type BrowserContext,
	type Cookie,
	type Locator,
	type Page
} from '@playwright/test';
import { TOTP } from 'otpauth';

// The real containers only (tools/test-e2e-stack.sh), project "videos": the Videos page's
// filter and sort on videos really uploaded (tusd), encoded (encoder) and published, by
// two users, tagged through the API. Every sort and every kind of filter. Before
// tests/stack/upload.spec.ts (project "stack" depends on this one): these three videos
// are then the only ones, and its last tests use up the address's login budget.
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000); // three encodings, on a slow machine

const PLAYER = 'video:not([aria-hidden="true"])'; // not the editor's hidden measuring video
// Three clips (VP9, no audio), uploaded in this order: A by Aiko, B by Ren, C by Aiko.
const A = 'clip-6s.webm';
const B = 'clip-9s.webm';
const C = 'clip-12s.webm';

interface Account {
	username: string;
	password: string;
	totpSecret: string;
}

let adminCookies: Cookie[] = [];

/**
 * A credential POST (login, registration) through nginx's limit (60/min, burst 30), which
 * the earlier projects have mostly used up: on its 429, waits as Retry-After says and
 * tries again. `data` is made again for each try (a TOTP code may have expired).
 */
async function credentialPost(request: APIRequestContext, path: string, data: () => object): Promise<APIResponse> {
	for (let attempt = 0; ; attempt++) {
		const res = await request.post(path, { data: data() });
		if (res.status() !== 429 || attempt === 20) return res;
		await new Promise((done) => setTimeout(done, Number(res.headers()['retry-after'] ?? 5) * 1000));
	}
}

/** A context of its own, logged in through the API (its session cookie kept by the context). */
async function loggedIn(browser: Browser, who: Account): Promise<BrowserContext> {
	const context = await browser.newContext({
		baseURL: test.info().project.use.baseURL,
		ignoreHTTPSErrors: true,
		locale: 'en-US'
	});
	const res = await credentialPost(context.request, 'api/auth/login', () => ({
		username: who.username,
		password: who.password,
		totp_code: new TOTP({ secret: who.totpSecret }).generate()
	}));
	expect(res.status()).toBe(200);
	return context;
}

// The admin (left by tests/e2e/account.spec.ts: its last password and authenticator) logs
// in once, every test reuses the session.
test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, JSON.parse(readFileSync('.e2e/admin.json', 'utf8')));
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

/** An uploader, invited and registered through the API, logged in in a context of its own. */
async function uploader(page: Page, browser: Browser, username: string, name: string): Promise<Page> {
	const invite = await page.request.post('api/admin/users', { data: { username, role: 'uploader' } });
	expect(invite.status()).toBe(201);
	const { token } = await invite.json();
	const enrol = await credentialPost(page.request, 'api/register/totp', () => ({ token }));
	expect(enrol.status()).toBe(200);
	const { secret } = await enrol.json();
	const account = { username, password: `${username}'s long password`, totpSecret: secret };
	const done = await credentialPost(page.request, 'api/register/complete', () => ({
		token,
		name,
		password: account.password,
		totp_secret: secret,
		totp_code: new TOTP({ secret }).generate()
	}));
	expect(done.status()).toBe(204);
	return (await loggedIn(browser, account)).newPage();
}

/** Uploaded as a video without technique (no segment to define). */
async function upload(page: Page, file: string) {
	await page.goto('upload');
	await page.getByLabel('Video file').setInputFiles(`tests/fixtures/${file}`);
	await expect(page.locator(PLAYER)).toBeVisible();
	await page.getByLabel('This video does not contain any technique segment').check();
	await page.getByRole('button', { name: 'Proceed' }).click();
	await expect(page.getByRole('status')).toContainText('Uploaded.', { timeout: 60_000 });
}

test('three videos uploaded by two users, encoded, published, tagged', async ({ page, browser }) => {
	// Tags of the kinds the seeded ones lack: free text, numeric free text, without value.
	for (const data of [
		{ id: 'e2e_note', names: { en: 'Note', fr: 'Note' }, format: 'free' },
		{ id: 'e2e_level', names: { en: 'Level', fr: 'Niveau' }, format: 'free', input_mode: 'numeric', min: 1, max: 9 },
		{ id: 'e2e_flag', names: { en: 'Flag', fr: 'Drapeau' }, format: null }
	]) {
		expect((await page.request.post('api/admin/tags', { data })).status()).toBe(201);
	}

	const aiko = await uploader(page, browser, 'aiko', 'Aiko');
	const ren = await uploader(page, browser, 'ren', 'Ren');
	await upload(aiko, A);
	await upload(ren, B);
	await upload(aiko, C);
	await aiko.context().close();
	await ren.context().close();

	// Encoded one after the other, then published.
	const published = async () =>
		(await (await page.request.get('api/videos')).json()) as { id: number; original_filename: string }[];
	await expect.poll(async () => (await published()).length, { timeout: 240_000, intervals: [2_000] }).toBe(3);
	const id = Object.fromEntries((await published()).map((v) => [v.original_filename, v.id]));

	const tags: Record<string, { id: string; value?: string }[]> = {
		[A]: [
			{ id: 'location', value: 'dojo' },
			{ id: 'year', value: '2019' },
			{ id: 'e2e_note', value: 'Ura gyaku' },
			{ id: 'e2e_level', value: '3' },
			{ id: 'e2e_flag' }
		],
		[B]: [
			{ id: 'location', value: 'outdoor' },
			{ id: 'year', value: '2024' },
			{ id: 'e2e_level', value: '7' }
		],
		[C]: [
			{ id: 'location', value: 'dojo' },
			{ id: 'e2e_note', value: 'Omote gyaku' }
		]
	};
	for (const [file, list] of Object.entries(tags)) {
		const saved = await page.request.put(`api/videos/${id[file]}/annotations`, {
			data: { all_segments_done: true, tags: list, segments: [] }
		});
		expect(saved.status()).toBe(200);
	}
});

const section = (page: Page) =>
	page.locator('details.section', { has: page.locator('summary', { hasText: 'No technique' }) });
const files = (page: Page) => section(page).locator('.file');
const pane = (page: Page) => page.getByRole('dialog', { name: 'Filter and sort' });
const shown = (page: Page) => pane(page).getByRole('status');
const group = (page: Page, legend: string): Locator =>
	pane(page).locator('fieldset', { has: page.locator('legend', { hasText: new RegExp(`^${legend}$`) }) });

async function openPane(page: Page) {
	await page.goto('videos');
	await expect(files(page)).toHaveCount(3); // the only section with videos: open
	await page.getByRole('button', { name: /^Filter and sort/ }).click();
	await expect(pane(page)).toBeVisible();
	await pane(page).getByRole('button', { name: 'Reset' }).click(); // whatever an earlier test left
	await expect(shown(page)).toHaveText('3 of 3 video(s) shown');
}

test('the pane offers what the videos have', async ({ page }) => {
	await openPane(page);
	await expect(pane(page).locator('legend')).toHaveText([
		'Order',
		'Duration',
		'Uploaded on',
		'Uploaded by',
		'Flag',
		'Level',
		'Location',
		'Note',
		'Year'
	]);
	// The bounds of the encoded videos; one day only: nothing to choose.
	await expect(group(page, 'Duration').locator('.values')).toHaveText(/0:06\s*0:12/);
	const today = await page.evaluate(() => new Date().toLocaleDateString('en'));
	await expect(group(page, 'Uploaded on').locator('.values')).toHaveText(new RegExp(`${today}\\s*${today}`));
	await expect(group(page, 'Uploaded on').getByRole('slider')).toHaveCount(2);
	for (const slider of await group(page, 'Uploaded on').getByRole('slider').all()) await expect(slider).toBeDisabled();
	// Only the uploaders (not the admin), only the values used (not Outdoor's siblings).
	await expect(group(page, 'Uploaded by').getByRole('checkbox')).toHaveCount(2);
	await expect(group(page, 'Uploaded by').locator('label')).toHaveText(['Aiko', 'Ren']);
	await expect(group(page, 'Location').locator('label')).toHaveText(['Dojo', 'Outdoor']);
	await expect(group(page, 'Year').locator('.values')).toHaveText(/2019\s*2024/);
	await expect(group(page, 'Level').locator('.values')).toHaveText(/3\s*7/);
	await expect(group(page, 'Note').getByRole('searchbox')).toHaveAttribute('placeholder', 'Contains…');
	await expect(group(page, 'Flag').getByLabel('With this tag')).not.toBeChecked();
});

test('sort: by upload date and by duration, each way', async ({ page }) => {
	await openPane(page);
	const by = pane(page).getByLabel('Sort by');
	const dir = pane(page).getByLabel('Direction');
	await expect(by).toHaveValue('uploaded_at');
	await expect(dir).toHaveValue('desc');
	await expect(files(page)).toHaveText([C, B, A]); // newest first, the default

	await dir.selectOption({ label: 'Oldest first' });
	await expect(files(page)).toHaveText([A, B, C]);
	await by.selectOption({ label: 'Duration' });
	await expect(dir.locator('option')).toHaveText(['Shortest first', 'Longest first']);
	await expect(files(page)).toHaveText([A, B, C]); // shortest first (the direction kept)
	await dir.selectOption({ label: 'Longest first' });
	await expect(files(page)).toHaveText([C, B, A]);
	// A sort only (nothing hidden): still counted on the button, kept after a reload.
	await page.keyboard.press('Escape');
	await expect(page.getByRole('button', { name: 'Filter and sort (1 active)' })).toBeVisible();
	await page.reload();
	await expect(files(page)).toHaveText([C, B, A]);
	await page.getByRole('button', { name: 'Filter and sort (1 active)' }).click();
	await expect(pane(page).getByLabel('Sort by')).toHaveValue('duration');
	await pane(page).getByRole('button', { name: 'Reset' }).click();
	await expect(files(page)).toHaveText([C, B, A]);
	await expect(pane(page).getByLabel('Sort by')).toHaveValue('uploaded_at');
});

test('filter by duration: a range between the shortest and the longest', async ({ page }) => {
	await openPane(page);
	const duration = group(page, 'Duration');
	await duration.getByRole('slider', { name: 'Duration, from' }).fill('8');
	await expect(duration.locator('.values')).toHaveText(/0:08\s*0:12/);
	await expect(shown(page)).toHaveText('2 of 3 video(s) shown');
	await expect(files(page)).toHaveText([C, B]);
	await duration.getByRole('slider', { name: 'Duration, to' }).fill('10');
	await expect(shown(page)).toHaveText('1 of 3 video(s) shown');
	await expect(files(page)).toHaveText([B]);
	// The low end never passes the high one.
	await duration.getByRole('slider', { name: 'Duration, from' }).fill('11');
	await expect(duration.locator('.values')).toHaveText(/0:10\s*0:10/);
});

test('filter by uploader: any of those checked', async ({ page }) => {
	await openPane(page);
	const by = group(page, 'Uploaded by');
	await by.getByLabel('Aiko').check();
	await expect(shown(page)).toHaveText('2 of 3 video(s) shown');
	await expect(files(page)).toHaveText([C, A]);
	await by.getByLabel('Ren').check();
	await expect(shown(page)).toHaveText('3 of 3 video(s) shown');
	await by.getByLabel('Aiko').uncheck();
	await expect(files(page)).toHaveText([B]);
});

test('filter by a list tag: any of the values checked', async ({ page }) => {
	await openPane(page);
	const location = group(page, 'Location');
	await location.getByLabel('Dojo').check();
	await expect(files(page)).toHaveText([C, A]);
	await location.getByLabel('Outdoor').check();
	await expect(shown(page)).toHaveText('3 of 3 video(s) shown');
	await location.getByLabel('Dojo').uncheck();
	await expect(files(page)).toHaveText([B]);
});

test('filter by numeric tags: a range over the values used, videos without one left out', async ({ page }) => {
	await openPane(page);
	const year = group(page, 'Year');
	await year.getByRole('slider', { name: 'Year, from' }).fill('2020');
	await expect(year.locator('.values')).toHaveText(/2020\s*2024/);
	await expect(files(page)).toHaveText([B]); // C has no year
	await year.getByRole('slider', { name: 'Year, from' }).fill('2019'); // whole range again: no filter
	await expect(shown(page)).toHaveText('3 of 3 video(s) shown');

	const level = group(page, 'Level');
	await level.getByRole('slider', { name: 'Level, to' }).fill('5');
	await expect(files(page)).toHaveText([A]);
});

test('filter by a text tag (contains, any case) and by a tag without value', async ({ page }) => {
	await openPane(page);
	const note = group(page, 'Note').getByRole('searchbox');
	await note.fill('GYAKU');
	await expect(files(page)).toHaveText([C, A]); // B has no note
	await note.fill('omote');
	await expect(files(page)).toHaveText([C]);
	await note.fill('');
	await expect(shown(page)).toHaveText('3 of 3 video(s) shown');

	await group(page, 'Flag').getByLabel('With this tag').check();
	await expect(files(page)).toHaveText([A]);
});

test('every criterion together, kept after a reload, then reset', async ({ page }) => {
	await openPane(page);
	await group(page, 'Uploaded by').getByLabel('Aiko').check();
	await group(page, 'Location').getByLabel('Dojo').check();
	await group(page, 'Note').getByRole('searchbox').fill('gyaku');
	await pane(page).getByLabel('Sort by').selectOption({ label: 'Duration' });
	await expect(files(page)).toHaveText([C, A]);
	await group(page, 'Duration').getByRole('slider', { name: 'Duration, to' }).fill('10');
	await expect(files(page)).toHaveText([A]);
	await group(page, 'Year').getByRole('slider', { name: 'Year, from' }).fill('2020'); // A's is 2019
	await expect(shown(page)).toHaveText('0 of 3 video(s) shown');
	await pane(page).getByRole('button', { name: 'Done' }).click();
	await expect(page.getByText('No video matches the filter.')).toBeVisible();
	await expect(page.locator('details.section summary .count')).toHaveText([
		'0 video(s)',
		'0 video(s)',
		'0 video(s)',
		'0 video(s)'
	]);

	await page.reload();
	await expect(page.getByText('No video matches the filter.')).toBeVisible();
	await page.getByRole('button', { name: 'Filter and sort (6 active)' }).click();
	await expect(group(page, 'Uploaded by').getByLabel('Aiko')).toBeChecked();
	await expect(group(page, 'Note').getByRole('searchbox')).toHaveValue('gyaku');
	await pane(page).getByRole('button', { name: 'Reset' }).click();
	await expect(shown(page)).toHaveText('3 of 3 video(s) shown');
	await pane(page).getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('button', { name: 'Filter and sort', exact: true })).toBeVisible();
	await expect(files(page)).toHaveText([C, B, A]);
});
