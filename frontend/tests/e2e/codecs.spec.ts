import { readFileSync } from 'node:fs';
import {
	expect,
	test,
	type APIRequestContext,
	type APIResponse,
	type Browser,
	type BrowserContext,
	type Cookie
} from '@playwright/test';
import { TOTP } from 'otpauth';

// Test local codecs on the real backend (project "options": after account.spec.ts, whose
// admin invites the accounts here): the 'upload' access decided by real roles, and the page
// really running its tests in this browser (Playwright's Chromium: H.264 + AAC, no H.265).
// Every credential POST through `credentialPost`: on the stack, nginx's limit (60/min,
// burst 30) is mostly used up by the specs before.
test.describe.configure({ mode: 'serial' });

interface Account {
	username: string;
	password: string;
	totpSecret: string;
}

let adminCookies: Cookie[] = [];

/** A credential POST; on nginx's 429, waits as Retry-After says and tries again. `data` is
 * made again for each try (a TOTP code may have expired). */
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

/** An account with this role, invited by the admin and registered through the API, logged in. */
async function account(admin: APIRequestContext, browser: Browser, role: string): Promise<BrowserContext> {
	const username = `codecs_${role}_${Date.now() % 100000}`;
	const invite = await admin.post('api/admin/users', { data: { username, role } });
	expect(invite.status()).toBe(201);
	const { token } = await invite.json();
	const enrol = await credentialPost(admin, 'api/register/totp', () => ({ token }));
	expect(enrol.status()).toBe(200);
	const { secret } = await enrol.json();
	const who = { username, password: `${username}'s long password`, totpSecret: secret };
	const done = await credentialPost(admin, 'api/register/complete', () => ({
		token,
		password: who.password,
		totp_secret: secret,
		totp_code: new TOTP({ secret }).generate()
	}));
	expect(done.status()).toBe(204);
	return loggedIn(browser, who);
}

// The admin (left by account.spec.ts) logs in once; the accounts are made with its session.
test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, JSON.parse(readFileSync('.e2e/admin.json', 'utf8')));
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

test('an uploader: the link beside the upload title, the tests run, the results copied', async ({ page, browser }) => {
	test.setTimeout(240_000);
	const uploader = await account(page.request, browser, 'uploader');
	await uploader.grantPermissions(['clipboard-read', 'clipboard-write']);
	const own = await uploader.newPage();
	await own.goto('upload');
	await own.getByRole('link', { name: 'Test local codecs' }).click();
	await expect(own).toHaveURL(/upload\/codecs$/);
	await expect(own.getByRole('heading', { level: 1, name: 'Test local codecs' })).toBeVisible();

	// The browser's answers, then the real tests on the samples served by the backend.
	const answers = own.locator('details', { hasText: 'What the browser says' });
	await expect(answers.locator('tbody tr')).toHaveCount(20);
	const run = own.getByRole('button', { name: 'Run the tests' });
	await run.click();
	await expect(run).toBeDisabled();
	await expect(run).toBeEnabled({ timeout: 200_000 });
	await expect(own.locator('table.decoding tr[data-id="h264-aac"] td')).toHaveText(['120/120', 'yes', 'yes', '']);
	await expect(own.locator('table.encoding tr[data-id="mp4-h264-aac"] td').first()).toHaveText(
		'yes (120 frames read back)'
	);
	// Not in Playwright's Chromium: H.265 says why, in words.
	await expect(own.locator('table.encoding tr[data-id="mp4-h265-aac"] td.problem')).toContainText(
		'This browser has no encoder for this format'
	);

	await own.getByLabel('Your name or device (optional)').fill('e2e uploader');
	await own.getByRole('button', { name: 'Copy my results' }).click();
	await expect(own.getByRole('button', { name: 'Copied' })).toBeVisible();
	const results = JSON.parse(await own.evaluate(() => navigator.clipboard.readText()));
	expect(results).toMatchObject({ name: 'e2e uploader', encodedFrom: 'h264-aac' });
	expect(results.decoding['h264-aac']).toEqual({ frames: 120, audio: true, plays: true });

	// Back to the upload page.
	await own.getByRole('link', { name: '← Upload a video' }).click();
	await expect(own).toHaveURL(/upload$/);
	await uploader.close();
});

test('without the upload access (role "user"): no Upload page, no codecs page', async ({ page, browser }) => {
	const user = await account(page.request, browser, 'user');
	const own = await user.newPage();
	await own.goto('./');
	await expect(own.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveText(['Schools']);
	await own.goto('upload/codecs');
	await expect(own).toHaveURL('./');
	await own.goto('upload');
	await expect(own).toHaveURL('./');
	await user.close();
});
