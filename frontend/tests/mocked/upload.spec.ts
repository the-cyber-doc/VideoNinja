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

// As the server sends them: names in the request's language, sorted by name.
const TAGS: Record<string, object[]> = {
	en: [
		{ id: 'note', name: 'Note' },
		{ id: 'place', name: 'Place', values: [{ id: 'dojo', name: 'Dojo' }, { id: 'outdoor', name: 'Outdoor' }] },
		{ id: 'year', name: 'Year', format: 'year', min: 1926, max: 2026 }
	],
	fr: [
		{ id: 'place', name: 'Lieu', values: [{ id: 'dojo', name: 'Dojo' }, { id: 'outdoor', name: 'Extérieur' }] },
		{ id: 'note', name: 'Remarque' },
		{ id: 'year', name: 'Année', format: 'year', min: 1926, max: 2026 }
	]
};

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
	await page.route('/api/tags', (r) => r.fulfill({ json: TAGS[r.request().headers()['accept-language']] }));
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
	await expect(page.getByText('This video already exists.')).toBeVisible();
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
	await first.getByPlaceholder('Add a tag').fill('place'); // any case
	await first.getByLabel('Value').selectOption({ label: 'Outdoor' });
	await first.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(first.getByText('Place: Outdoor')).toBeVisible();
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
	expect(body).toMatchObject({ original_filename: 'clip.webm', all_segments_done: true, tags: [] });
	const segments = body.segments as { begin_s: number; end_s: number }[];
	expect(segments).toHaveLength(2);
	expect(segments[0]).toMatchObject({ technique: 'gyokko.koku', performer: 'noguchi', tags: [{ id: 'place', value: 'outdoor' }] }); // the ID, not the name
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
			{ id: 3, original_filename: 'c.mov', status: 'failed', progress: 10, error: 'Encoding failed', uploaded_at: '2027-01-15T09:00:00+01:00', queue_position: null },
			{ id: 2, original_filename: 'b.mov', status: 'queued', progress: 0, error: null, uploaded_at: '2027-01-15T09:00:00+01:00', queue_position: 2 },
			{ id: 1, original_filename: 'a.mov', status: 'encoding', progress: 42, error: null, uploaded_at: '2027-01-15T09:00:00+01:00', queue_position: null }
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

test('a video just published: the catalogue is fetched again at once', async ({ page }) => {
	const status = { id: 1, original_filename: 'a.mov', status: 'encoding', progress: 90, error: null, uploaded_at: '2027-01-15T09:00:00+01:00', queue_position: null };
	const fake = await setup(page, UPLOADER, { mine: [status] });
	let catalogRequests = 0;
	await page.route('/api/catalog', (r) => {
		catalogRequests++;
		return r.fulfill({ json: CATALOG });
	});
	// As in the app: the catalogue is in memory (a schools page), then the upload page.
	await page.goto('/schools');
	await expect.poll(() => catalogRequests).toBe(1);
	await page.getByRole('link', { name: 'Upload' }).click();
	await expect(page.getByText('Encoding: 90 %')).toBeVisible();
	const before = catalogRequests;
	fake.mine = [{ ...status, status: 'published', progress: 100 }];
	await expect(page.getByText('Published')).toBeVisible({ timeout: 10_000 });
	await expect.poll(() => catalogRequests).toBe(before + 1);
});

/** The frame shown by the video, in seconds. */
const shown = (page: Page) => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
const marker = (page: Page) => page.getByRole('slider', { name: 'Timeline' });

test('the timeline shows the frame under the pointer; the seek marker stays', async ({ page }) => {
	await setup(page);
	await openClip(page); // 4 s
	let box = await timeline(page);
	const at = (fraction: number) => [box.x + box.width * fraction, box.y + box.height / 2] as const;
	const near = (time: number) => (value: number) => Math.abs(value - time) < 0.2;

	await page.mouse.click(...at(0.25)); // the seek marker: 1 s
	await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');

	// Hovering: the video shows that frame, the marker does not move.
	await page.mouse.move(...at(0.75), { steps: 4 });
	await expect.poll(async () => near(3)(await shown(page))).toBe(true);
	await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');
	// Leaving the timeline: back to the marker's frame.
	await page.mouse.move(box.x + box.width * 0.75, box.y - 40);
	await expect.poll(async () => near(1)(await shown(page))).toBe(true);

	// Creating a segment: the frame under the pointer while dragging.
	await page.mouse.move(...at(0.3));
	await page.mouse.down();
	await page.mouse.move(...at(0.8), { steps: 4 });
	await expect.poll(async () => near(3.2)(await shown(page))).toBe(true);
	await page.mouse.up();
	await expect(page.getByRole('article', { name: 'Segment 1' })).toBeVisible();

	// Resizing it: the frame of the edge being moved, the marker still at 1 s.
	box = await timeline(page);
	await page.mouse.move(...at(0.8));
	await page.mouse.down();
	await page.mouse.move(...at(0.9), { steps: 4 });
	await expect.poll(async () => near(3.6)(await shown(page))).toBe(true);
	await page.mouse.up();
	await page.mouse.move(box.x + box.width * 0.9, box.y - 40);
	await expect.poll(async () => near(1)(await shown(page))).toBe(true);
	await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');
});

