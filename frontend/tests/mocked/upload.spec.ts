import { expect, test, type Page, type Request } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { CATALOG as FULL, KOKU, STAFF } from '../catalog';
import { touchDrag } from '../viewer';
import type { Tag } from '../../src/lib/api/types';

// The editor's video. Not the hidden one that measures the frame duration for a moment (aria-hidden).
const PLAYER = 'video:not([aria-hidden="true"])';

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
const CATALOG = { ...FULL, segments: [] };

interface Fake {
	exists: boolean;
	available: boolean;
	performers: { id: string; name: string }[];
	submitted: unknown[];
	mine: unknown[];
	tusRequests: string[];
	limits: { max_bytes: number; extensions: string[]; book_max_bytes: number };
}

// As the server sends them (typed: a wrong field fails `npm run check`): names in the
// request's language, sorted by name.
const TAGS: Record<string, Tag[]> = {
	en: [
		{ id: 'note', name: 'Note', format: 'free', input_mode: 'text' },
		{
			id: 'place',
			name: 'Place',
			format: 'list',
			input_mode: 'text',
			values: [
				{ id: 'dojo', name: 'Dojo' },
				{ id: 'outdoor', name: 'Outdoor' }
			]
		},
		{ id: 'rain', name: 'Rain', input_mode: 'text' },
		{
			id: 'year',
			name: 'Year',
			format: 'regexp',
			regexp: '[12][0-9]{3}',
			hint: 'A year, e.g. 2024',
			input_mode: 'numeric',
			max: 2026
		}
	],
	fr: [
		{
			id: 'place',
			name: 'Lieu',
			format: 'list',
			input_mode: 'text',
			values: [
				{ id: 'dojo', name: 'Dojo' },
				{ id: 'outdoor', name: 'Extérieur' }
			]
		},
		{ id: 'rain', name: 'Pluie', input_mode: 'text' },
		{ id: 'note', name: 'Remarque', format: 'free', input_mode: 'text' },
		{
			id: 'year',
			name: 'Année',
			format: 'regexp',
			regexp: '[12][0-9]{3}',
			hint: 'Une année, par ex. 2024',
			input_mode: 'numeric',
			max: 2026
		}
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
		limits: { max_bytes: 20 * 1024 ** 3, extensions: ['mp4', 'mov', 'mkv', 'webm'], book_max_bytes: 1024 ** 3 },
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
	await page.route('/api/uploads/limits', (r) => r.fulfill({ json: fake.limits }));
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
	await expect(page.locator(PLAYER)).toBeVisible();
	await expect(page.getByRole('slider', { name: 'Timeline' })).toBeVisible();
}

/** The timeline's box, scrolled into view (raw mouse events don't scroll). */
async function timeline(page: Page, name = 'Timeline') {
	const slider = page.getByRole('slider', { name });
	await slider.scrollIntoViewIfNeeded();
	return (await slider.boundingBox())!;
}

/** Drag on the timeline between two fractions of its width. */
async function drag(page: Page, from: number, to: number, name = 'Timeline') {
	const box = await timeline(page, name);
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
	await expect(page.locator(PLAYER)).toHaveCount(0);
});

test('only the accepted types can be picked; others are refused before hashing', async ({ page }) => {
	await setup(page);
	await page.goto('/upload');
	const input = page.getByLabel('Video file');
	await expect(input).toHaveAttribute('accept', '.mp4,.mov,.mkv,.webm');
	let checked = false;
	page.on('request', (r) => (checked ||= r.url().includes('/api/videos/exists')));
	await input.setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
	await expect(page.getByRole('alert')).toHaveText('This type of file is not accepted. Accepted: mp4, mov, mkv, webm.');
	await expect(page.locator(PLAYER)).toHaveCount(0);
	expect(checked).toBe(false); // not hashed, not sent
});

