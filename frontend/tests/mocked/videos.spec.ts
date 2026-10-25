import { expect, test, type Page } from '@playwright/test';
import { CATALOG as FULL, KETO, KOKU } from '../catalog';
import { fulfillClip } from '../clip';

// The Videos page (video_mgmt access): published videos by section, and the
// annotation panel for one of them. The API is faked and keeps what is saved.
const CATALOG = { ...FULL, segments: [] };
const MANAGER = ['segment', 'comment', 'annotate', 'upload', 'video_mgmt'];
const video = (id: number, segment_count: number, all_segments_done: boolean, duration_s: number | null = 65.4) => ({
	id,
	original_filename: `kata-${id}.mp4`,
	uploaded_at: '2027-01-15T09:00:00+01:00',
	duration_s,
	all_segments_done,
	segment_count
});
const VIDEOS = [
	video(1, 2, false), // in progress
	video(2, 0, false), // to annotate
	video(3, 0, false, null), // to annotate, duration unknown
	video(4, 3, true), // complete
	video(5, 0, true) // no technique
];
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
	'base64'
);

async function setup(page: Page, access = MANAGER) {
	const sent: { method: string; path: string; body?: unknown }[] = [];
	let annotations = {
		all_segments_done: false,
		original_filename: 'kata-1.mp4',
		uploaded_by: 'Hana',
		tags: [],
		segments: [
			{ id: 11, begin_s: 1, end_s: 2, technique: KOKU, performer: 'hatsumi', tags: [], created_by: 'Hana' },
			{ id: 12, begin_s: 2, end_s: 3, technique: KETO, performer: 'hatsumi', tags: [], created_by: null }
		]
	};
	page.on('request', (r) => {
		const path = new URL(r.url()).pathname;
		if (path.startsWith('/api/') || path.startsWith('/files')) sent.push({ method: r.method(), path, body: r.postDataJSON?.() ?? undefined });
	});
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) =>
		r.fulfill({ json: { username: 'kenji', name: null, role: 'video_mgmt', role_name: 'Video manager', access } })
	);
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.route('/api/videos', (r) => r.fulfill({ json: VIDEOS }));
	await page.route('/api/videos/1/annotations', (r) => {
		if (r.request().method() === 'PUT') annotations = r.request().postDataJSON();
		return r.fulfill({ json: annotations });
	});
	await page.route('/api/performers', (r) => r.fulfill({ json: [{ id: 'hatsumi', name: 'Hatsumi' }] }));
	await page.route('/api/tags', (r) => r.fulfill({ json: [] }));
	await page.route('/media/video/*/thumbnail', (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
	await page.route('/media/video/1', fulfillClip); // the 4 s test clip
	return sent;
}

const section = (page: Page, name: string) => page.locator('details.section', { has: page.locator('summary', { hasText: name }) });

test('Videos: in the menu after Upload, only with the video_mgmt access', async ({ page }) => {
	await setup(page);
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Videos']);
	await nav.getByRole('link', { name: 'Videos' }).click();
	await expect(page).toHaveURL('/videos');
	await expect(page.getByRole('heading', { name: 'Videos', level: 1 })).toBeVisible();
});

test('header on a desktop: the icon left of the name, the entries side by side', async ({ page }) => {
	await setup(page);
	await page.goto('/schools');
	const brand = page.getByRole('link', { name: 'Video Ninja' });
	const [icon, name] = [brand.locator('img'), brand.getByText('Video Ninja')];
	await expect(icon).toBeVisible();
	await expect(name).toBeVisible();
	expect((await icon.boundingBox())!.x).toBeLessThan((await name.boundingBox())!.x);
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Videos']);
	await expect(nav.getByRole('button')).toHaveCount(0);
});

test.describe('header on a phone', () => {
	test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

	test('the icon only; the entries in a drop-down named after the current page', async ({ page }) => {
		await setup(page);
		await page.goto('/schools');
		const brand = page.getByRole('link', { name: 'Video Ninja' }); // still its name, for screen readers
		await expect(brand.locator('img')).toBeVisible();
		expect((await brand.boundingBox())!.width).toBeLessThan(40);

		const nav = page.getByRole('navigation', { name: 'Main navigation' });
		await expect(nav.getByRole('link')).toHaveCount(0); // folded
		const menu = nav.getByRole('button', { name: 'Schools' });
		await expect(menu).toHaveAttribute('aria-expanded', 'false');
		await menu.click();
		await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Videos']);
		await expect(nav.getByRole('link', { name: 'Schools' })).toHaveAttribute('aria-current', 'page');
		await nav.getByRole('link', { name: 'Videos' }).click();
		await expect(page).toHaveURL('/videos');
		await expect(nav.getByRole('link')).toHaveCount(0); // closed on navigation
		await expect(nav.getByRole('button', { name: 'Videos' })).toBeVisible();

		// Not on a page of the menu: "Menu". Escape and a click outside close it.
		await page.goto('/profile');
		await nav.getByRole('button', { name: 'Menu' }).click();
		await page.keyboard.press('Escape');
		await expect(nav.getByRole('link')).toHaveCount(0);
		await nav.getByRole('button', { name: 'Menu' }).click();
		await page.locator('.content').click({ position: { x: 5, y: 200 } });
		await expect(nav.getByRole('link')).toHaveCount(0);

		// Everything fits: no sideways scrolling.
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
	});

	test('a single entry stays a plain link', async ({ page }) => {
		await setup(page, ['segment']);
		await page.goto('/');
		const nav = page.getByRole('navigation', { name: 'Main navigation' });
		await expect(nav.getByRole('link')).toHaveText(['Schools']);
		await expect(nav.getByRole('button')).toHaveCount(0);
	});

	test('in French', async ({ page }) => {
		await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
		await setup(page);
		await page.goto('/profile');
		await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button')).toHaveText('Menu');
		await page.goto('/videos');
		await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('button')).toHaveText('Vidéos');
	});
});