test('→ steps one frame of the video (measured: 25 fps here)', async ({ page }) => {
	await setup(page);
	await openClip(page);
	const box = await timeline(page);
	// The frame duration is measured in the background; until then, 1/30 s.
	await expect
		.poll(async () => {
			await page.mouse.click(box.x + box.width * 0.25, box.y + box.height / 2); // 1 s
			await page.mouse.move(box.x, box.y - 40); // off the timeline: no preview
			const before = await shown(page);
			await page.locator('body').press('ArrowRight');
			return Math.round(((await shown(page)) - before) * 1000);
		})
		.toBe(40);
});

test('video tags come right after the video, before the segment choices', async ({ page }) => {
	await setup(page);
	await openClip(page);
	const tags = page.locator('.card', { has: page.getByText('Tags of the video') });
	const before = await tags.evaluate((el) => {
		const mode = document.querySelector('fieldset.mode')!;
		const video = document.querySelector('video')!;
		const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
		return follows(video, el) && follows(el, mode);
	});
	expect(before).toBe(true);
});

test.describe('on a phone', () => {
	test.use({ viewport: { width: 360, height: 780 } });

	test('the timeline keeps its height; Begin here and End here stay together', async ({ page }) => {
		await setup(page);
		await openClip(page);
		expect((await timeline(page)).height).toBeGreaterThanOrEqual(56);
		const begin = (await page.getByRole('button', { name: 'Begin here' }).boundingBox())!;
		const end = (await page.getByRole('button', { name: 'End here' }).boundingBox())!;
		const sideBySide = Math.abs(begin.y - end.y) < 2 && end.x > begin.x;
		const stacked = Math.abs(begin.x - end.x) < 2 && end.y > begin.y;
		expect(sideBySide || stacked).toBe(true);
	});
});

test('tags: shown by their translated names, kept by ID', async ({ page }) => {
	await setup(page);
	await openClip(page);
	const video = page.locator('.card', { has: page.getByText('Tags of the video') });
	await video.getByPlaceholder('Add a tag').fill('Place');
	await expect(video.getByLabel('Value').locator('option')).toHaveText(['Value', 'Dojo', 'Outdoor']);
	await video.getByLabel('Value').selectOption({ label: 'Outdoor' });
	await video.getByRole('button', { name: 'Add', exact: true }).click();
	await video.getByPlaceholder('Add a tag').fill('note');
	await video.getByLabel('Value').fill('Très bien');
	await video.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(video.locator('.chip')).toHaveText(['Place: Outdoor', 'Note: Très bien']);

	// Another language: the names are reloaded and the chips relabelled; free text stays as typed.
	await page.getByRole('button', { name: 'Language: English' }).click();
	await page.getByRole('menuitemradio', { name: 'Français' }).click();
	const videoFr = page.locator('.card', { has: page.getByText('Étiquettes de la vidéo') });
	await expect(videoFr.locator('.chip')).toHaveText(['Lieu : Extérieur', 'Remarque : Très bien']);
});

test('a year tag only takes a year in its range', async ({ page }) => {
	await setup(page);
	await openClip(page);
	const video = page.locator('.card', { has: page.getByText('Tags of the video') });
	await video.getByPlaceholder('Add a tag').fill('Year');
	const year = video.getByLabel('Year (1926–2026)');
	const add = video.getByRole('button', { name: 'Add', exact: true });
	for (const wrong of ['1925', '2027', '99']) {
		await year.fill(wrong);
		await expect(add).toBeDisabled();
	}
	await year.fill('2024');
	await add.click();
	await expect(video.locator('.chip')).toHaveText(['Year: 2024']);
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