test('a file over the size limit is refused before hashing; in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page, UPLOADER, { limits: { max_bytes: CLIP_SIZE - 1, extensions: ['webm'], book_max_bytes: 1 } });
	await page.goto('/upload');
	await page.getByLabel('Fichier vidéo').setInputFiles(CLIP);
	const max = new Intl.NumberFormat('fr', { maximumSignificantDigits: 3 }).format((CLIP_SIZE - 1) / 1024 ** 3);
	await expect(page.getByRole('alert')).toHaveText(`Ce fichier est trop volumineux : ${max} Go au plus.`);
	await expect(page.locator(PLAYER)).toHaveCount(0);
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

test('the file name above the video, me as uploader and as the author of my segments', async ({ page }) => {
	await setup(page);
	await openClip(page);
	await expect(page.locator('.about .filename')).toHaveText('clip.webm');
	await expect(page.locator('.about .uploader')).toHaveText('Uploaded by kenji');
	await drag(page, 0.1, 0.4);
	await expect(page.getByRole('article', { name: 'Segment 1' }).locator('header .author')).toHaveText(
		'Created by kenji'
	);
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
	await expect(first.getByLabel('Category')).toHaveValue('taijutsu'); // the only one: filled in
	await first.getByLabel('Scroll or form').selectOption('gyokko.taijutsu.jo_ryaku');
	await first.getByLabel('Technique').selectOption(KOKU);
	await first.getByLabel('Performer').selectOption({ label: 'Add a performer…' });
	await first.getByPlaceholder("Performer's name").fill('Noguchi');
	await first.getByRole('button', { name: 'Add' }).first().click();
	await expect(first.getByLabel('Performer')).toHaveValue('noguchi');
	await first.getByLabel('Add a tag').selectOption({ label: 'Place' });
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
	// The new segment starts with the previous one's place in the catalogue and performer.
	await expect(second.getByLabel('School')).toHaveValue('gyokko');
	await expect(second.getByLabel('Scroll or form')).toHaveValue('gyokko.taijutsu.jo_ryaku');
	await expect(second.getByLabel('Technique')).toHaveValue('');
	await expect(second.getByLabel('Performer')).toHaveValue('noguchi');
	await second.getByLabel('Technique').selectOption(KOKU);

	await allDone(page).check();
	await proceed(page).click();
	await expect(page.getByRole('status')).toContainText('Uploaded.');
	expect(fake.tusRequests).toEqual(['POST /files/', 'PATCH /files/abc123']);

	const [{ url, body }] = fake.submitted as { url: string; body: Record<string, unknown> }[];
	expect(url).toMatch(/\/api\/uploads\/abc123\/submit$/);
	expect(body).toMatchObject({ original_filename: 'clip.webm', all_segments_done: true, tags: [] });
	const segments = body.segments as { begin_s: number; end_s: number }[];
	expect(segments).toHaveLength(2);
	expect(segments[0]).toMatchObject({
		technique: KOKU,
		performer: 'noguchi',
		tags: [{ id: 'place', value: 'outdoor' }]
	}); // the ID, not the name
	// Whole seconds, begin down, end up; drag 10–40 % of 4 s ≈ 0.4–1.6 s.
	expect(segments[0].begin_s).toBe(0);
	expect(segments[0].end_s).toBe(2);
	expect(segments[1].begin_s).toBeGreaterThanOrEqual(2);
	expect(segments[1].end_s).toBe(4);
	await expect(page.locator(PLAYER)).toHaveCount(0); // page reset
});

test('choosing a technique: one select per step, a weapon only under Buki', async ({ page }) => {
	await setup(page);
	await openClip(page);
	await drag(page, 0.1, 0.4);
	const segment = page.getByRole('article', { name: 'Segment 1' });
	const select = (label: string) => segment.getByLabel(label);
	const options = (label: string) => select(label).locator('option').allTextContents();

	await select('School').selectOption('kukishinden');
	// Every category, whatever the school teaches (Muto Dori: none in Kukishin Ryu).
	expect(await options('Category')).toEqual(['Choose…', 'Taijutsu', 'Muto Dori', 'Buki', 'Other…']);
	await expect(select('Weapon')).toHaveCount(0);
	await expect(select('Scroll or form')).toBeDisabled();

	await select('Category').selectOption('buki');
	expect(await options('Weapon')).toEqual(['Choose…', 'Rokushakubo', 'Hanbo', 'Other…']);
	await select('Weapon').selectOption('rokushakubo');
	// A single section and a single technique: filled in.
	await expect(select('Scroll or form')).toHaveValue('kukishinden.buki.rokushakubo.shoden');
	await expect(select('Technique')).toHaveValue(STAFF);

	// Another weapon: the steps after it start again.
	await select('Weapon').selectOption('hanbo');
	await expect(select('Scroll or form')).toHaveValue('kukishinden.buki.hanbo.okuden');
	await expect(select('Technique')).toHaveValue('kukishinden.buki.hanbo.okuden.hane_otoshi');

	// Back to Taijutsu: no weapon select any more.
	await select('Category').selectOption('taijutsu');
	await expect(select('Weapon')).toHaveCount(0);
	await expect(select('Technique')).toHaveValue('kukishinden.taijutsu.shoden.seion');

	// Another school: everything after it again.
	await select('School').selectOption('gyokko');
	await expect(select('Category')).toHaveValue('taijutsu');
	await expect(select('Scroll or form')).toHaveValue('');
	await expect(select('Technique')).toBeDisabled();

	// A category or a weapon the school has no scroll in yet: chosen all the same, its scroll new.
	await select('Category').selectOption('buki');
	await expect(select('Weapon')).toHaveValue(''); // Gyokko Ryu has none of its own
	expect(await options('Weapon')).toEqual(['Choose…', 'Rokushakubo', 'Hanbo', 'Other…']);
	await select('Weapon').selectOption('hanbo');
	expect(await options('Scroll or form')).toEqual(['Choose…', 'Other…']);
	await select('Category').selectOption('taijutsu');
	await expect(select('Weapon')).toHaveCount(0);

	// A scroll the catalogue lacks: named here, its technique new too (segments share the books' picker).
	await select('Scroll or form').selectOption({ label: 'Other…' });
	await expect(select('Technique')).toBeDisabled();
	await expect(segment.locator('[data-new]')).toHaveCount(2);
	await expect(segment.getByRole('button', { name: 'Add to the catalogue' })).toBeDisabled();
});

test('in French: the steps of the technique', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.goto('/upload');
	await page.getByLabel('Fichier vidéo').setInputFiles(CLIP);
	await drag(page, 0.1, 0.4, 'Chronologie');
	const segment = page.getByRole('article', { name: 'Segment 1' });
	await segment.getByLabel('École').selectOption('kukishinden');
	await segment.getByLabel('Catégorie').selectOption('buki');
	await expect(segment.getByLabel('Arme')).toBeVisible();
	await expect(segment.getByLabel('Rouleau ou forme')).toBeVisible();
});