test('without the access: no entry, page not reachable', async ({ page }) => {
	await setup(page, ['segment', 'upload']);
	await page.goto('/');
	await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveText(['Schools', 'Upload']);
	await page.goto('/videos');
	await expect(page).toHaveURL('/');
});

test('four sections in order, the first open, each scrolling by itself', async ({ page }) => {
	await setup(page);
	await page.goto('/videos');
	await expect(page.locator('details.section summary .name')).toHaveText(['In progress', 'To annotate', 'Complete', 'No technique']);
	await expect(page.locator('details.section summary .count')).toHaveText(['1 video(s)', '2 video(s)', '1 video(s)', '1 video(s)']);
	const open = await page.locator('details.section').evaluateAll((all) => all.map((d) => (d as HTMLDetailsElement).open));
	expect(open).toEqual([true, false, false, false]);

	// Collapsible.
	const toAnnotate = section(page, 'To annotate');
	await toAnnotate.locator('summary').click();
	await expect(toAnnotate.getByRole('link')).toHaveCount(2);
	await expect(toAnnotate.getByRole('link').first()).toHaveAttribute('href', '/videos/2');
	await section(page, 'In progress').locator('summary').click();
	await expect(section(page, 'In progress').getByRole('link')).toBeHidden();

	// Its own scroll bar, at most about the screen's height.
	const grid = toAnnotate.locator('.grid');
	expect(await grid.evaluate((g) => getComputedStyle(g).overflowY)).toBe('auto');
	expect((await grid.boundingBox())!.height).toBeLessThan(page.viewportSize()!.height);
});

