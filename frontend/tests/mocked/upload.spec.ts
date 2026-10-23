import { expect, test, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';

// The upload page with the API and tusd faked. The video is a real 4 s clip
// (VP9: Playwright's Chromium has no H.264), opened locally by the page.
const CLIP = 'tests/fixtures/clip.webm';
const CLIP_SHA = '2d7fc02deb6c4ec99d2f0cc8b962122869c5290bba6d451710858e6a3d74f374';
const CLIP_SIZE = readFileSync(CLIP).length;

const UPLOADER = {
	username: 'kenji',
	name: null,
	role: 'uploader',
	role_name: 'Uploader',
	access: ['annotate', 'segment', 'upload']
};
const CATALOG = {
	schools: [{ id: 'gyokko', kanji: '玉虎流', romaji: 'Gyokko Ryu' }],
	levels: [{ id: 'shoden', kanji: '初伝', romaji: 'Shoden' }],
	techniques: [{ id: 'gyokko.koku', kanji: '虚空', romaji: 'Koku', ryu: 'gyokko', level: 'shoden' }],
	segments: []
};

interface Fake {
	exists: boolean;
	available: boolean;
	performers: { id: string; name: string }[];
	submitted: unknown[];
	mine: unknown[];
	tusRequests: string[];
}

async function setup(page: Page, user = UPLOADER, over: Partial<Fake> = {}): Promise<Fake> {
	const fake: Fake = {
		exists: false,
		available: true,
		performers: [{ id: 'hatsumi', name: 'Hatsumi' }],
		submitted: [],
		mine: [],
		tusRequests: [],
		...over
	};
	page.on('dialog', (d) => d.accept());
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => r.fulfill({ json: user }));
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.route('/api/tags', (r) =>
		r.fulfill({ json: [{ id: 'place', values: ['dojo', 'outdoor'] }, { id: 'note' }] })
	);
	await page.route('/api/performers', async (r) => {
		if (r.request().method() === 'POST') {
			const { name } = r.request().postDataJSON();
			const performer = { id: name.toLowerCase(), name };
			fake.performers.push(performer);
			return r.fulfill({ status: 201, json: performer });
		}
		return r.fulfill({ json: fake.performers });
	});
	await page.route('/api/videos/exists*', (r) => r.fulfill({ json: { exists: fake.exists } }));
	await page.route('/api/uploads/available', (r) => r.fulfill({ json: { available: fake.available } }));
	await page.route('/api/uploads/mine', (r) => r.fulfill({ json: fake.mine }));
	await page.route('/api/uploads/*/submit', (r) => {
		fake.submitted.push({ url: r.request().url(), body: r.request().postDataJSON() });
		return r.fulfill({ status: 201, json: { id: 1 } });
	});
	// tusd: create, then one PATCH with the whole (small) file.
	await page.route('/files/**', (r) => {
		const req: Request = r.request();
		fake.tusRequests.push(`${req.method()} ${new URL(req.url()).pathname}`);
		const tus = { 'Tus-Resumable': '1.0.0' };
		if (req.method() === 'POST') {
			return r.fulfill({ status: 201, headers: { ...tus, Location: '/files/abc123' } });
		}
		if (req.method() === 'PATCH') {
			return r.fulfill({ status: 204, headers: { ...tus, 'Upload-Offset': String(CLIP_SIZE) } });
		}
		return r.fulfill({ status: 204, headers: tus });
	});
	return fake;
}

async function openClip(page: Page) {
	await page.goto('/upload');
	await page.getByLabel('Video file').setInputFiles(CLIP);
	await expect(page.locator('video')).toBeVisible();
	await expect(page.getByRole('slider', { name: 'Timeline' })).toBeVisible();
}

/** The timeline's box, scrolled into view (raw mouse events don't scroll). */
async function timeline(page: Page) {
	const slider = page.getByRole('slider', { name: 'Timeline' });
	await slider.scrollIntoViewIfNeeded();
	return (await slider.boundingBox())!;
}

/** Drag on the timeline between two fractions of its width. */
async function drag(page: Page, from: number, to: number) {
	const box = await timeline(page);
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * from, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * ((from + to) / 2), y, { steps: 3 });
	await page.mouse.move(box.x + box.width * to, y, { steps: 3 });
	await page.mouse.up();
}

