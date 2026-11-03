import { expect, test, type Page } from '@playwright/test';

// Test local codecs (/upload/codecs, the 'upload' access): the browser's answers for every
// format, then the real tests on the sample clips (static/format-samples/), really run by
// this browser, and the results copied. The API is faked (only the login's); the samples
// are the app's own static files.
const UPLOADER = { username: 'kenji', name: null, role: 'uploader', role_name: 'Uploader', access: ['upload'] };

async function setup(page: Page, user: object = UPLOADER) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => r.fulfill({ json: user }));
}

const answers = (page: Page) => page.locator('details', { hasText: 'What the browser says' });
const tests = (page: Page) => page.locator('details', { hasText: 'Real tests' });

test('without the upload access: back to the home page', async ({ page }) => {
	await setup(page, { ...UPLOADER, access: ['comment'] });
	await page.goto('/upload/codecs');
	await expect(page).toHaveURL('/');
});

test('the browser’s answers, the real tests, the results copied', async ({ page, browserName, context }) => {
	// WebKit's decoders can hang on some samples: each waits for its time limit.
	test.setTimeout(480_000);
	if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await setup(page);
	await page.goto('/upload/codecs');
	await expect(page.getByRole('link', { name: '← Upload a video' })).toHaveAttribute('href', '/upload');

	// One row per format, every column answered (yes, no or "?").
	const formats = answers(page).locator('tbody tr');
	await expect(formats).toHaveCount(20);
	await expect(answers(page).locator('tr[data-id="h264-high"] th')).toContainText('avc1.640028');
	await expect(answers(page).locator('tr[data-id="h264-high"] td').first()).toHaveText(/^(yes|no|\?)/);

	// Every engine Playwright runs decodes, plays and encodes H.264 + AAC.
	const run = page.getByRole('button', { name: 'Run the tests' });
	await run.click();
	await expect(tests(page).getByRole('status')).toHaveText(/^(Decoding|Encoding to) /);
	await expect(run).toBeDisabled();
	await expect(run).toBeEnabled({ timeout: 420_000 });
	await expect(tests(page).locator('table.decoding tbody tr')).toHaveCount(7);
	await expect(tests(page).locator('table.decoding tr[data-id="h264-aac"] td')).toHaveText([
		'120/120',
		'yes',
		'yes',
		''
	]);
	await expect(tests(page).locator('table.decoding tr[data-id="h264-aac"] a')).toHaveAttribute(
		'href',
		'/format-samples/h264-aac.mp4'
	);
	await expect(tests(page).locator('table.encoding thead th').first()).toHaveText(
		'Encoded to (from H.264 + AAC (MP4))'
	);
	await expect(tests(page).locator('table.encoding tr[data-id="mp4-h264-aac"] td').first()).toHaveText(
		'yes (120 frames read back)'
	);
	// A failure says why, in words, with the browser's own detail.
	const problems = await tests(page).locator('td.problem').allInnerTexts();
	for (const text of problems.filter(Boolean))
		expect(text).toMatch(/^(This browser|No answer in time|The sample|No video|This conversion|Failed)/);

	await page.getByLabel('Your name or device (optional)').fill('Kenji, laptop');
	const copy = page.getByRole('button', { name: 'Copy my results' });
	await copy.click();
	await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible();
	if (browserName === 'chromium') {
		const results = JSON.parse(await page.evaluate(() => navigator.clipboard.readText()));
		expect(results).toMatchObject({ name: 'Kenji, laptop', encodedFrom: 'h264-aac' });
		expect(results.decoding['h264-aac']).toEqual({ frames: 120, audio: true, plays: true });
		expect(Object.keys(results.formats)).toHaveLength(20);
	}
	await expect(copy).toBeVisible({ timeout: 3000 }); // its label back
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.goto('/upload/codecs');
	await expect(page.getByRole('heading', { level: 1, name: 'Tester les codecs locaux' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Ce que dit le navigateur' })).toBeVisible();
	await expect(page.locator('table thead th')).toHaveText([
		'Format',
		'Lit (MP4)',
		'Lit (WebM)',
		'Encode (matériel)',
		'Encode',
		'Décode'
	]);
	await expect(page.getByRole('button', { name: 'Lancer les tests' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Copier mes résultats' })).toBeVisible();
});