test('server cannot receive uploads: warned at once, annotating still possible', async ({ page }) => {
	await setup(page, UPLOADER, { available: false });
	await openClip(page);
	await expect(page.getByRole('alert')).toContainText("the server's upload service (tusd) is not running");
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

test("upload refused by the server's hook: its reason, translated", async ({ page }) => {
	await setup(page);
	await page.route('/files/**', (r) =>
		r.fulfill({
			status: 413,
			json: { code: 'upload.too_large', detail: 'File too large', params: {} },
			headers: { 'Tus-Resumable': '1.0.0' }
		})
	);
	await openClip(page);
	await page.getByLabel('Define segments later').check();
	await proceed(page).click();
	await expect(page.getByRole('alert')).toHaveText(
		'The upload failed. This file is too large. Proceed again to continue where it stopped.'
	);
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
	await expect(page.locator(PLAYER)).toHaveCount(0);
	await expect(page.getByText('Unfinished uploads on this device')).toHaveCount(0);
});

test('my uploads: queue position, encoding progress, failure with retry', async ({ page }) => {
	await setup(page, UPLOADER, {
		mine: [
			{
				id: 3,
				original_filename: 'c.mov',
				status: 'failed',
				progress: 10,
				error: 'Encoding failed',
				uploaded_at: '2027-01-15T09:00:00+01:00',
				queue_position: null
			},
			{
				id: 2,
				original_filename: 'b.mov',
				status: 'queued',
				progress: 0,
				error: null,
				uploaded_at: '2027-01-15T09:00:00+01:00',
				queue_position: 2
			},
			{
				id: 1,
				original_filename: 'a.mov',
				status: 'encoding',
				progress: 42,
				error: null,
				uploaded_at: '2027-01-15T09:00:00+01:00',
				queue_position: null
			}
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

test('nothing queued or encoding: my uploads are not polled', async ({ page }) => {
	await page.clock.install();
	await setup(page, UPLOADER, {
		mine: [
			{
				id: 2,
				original_filename: 'b.mov',
				status: 'failed',
				progress: 10,
				error: 'Encoding failed',
				uploaded_at: '2027-01-15T09:00:00+01:00',
				queue_position: null
			},
			{
				id: 1,
				original_filename: 'a.mov',
				status: 'published',
				progress: 100,
				error: null,
				uploaded_at: '2027-01-15T09:00:00+01:00',
				queue_position: null
			}
		]
	});
	let requests = 0;
	await page.route('/api/uploads/mine', (r) => {
		requests++;
		return r.fallback();
	});
	await page.goto('/upload');
	await expect(page.getByText('Failed: Encoding failed')).toBeVisible();
	const shown = requests;
	await page.clock.fastForward('00:30');
	await page.evaluate(() => new Promise(requestAnimationFrame));
	expect(requests).toBe(shown);
});

test('a video just published: the catalogue is fetched again at once', async ({ page }) => {
	const status = {
		id: 1,
		original_filename: 'a.mov',
		status: 'encoding',
		progress: 90,
		error: null,
		uploaded_at: '2027-01-15T09:00:00+01:00',
		queue_position: null
	};
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
const shown = (page: Page) => page.locator(PLAYER).evaluate((v: HTMLVideoElement) => v.currentTime);
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

// Exact frame steps need the frame duration, measured from the frame callbacks
// (requestVideoFrameCallback) of a hidden video ($lib/frames.ts).
test.describe('frame by frame', () => {
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
				const after = await shown(page);
				// Wherever the click landed in its frame: the next frame, on the 25 fps grid
				// (a hundredth of a frame in), which needs the measured 40 ms.
				return [Math.floor(after * 25) - Math.floor(before * 25), Math.round(((after * 25) % 1) * 100)];
			})
			.toEqual([1, 1]);
	});
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

// A finger never creates a segment (every swipe meant to scroll the page would): it moves the
// playhead; "Begin here" / "End here" make the segment, whose edges a finger still drags.
test.describe('with a finger', () => {
	test.use({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
	test.skip(({ browserName }) => browserName !== 'chromium', 'touch drags need the DevTools protocol');

	const segments = (page: Page) => page.getByRole('article', { name: /^Segment \d+$/ });

	test('slid sideways on the timeline: the playhead follows it, no segment', async ({ page }) => {
		await setup(page);
		await openClip(page); // 4 s
		const box = await timeline(page);
		const y = box.y + box.height / 2;
		await touchDrag(page, [box.x + box.width * 0.1, y], [box.x + box.width * 0.6, y]);
		await expect(marker(page)).toHaveAttribute('aria-valuenow', '2'); // 60 % of 4 s, rounded
		await expect(segments(page)).toHaveCount(0);
		await expect(page.locator('.segment')).toHaveCount(0); // not even a preview left behind
	});

	test('swiped up on the timeline: the page scrolls, nothing else changes', async ({ page }) => {
		await setup(page);
		await openClip(page);
		const box = await timeline(page);
		const x = box.x + box.width * 0.3;
		const y = box.y + box.height / 2;
		const before = await page.evaluate(() => scrollY);
		await touchDrag(page, [x, y], [x + 4, y - 250]);
		await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
		await expect(marker(page)).toHaveAttribute('aria-valuenow', '0'); // not moved
		await expect(segments(page)).toHaveCount(0);
	});

	test('a tap seeks; Begin here and End here make the segment; a finger resizes it by its edge', async ({ page }) => {
		await setup(page);
		await openClip(page); // 4 s
		let box = await timeline(page);
		const y = box.y + box.height / 2;
		const tap = (fraction: number) =>
			touchDrag(page, [box.x + box.width * fraction, y], [box.x + box.width * fraction, y], 0, 1);

		await tap(0.25);
		await expect(marker(page)).toHaveAttribute('aria-valuenow', '1');
		await page.getByRole('button', { name: 'Begin here' }).click();
		box = await timeline(page);
		await tap(0.5);
		await expect(marker(page)).toHaveAttribute('aria-valuenow', '2');
		await page.getByRole('button', { name: 'End here' }).click();
		await expect(segments(page)).toHaveCount(1);

		// Its end edge dragged by a finger, from 50 % to 90 %: resized, nothing created.
		box = await timeline(page);
		const band = page.locator('.track .segment');
		const before = (await band.boundingBox())!;
		await touchDrag(page, [before.x + before.width, y], [box.x + box.width * 0.9, y]);
		await expect.poll(async () => (await band.boundingBox())!.width).toBeGreaterThan(before.width * 2);
		await expect(segments(page)).toHaveCount(1);
		expect((await band.boundingBox())!.x).toBeCloseTo(before.x, 0); // its begin kept
	});

	test('a tap on a segment selects it, a tap elsewhere deselects it', async ({ page }) => {
		await setup(page);
		await openClip(page);
		await drag(page, 0.2, 0.5); // a mouse still creates one
		const band = page.locator('.track .segment');
		await expect(band).toHaveCount(1);
		const box = await timeline(page);
		const y = box.y + box.height / 2;
		const tap = (x: number) => touchDrag(page, [x, y], [x, y], 0, 1);
		await tap(box.x + box.width * 0.8);
		await expect(band).not.toHaveClass(/selected/);
		await tap(box.x + box.width * 0.35);
		await expect(band).toHaveClass(/selected/);
		await expect(marker(page)).toHaveAttribute('aria-valuenow', '1'); // 35 % of 4 s, and seeks
	});
});

test('tags: shown by their translated names, kept by ID', async ({ page }) => {
	await setup(page);
	await openClip(page);
	const video = page.locator('.card', { has: page.getByText('Tags of the video') });
	const names = video.getByLabel('Add a tag').locator('option');
	await expect(names).toHaveText(['Add a tag', 'Note', 'Place', 'Rain', 'Year']);
	await video.getByLabel('Add a tag').selectOption({ label: 'Place' });
	await expect(video.getByLabel('Value').locator('option')).toHaveText(['Value', 'Dojo', 'Outdoor']);
	await video.getByLabel('Value').selectOption({ label: 'Outdoor' });
	await video.getByRole('button', { name: 'Add', exact: true }).click();
	await video.getByLabel('Add a tag').selectOption({ label: 'Note' });
	await video.getByLabel('Value').fill('Très bien');
	await video.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(video.locator('.chip')).toHaveText(['Place: Outdoor', 'Note: Très bien']);
	await expect(names).toHaveText(['Add a tag', 'Rain', 'Year']); // a tag once only

	// Another language: the names are reloaded and the chips relabelled; free text stays as typed.
	await page.getByRole('button', { name: 'Language: English' }).click();
	await page.getByRole('menuitemradio', { name: 'Français' }).click();
	const videoFr = page.locator('.card', { has: page.getByText('Étiquettes de la vidéo') });
	await expect(videoFr.locator('.chip')).toHaveText(['Lieu : Extérieur', 'Remarque : Très bien']);
});

test("a new segment starts with the video's tags, then edited on its own before Proceed", async ({ page }) => {
	const fake = await setup(page);
	await openClip(page);
	const video = page.locator('.card', { has: page.getByText('Tags of the video') });
	await video.getByLabel('Add a tag').selectOption({ label: 'Place' });
	await video.getByLabel('Value').selectOption({ label: 'Dojo' });
	await video.getByRole('button', { name: 'Add', exact: true }).click();
	await video.getByLabel('Add a tag').selectOption({ label: 'Year' });
	await video.getByLabel('A year, e.g. 2024').fill('2024');
	await video.getByRole('button', { name: 'Add', exact: true }).click();

	await drag(page, 0.1, 0.5);
	const first = page.getByRole('article', { name: 'Segment 1' });
	await expect(first.locator('.chip')).toHaveText(['Place: Dojo', 'Year: 2024']);
	// Edited on the segment alone: one removed, another added; the video keeps its own.
	await first.getByRole('button', { name: 'Remove the tag Year' }).click();
	await first.getByLabel('Add a tag').selectOption({ label: 'Rain' });
	await first.getByRole('button', { name: 'Add', exact: true }).click();
	await expect(first.locator('.chip')).toHaveText(['Place: Dojo', 'Rain']);
	await expect(video.locator('.chip')).toHaveText(['Place: Dojo', 'Year: 2024']);

	await first.getByLabel('School').selectOption('gyokko');
	await first.getByLabel('Scroll or form').selectOption('gyokko.taijutsu.jo_ryaku');
	await first.getByLabel('Technique').selectOption(KOKU);
	await first.getByLabel('Performer').selectOption('hatsumi');
	await allDone(page).check();
	await proceed(page).click();
	await expect(page.getByRole('status')).toContainText('Uploaded.');
	const [{ body }] = fake.submitted as { body: Record<string, unknown> }[];
	expect(body).toMatchObject({
		tags: [
			{ id: 'place', value: 'dojo' },
			{ id: 'year', value: '2024' }
		],
		segments: [{ tags: [{ id: 'place', value: 'dojo' }, { id: 'rain' }] }]
	});
});

test('a tag follows its rule: pattern and bounds, hint and keyboard, or no value', async ({ page }) => {
	await setup(page);
	await openClip(page);
	const video = page.locator('.card', { has: page.getByText('Tags of the video') });
	await video.getByLabel('Add a tag').selectOption({ label: 'Year' });
	const year = video.getByLabel('A year, e.g. 2024');
	await expect(year).toHaveAttribute('inputmode', 'numeric');
	const add = video.getByRole('button', { name: 'Add', exact: true });
	for (const [wrong, why] of [
		['0999', 'Year: the value does not have the expected form.'],
		['99', 'Year: the value does not have the expected form.'],
		['2027', 'Year: enter a number from … to 2026.']
	]) {
		await year.fill(wrong);
		await expect(add).toBeDisabled();
		await expect(video.getByText(why)).toBeVisible();
		await expect(year).toHaveAttribute('aria-invalid', 'true');
	}
	await year.fill('2024');
	await expect(video.locator('.error')).toHaveCount(0);
	await add.click();

	// No value: the tag alone.
	await video.getByLabel('Add a tag').selectOption({ label: 'Rain' });
	await expect(video.getByLabel('Value')).toHaveCount(0);
	await add.click();
	await expect(video.locator('.chip')).toHaveText(['Year: 2024', 'Rain']);
});

test('"Test local codecs" beside the title opens that page', async ({ page }) => {
	await setup(page);
	await page.goto('/upload');
	const title = page.getByRole('heading', { level: 1, name: 'Upload a video' });
	const link = page.getByRole('link', { name: 'Test local codecs' });
	await expect(link).toHaveAttribute('href', '/upload/codecs');
	// Beside it on a wide screen: the same line, to its right.
	const [t, l] = await Promise.all([title.boundingBox(), link.boundingBox()]);
	expect(l!.x).toBeGreaterThan(t!.x + t!.width);
	expect(Math.abs(l!.y + l!.height / 2 - (t!.y + t!.height / 2))).toBeLessThan(t!.height / 2);
	await link.click();
	await expect(page).toHaveURL('/upload/codecs');
	await expect(page.getByRole('heading', { level: 1, name: 'Test local codecs' })).toBeVisible();
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

test.describe('mass import', () => {
	const batch = (page: Page) => page.getByRole('region', { name: 'Import several videos' });
	const list = (page: Page) => batch(page).getByRole('list', { name: 'Videos to import' });

	/** tusd for several files: each one its own URL, done in one PATCH (its whole length).
	 * Answers its requests ("METHOD path"), filled as they come. */
	async function tusd(page: Page) {
		const sizes: number[] = [];
		const requests: string[] = [];
		await page.route('/files/**', (r) => {
			const req = r.request();
			requests.push(`${req.method()} ${new URL(req.url()).pathname}`);
			const tus = { 'Tus-Resumable': '1.0.0' };
			if (req.method() === 'POST') {
				sizes.push(Number(req.headers()['upload-length']));
				return r.fulfill({ status: 201, headers: { ...tus, Location: `/files/up${sizes.length}` } });
			}
			// PATCH: all received; HEAD (resuming): all there already.
			const size = String(sizes[Number(new URL(req.url()).pathname.replace('/files/up', '')) - 1]);
			return r.fulfill({
				status: req.method() === 'HEAD' ? 200 : 204,
				headers: { ...tus, 'Upload-Offset': size, 'Upload-Length': size, 'Cache-Control': 'no-store' }
			});
		});
		return requests;
	}

	test('videos added in several picks, the same tags for all, then Process: each uploaded and queued', async ({
		page
	}) => {
		const fake = await setup(page);
		await tusd(page);
		let mineLoads = 0;
		await page.route('/api/uploads/mine', (r) => (mineLoads++, r.fulfill({ json: fake.mine })));
		await page.goto('/upload');
		await expect(batch(page).getByText('No video added yet.')).toBeVisible();
		const process = batch(page).getByRole('button', { name: /^Process/ });
		await expect(process).toBeDisabled();

		// First pick: one file; second pick: two more and one of another type.
		await batch(page).getByLabel('Add videos').setInputFiles(CLIP);
		await batch(page)
			.getByLabel('Add videos')
			.setInputFiles([
				...['clip-6s.webm', 'clip-9s.webm'].map((name) => ({
					name,
					mimeType: 'video/webm',
					buffer: readFileSync(`tests/fixtures/${name}`)
				})),
				{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes') }
			]);
		await batch(page).getByLabel('Add videos').setInputFiles(CLIP); // listed once only
		const rows = list(page).getByRole('listitem');
		await expect(rows.locator('.name')).toHaveText(['clip.webm', 'clip-6s.webm', 'clip-9s.webm', 'notes.txt']);
		await expect(rows.locator('.status')).toHaveText(['Waiting', 'Waiting', 'Waiting', 'Refused']);
		await expect(rows.nth(3)).toContainText('This type of file is not accepted');
		await expect(process).toHaveText('Process (3)');

		// One removed again, the refused one too.
		await list(page).getByRole('button', { name: 'Remove clip-9s.webm' }).click();
		await list(page).getByRole('button', { name: 'Remove notes.txt' }).click();
		await expect(rows.locator('.name')).toHaveText(['clip.webm', 'clip-6s.webm']);

		// The tags of every video: a value from a list, and a year.
		await batch(page).getByLabel('Add a tag').selectOption({ label: 'Place' });
		await batch(page).getByLabel('Value').selectOption({ label: 'Dojo' });
		await batch(page).getByRole('button', { name: 'Add', exact: true }).click();
		await batch(page).getByLabel('Add a tag').selectOption({ label: 'Year' });
		await batch(page).getByLabel('A year, e.g. 2024').fill('2024');
		await batch(page).getByRole('button', { name: 'Add', exact: true }).click();
		await expect(batch(page).locator('.chip')).toHaveText(['Place: Dojo', 'Year: 2024']);

		const loadsBefore = mineLoads;
		await process.click();
		await expect(batch(page).getByRole('status')).toContainText('2 video(s) uploaded');
		await expect(rows.locator('.status')).toHaveText(['Queued for encoding', 'Queued for encoding']);
		const tags = [
			{ id: 'place', value: 'dojo' },
			{ id: 'year', value: '2024' }
		];
		expect(fake.submitted).toEqual([
			{
				url: expect.stringMatching(/\/api\/uploads\/up1\/submit$/),
				body: { original_filename: 'clip.webm', all_segments_done: false, segments: [], tags }
			},
			{
				url: expect.stringMatching(/\/api\/uploads\/up2\/submit$/),
				body: { original_filename: 'clip-6s.webm', all_segments_done: false, segments: [], tags }
			}
		]);
		expect(mineLoads).toBeGreaterThan(loadsBefore); // "my uploads" reloaded
		await expect(process).toBeDisabled();

		// The button can be used again; the finished ones can go.
		await batch(page).getByLabel('Add videos').setInputFiles('tests/fixtures/clip-12s.webm');
		await expect(process).toHaveText('Process (1)');
		await batch(page).getByRole('button', { name: 'Remove finished' }).click();
		await expect(rows.locator('.name')).toHaveText(['clip-12s.webm']);
	});

	test('a video on the server already is skipped; an upload refused fails alone and is retried', async ({ page }) => {
		const fake = await setup(page);
		const tusMethods = await tusd(page);
		await page.route('/api/videos/exists*', (r) =>
			// clip.webm is known (its hash, in the URL).
			r.fulfill({ json: { exists: r.request().url().includes(CLIP_SHA) } })
		);
		let refuse = true;
		await page.route('/api/uploads/*/submit', (r) => {
			if (refuse) {
				refuse = false;
				return r.fulfill({ status: 503, json: { code: 'busy', detail: 'Busy', params: {} } });
			}
			fake.submitted.push(r.request().postDataJSON());
			return r.fulfill({ status: 201, json: { id: 2 } });
		});
		await page.goto('/upload');
		await batch(page).getByLabel('Add videos').setInputFiles([CLIP, 'tests/fixtures/clip-6s.webm']);
		await batch(page).getByRole('button', { name: 'Process (2)' }).click();
		const rows = list(page).getByRole('listitem');
		await expect(rows.locator('.status')).toHaveText(['Already on the server', 'Failed']);
		await expect(rows.nth(1).locator('.error')).toBeVisible();
		expect(fake.submitted).toEqual([]);

		await batch(page).getByRole('button', { name: 'Process (1)' }).click();
		await expect(rows.locator('.status')).toHaveText(['Already on the server', 'Queued for encoding']);
		expect(fake.submitted).toHaveLength(1);
		expect(tusMethods.slice(-1)).toEqual(['HEAD /files/up1']); // resumed: not sent again
	});

	test('the server cannot receive uploads: Process says so; in French', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
		const fake = await setup(page, UPLOADER, { available: false });
		await page.goto('/upload');
		const section = page.getByRole('region', { name: 'Importer plusieurs vidéos' });
		await section.getByLabel('Ajouter des vidéos').setInputFiles(CLIP);
		await expect(section.locator('.status')).toHaveText(['En attente']);
		await section.getByRole('button', { name: 'Traiter (1)' }).click();
		await expect(section.getByRole('alert')).toContainText('Les téléversements sont impossibles');
		expect(fake.tusRequests).toEqual([]);
	});
});