test('each section: an arrow on the right, pointing right when collapsed, down when expanded', async ({ page }) => {
	await setup(page);
	await page.goto('/videos');
	/** The arrow's rotation in degrees (0: down) and its place on the section's title line. */
	const arrow = (name: string) =>
		section(page, name).locator('summary').evaluate((summary) => {
			const icon = summary.querySelector('.arrow')!;
			const { a, b } = new DOMMatrix(getComputedStyle(icon).transform === 'none' ? undefined : getComputedStyle(icon).transform);
			const box = icon.getBoundingClientRect();
			const line = summary.getBoundingClientRect();
			const count = summary.querySelector('.count')!.getBoundingClientRect();
			return {
				degrees: Math.round((Math.atan2(b, a) * 180) / Math.PI),
				right: line.right - box.right < 24, // at the right end
				titleLine: box.top < count.bottom && box.bottom > count.top // on the title's line, not the hint's
			};
		});
	await expect.poll(() => arrow('In progress')).toEqual({ degrees: 0, right: true, titleLine: true }); // open: down
	await expect.poll(() => arrow('To annotate')).toEqual({ degrees: -90, right: true, titleLine: true }); // closed: right
	// The browser's own marker is hidden: one arrow only.
	expect(await section(page, 'To annotate').locator('summary').evaluate((s) => getComputedStyle(s).listStyleType)).toBe('none');

	await section(page, 'To annotate').locator('summary').click(); // expanded
	await expect.poll(() => arrow('To annotate').then((a) => a.degrees)).toBe(0);
	await section(page, 'In progress').locator('summary').click(); // collapsed
	await expect.poll(() => arrow('In progress').then((a) => a.degrees)).toBe(-90);
});

test('thumbnail: bottom right, the duration then whether the video is on the device', async ({ page }) => {
	await setup(page);
	await page.goto('/videos');
	const link = section(page, 'In progress').getByRole('link');
	await expect(link).toHaveAccessibleName('Annotate kata-1.mp4 (1:05)');
	const picture = (await link.locator('img').boundingBox())!;
	const duration = link.locator('.duration');
	await expect(duration).toHaveText('1:05');
	// No service worker here: not downloaded.
	const badge = link.getByRole('img', { name: 'Not downloaded' });
	await expect(badge).toHaveAttribute('title', 'Not downloaded');
	const icon = (await badge.boundingBox())!;
	const box = (await duration.boundingBox())!;
	expect(picture.x + picture.width - (icon.x + icon.width)).toBeLessThan(12); // right
	expect(picture.y + picture.height - (icon.y + icon.height)).toBeLessThan(12); // bottom
	expect(box.x + box.width).toBeLessThanOrEqual(icon.x); // the duration left of it
	expect(picture.y + picture.height - (box.y + box.height)).toBeLessThan(12);
	await expect(link).toContainText('kata-1.mp4');
	// Unknown duration: no overlay.
	await section(page, 'To annotate').locator('summary').click();
	await expect(section(page, 'To annotate').getByRole('link').last().locator('.duration')).toHaveCount(0);
});

test('annotate a published video: its segments loaded, Proceed saves them, nothing uploaded', async ({ page }) => {
	const sent = await setup(page);
	await page.goto('/videos');
	await section(page, 'In progress').getByRole('link').click();
	await expect(page).toHaveURL('/videos/1');
	await expect(page.locator('video').first()).toHaveAttribute('src', '/media/video/1');

	// The saved segments, with their place in the catalogue.
	const first = page.getByRole('article', { name: 'Segment 1' });
	await expect(first.getByLabel('School')).toHaveValue('gyokko');
	await expect(first.getByLabel('Category')).toHaveValue('taijutsu');
	await expect(first.getByLabel('Scroll or form')).toHaveValue('gyokko.taijutsu.jo_ryaku');
	await expect(first.getByLabel('Technique')).toHaveValue(KOKU);
	await expect(page.getByRole('article', { name: 'Segment 2' }).getByLabel('Technique')).toHaveValue(KETO);

	// Change one, remove the other, mark it complete.
	await first.getByLabel('Technique').selectOption(KETO);
	page.on('dialog', (d) => d.accept());
	await page.getByRole('article', { name: 'Segment 2' }).getByRole('button', { name: 'Delete this segment' }).click();
	await page.getByRole('checkbox', { name: /All the segments have been created/ }).check();
	await page.getByRole('button', { name: 'Proceed' }).click();

	await expect(page).toHaveURL('/videos?saved');
	await expect(page.getByRole('status')).toHaveText('Saved.');
	const put = sent.find((s) => s.method === 'PUT')!;
	expect(put.path).toBe('/api/videos/1/annotations');
	expect(put.body).toEqual({
		all_segments_done: true,
		tags: [],
		segments: [{ id: 11, begin_s: 1, end_s: 2, technique: KETO, performer: 'hatsumi', tags: [] }]
	});
	expect(sent.filter((s) => s.path.startsWith('/files') || s.path.includes('/submit'))).toEqual([]); // no upload
});