const proceed = (page: Page) => page.getByRole('button', { name: 'Proceed' });
const allDone = (page: Page) => page.getByRole('checkbox', { name: /All the segments have been created/ });

test('Upload entry: right of Schools, only with the upload access', async ({ page }) => {
	await setup(page);
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload']);
	await nav.getByRole('link', { name: 'Upload' }).click();
	await expect(page).toHaveURL('/upload');
	await expect(page.getByRole('heading', { name: 'Upload a video' })).toBeVisible();
});

test('no upload access: no entry, page not reachable', async ({ page }) => {
	await setup(page, { ...UPLOADER, role: 'user', access: ['segment'] });
	await page.goto('/upload');
	await expect(page).toHaveURL('/');
	await expect(page.getByRole('link', { name: 'Upload' })).toHaveCount(0);
});

test('the file is checked by SHA-256: an uploaded one is refused', async ({ page }) => {
	await setup(page, UPLOADER, { exists: true });
	await page.goto('/upload');
	const check = page.waitForRequest(`/api/videos/exists?original_sha256=${CLIP_SHA}`);
	await page.getByLabel('Video file').setInputFiles(CLIP);
	await check;
	await expect(page.getByText('This video was already uploaded.')).toBeVisible();
	await expect(page.locator('video')).toHaveCount(0);
});

test('modes and the "all segments done" checkbox', async ({ page }) => {
	await setup(page);
	await openClip(page);
	await expect(proceed(page)).toBeDisabled(); // no segment, no mode
	await expect(allDone(page)).toBeEnabled();

	await page.getByLabel('Define segments later').check();
	await expect(allDone(page)).not.toBeChecked();
	await expect(allDone(page)).toBeDisabled();
	await expect(proceed(page)).toBeEnabled();

	await page.getByLabel('This video does not contain any technique segment').check();
	await expect(allDone(page)).toBeChecked();
	await expect(allDone(page)).toBeDisabled();
	await expect(page.getByRole('heading', { name: 'Segments' })).toHaveCount(0);

	await page.getByRole('button', { name: 'Clear' }).click();
	await expect(page.getByLabel('Define segments later')).not.toBeChecked();
	await expect(allDone(page)).toBeEnabled();
	await expect(proceed(page)).toBeDisabled();
});

test('segments by drag and by I/O, complete them, proceed: upload then submit', async ({ page }) => {
	const fake = await setup(page);
	await openClip(page);

	// 1. Drag across the timeline.
	await drag(page, 0.1, 0.4);
	const first = page.getByRole('article', { name: 'Segment 1' });
	await expect(first).toBeVisible();
	await expect(proceed(page)).toBeDisabled(); // incomplete
	await first.getByLabel('School').selectOption('gyokko');
	await first.getByLabel('Level').selectOption('shoden');
	await first.getByLabel('Technique').selectOption('gyokko.koku');
	await first.getByLabel('Performer').selectOption({ label: 'Add a performer…' });
	await first.getByPlaceholder("Performer's name").fill('Noguchi');
	await first.getByRole('button', { name: 'Add' }).first().click();
	await expect(first.getByLabel('Performer')).toHaveValue('noguchi');
	await first.getByPlaceholder('Add a tag').fill('place');
	await first.getByLabel('Value').selectOption('dojo');
	await first.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(first.getByText('place: dojo')).toBeVisible();
	await expect(proceed(page)).toBeEnabled();

	// 2. Seek by clicking the timeline, then I and O keys.
	let box = await timeline(page);
	await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
	await page.locator('body').press('i');
	box = await timeline(page);
	await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2);
	await page.locator('body').press('o');
	const second = page.getByRole('article', { name: 'Segment 2' });
	await expect(second).toBeVisible();
	// The new segment starts with the previous one's school, level and performer.
	await expect(second.getByLabel('School')).toHaveValue('gyokko');
	await expect(second.getByLabel('Performer')).toHaveValue('noguchi');
	await second.getByLabel('Technique').selectOption('gyokko.koku');

	await allDone(page).check();
	await proceed(page).click();
	await expect(page.getByRole('status')).toContainText('Uploaded.');
	expect(fake.tusRequests).toEqual(['POST /files/', 'PATCH /files/abc123']);

	const [{ url, body }] = fake.submitted as { url: string; body: Record<string, unknown> }[];
	expect(url).toMatch(/\/api\/uploads\/abc123\/submit$/);
	expect(body).toMatchObject({ filename: 'clip.webm', all_segments_done: true, tags: [] });
	const segments = body.segments as { begin_s: number; end_s: number }[];
	expect(segments).toHaveLength(2);
	expect(segments[0]).toMatchObject({ technique: 'gyokko.koku', performer: 'noguchi', tags: [{ id: 'place', value: 'dojo' }] });
	// Whole seconds, begin down, end up; drag 10–40 % of 4 s ≈ 0.4–1.6 s.
	expect(segments[0].begin_s).toBe(0);
	expect(segments[0].end_s).toBe(2);
	expect(segments[1].begin_s).toBeGreaterThanOrEqual(2);
	expect(segments[1].end_s).toBe(4);
	await expect(page.locator('video')).toHaveCount(0); // page reset
});

test('server cannot receive uploads: warned at once, annotating still possible', async ({ page }) => {
	await setup(page, UPLOADER, { available: false });
	await openClip(page);
	await expect(page.getByRole('alert')).toContainText('the server\'s upload service (tusd) is not running');
	await page.getByLabel('Define segments later').check();
	await expect(proceed(page)).toBeDisabled();
	await expect(page.getByText('Proceed is possible once the server can receive uploads again.')).toBeVisible();
});

test('upload server unreachable: the user sees it is retrying', async ({ page }) => {
	await setup(page);
	await page.route('/files/**', (r) => r.fulfill({ status: 502 })); // as the dev proxy without tusd
	await openClip(page);
	await page.getByLabel('Define segments later').check();
	await proceed(page).click();
	await expect(page.getByText('The upload server cannot be reached: retrying…')).toBeVisible();
});

test('leaving keeps the work: picking the same file resumes it', async ({ page }) => {
	await setup(page);
	await openClip(page);
	await drag(page, 0.2, 0.5);
	await expect(page.getByRole('article', { name: 'Segment 1' })).toBeVisible();
	await page.waitForTimeout(600); // saved shortly after each change

	await page.reload();
	await expect(page.getByText('Unfinished uploads on this device')).toBeVisible();
	await expect(page.getByText('clip.webm')).toBeVisible();
	await page.getByLabel('Video file').setInputFiles(CLIP);
	await expect(page.getByText('Unfinished work found for this file: resumed.')).toBeVisible();
	await expect(page.getByRole('article', { name: 'Segment 1' })).toBeVisible();
});

test('cancel forgets the work and resets the page', async ({ page }) => {
	await setup(page);
	await openClip(page);
	await drag(page, 0.2, 0.5);
	await expect(page.getByRole('article', { name: 'Segment 1' })).toBeVisible();
	await page.getByRole('button', { name: 'Cancel' }).click();
	await expect(page.locator('video')).toHaveCount(0);
	await expect(page.getByText('Unfinished uploads on this device')).toHaveCount(0);
});

test('my uploads: queue position, encoding progress, failure with retry', async ({ page }) => {
	await setup(page, UPLOADER, {
		mine: [
			{ id: 3, filename: 'c.mov', status: 'failed', progress: 10, error: 'Encoding failed', uploaded_s: 1_800_000_000, queue_position: null },
			{ id: 2, filename: 'b.mov', status: 'queued', progress: 0, error: null, uploaded_s: 1_800_000_000, queue_position: 2 },
			{ id: 1, filename: 'a.mov', status: 'encoding', progress: 42, error: null, uploaded_s: 1_800_000_000, queue_position: null }
		]
	});
	let retried = '';
	await page.route('/api/videos/3/retry', (r) => {
		retried = r.request().method();
		return r.fulfill({ status: 204 });
	});
	await page.goto('/upload');
	const mine = page.getByRole('heading', { name: 'My uploads' }).locator('..');
	await expect(mine.getByText('Failed: Encoding failed')).toBeVisible();
	await expect(mine.getByText('Waiting to be encoded (position 2 in the queue)')).toBeVisible();
	await expect(mine.getByText('Encoding: 42 %')).toBeVisible();
	await expect(mine.getByRole('progressbar')).toHaveAttribute('value', '42');
	await mine.getByRole('button', { name: 'Retry' }).click();
	await expect.poll(() => retried).toBe('POST');
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.goto('/upload');
	await expect(page.getByRole('heading', { name: 'Téléverser une vidéo' })).toBeVisible();
	await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link')).toHaveText([
		'Écoles',
		'Téléverser'
	]);
});