test('who did what: the file name, its uploader, each segment\'s author (mine for a new one)', async ({ page }) => {
	await setup(page);
	await page.goto('/videos/1');
	const about = page.locator('.about');
	await expect(about.locator('.filename')).toHaveText('kata-1.mp4');
	await expect(about.locator('.uploader')).toHaveText('Uploaded by Hana');
	// The file name above the video, on the left; the uploader opposite.
	const [name, uploader, video] = await Promise.all(
		[about.locator('.filename'), about.locator('.uploader'), page.locator('video').first()].map((l) => l.boundingBox())
	);
	expect(name!.y + name!.height).toBeLessThanOrEqual(video!.y);
	expect(uploader!.x).toBeGreaterThan(name!.x + name!.width);

	const author = (n: number) => page.getByRole('article', { name: `Segment ${n}` }).locator('header .author');
	await expect(author(1)).toHaveText('Created by Hana');
	await expect(author(2)).toHaveText('Created by a deleted user');
	// Left of the delete button.
	const [label, cross] = await Promise.all([
		author(1).boundingBox(),
		page.getByRole('article', { name: 'Segment 1' }).getByRole('button', { name: 'Delete this segment' }).boundingBox()
	]);
	expect(label!.x + label!.width).toBeLessThanOrEqual(cross!.x);

	// A new segment (drag on the timeline): mine (no display name: the username).
	const slider = page.getByRole('slider', { name: 'Timeline' });
	await slider.scrollIntoViewIfNeeded();
	const box = (await slider.boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.95, box.y + box.height / 2, { steps: 4 });
	await page.mouse.up();
	await expect(author(3)).toHaveText('Created by kenji');
});

test('leaving with unsaved changes asks first', async ({ page }) => {
	await setup(page);
	await page.goto('/videos/1');
	await page.getByRole('article', { name: 'Segment 1' }).getByLabel('Technique').selectOption(KETO);
	// Every confirmation answered by `answer` (a click interrupted by a dialog may be
	// replayed by Playwright: never leave one open).
	const asked: string[] = [];
	let answer = false;
	page.on('dialog', (d) => (asked.push(d.message()), answer ? d.accept() : d.dismiss()));

	await page.getByRole('link', { name: /All videos/ }).press('Enter');
	await expect.poll(() => asked.length).toBeGreaterThan(0);
	expect(asked[0]).toBe('Leave without saving your changes?');
	await expect(page).toHaveURL('/videos/1'); // stayed, changes kept
	await expect(page.getByRole('article', { name: 'Segment 1' }).getByLabel('Technique')).toHaveValue(KETO);

	answer = true;
	await page.getByRole('button', { name: 'Cancel' }).press('Enter');
	await expect(page).toHaveURL('/videos');
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.goto('/videos');
	await expect(page.locator('details.section summary .name')).toHaveText(['En cours', 'À annoter', 'Terminées', 'Sans technique']);
	await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link')).toHaveText(['Écoles', 'Téléverser', 'Vidéos']);
	await expect(section(page, 'En cours').getByRole('img', { name: 'Pas téléchargé' })).toBeVisible();
	await page.goto('/videos/1');
	await expect(page.locator('.about .uploader')).toHaveText('Envoyée par Hana');
	await expect(page.getByRole('article', { name: 'Segment 1' }).locator('header .author')).toHaveText('Créé par Hana');
	await expect(page.getByRole('article', { name: 'Segment 2' }).locator('header .author')).toHaveText('Créé par un utilisateur supprimé');
});
