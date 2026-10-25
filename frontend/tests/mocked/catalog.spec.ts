import { expect, test, type Page } from '@playwright/test';
import { fulfillClip } from '../clip';
// The API is faked: school → category → (weapon) → section → techniques → technique page, and back.
import { CATALOG, KETO, KOKU } from '../catalog';

const KOKU_PAGE = '/schools/gyokko/taijutsu/jo_ryaku/koku';
const COMMENTS = [
	// Newest first, as sent by the server.
	{ id: 3, user: 'Hana', created_at: '2027-01-15T09:00:00+01:00', modified_at: '2027-01-15T09:00:00+01:00', lang: 'fr', text: 'Très bien', mine: false },
	{ id: 1, user: 'kenji', created_at: '2023-11-14T23:13:20+01:00', modified_at: '2023-11-14T23:13:20+01:00', lang: 'en', text: 'First\nsecond line', mine: true }
];

async function loggedIn(page: Page) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) =>
		r.fulfill({
			json: { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment'] }
		})
	);
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.route(`/api/techniques/${KOKU}/comments`, (r) => r.fulfill({ json: COMMENTS }));
	await page.route(`/api/techniques/${KETO}/comments`, (r) => r.fulfill({ json: [] }));
	// 1×1 PNG for every thumbnail.
	await page.route('/media/segment/*/thumbnail', (r) =>
		r.fulfill({
			contentType: 'image/png',
			body: Buffer.from(
				'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
				'base64'
			)
		})
	);
}

const crumbs = (page: Page, label = 'Breadcrumb') =>
	page.getByRole('navigation', { name: label }).getByRole('listitem');
const cards = (page: Page) => page.locator('.catalog-card');

const background = (page: Page, id: string) =>
	page.locator(`[data-id="${id}"]`).evaluate((e) => getComputedStyle(e).backgroundImage);

test('school → category → section → techniques → technique, breadcrumbs back up', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools');
	await cards(page).filter({ hasText: 'Gyokko Ryu' }).click();

	// The school's categories (Gyokko: Taijutsu only, still a step of its own), with emblems.
	await expect(page).toHaveURL('/schools/gyokko');
	await expect(page.getByRole('heading', { name: 'Categories' })).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu']);
	await expect(cards(page)).toHaveText(['体術 Taijutsu']);
	expect(await background(page, 'taijutsu')).toMatch(/^url\(/);
	await cards(page).first().click();

	// Its sections, in the school's order, with emblems.
	await expect(page).toHaveURL('/schools/gyokko/taijutsu');
	await expect(page.getByRole('heading', { name: 'Scrolls and forms' })).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Taijutsu']);
	await expect(cards(page)).toHaveText(['上略之巻 Jo Ryaku no Maki', '下略之巻 Ge Ryaku no Maki']);
	expect(await background(page, 'gyokko.taijutsu.jo_ryaku')).toMatch(/^url\(/);
	await cards(page).first().click();

	// Techniques of that section only, without background image.
	await expect(page).toHaveURL('/schools/gyokko/taijutsu/jo_ryaku');
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Taijutsu', 'Jo Ryaku no Maki']);
	await expect(cards(page)).toHaveText(['虚空 Koku', '闕倒 Keto']);
	expect(await cards(page).first().evaluate((e) => getComputedStyle(e).backgroundImage)).toBe('none');
	await cards(page).first().click();

	// Technique page.
	await expect(page).toHaveURL(KOKU_PAGE);
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Taijutsu', 'Jo Ryaku no Maki', 'Koku']);
	await expect(crumbs(page).last().locator('[aria-current="page"]')).toHaveText('Koku');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('虚空 Koku');
	await expect(page.getByText('Empty space')).toBeVisible();

	// Breadcrumbs go back up the hierarchy.
	await crumbs(page).getByRole('link', { name: 'Jo Ryaku no Maki' }).click();
	await expect(page).toHaveURL('/schools/gyokko/taijutsu/jo_ryaku');
	await crumbs(page).getByRole('link', { name: 'Taijutsu' }).click();
	await expect(page).toHaveURL('/schools/gyokko/taijutsu');
	await crumbs(page).getByRole('link', { name: 'Gyokko Ryu' }).click();
	await expect(page).toHaveURL('/schools/gyokko');
	await crumbs(page).getByRole('link', { name: 'Schools' }).click();
	await expect(page).toHaveURL('/schools');
});

test('weapons: school → Buki → weapon → section → technique', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/kukishinden');
	await expect(cards(page)).toHaveText(['体術 Taijutsu', '武器 Buki']); // the categories it has, in order
	await page.locator('[data-id="buki"]').click();

	await expect(page).toHaveURL('/schools/kukishinden/buki');
	await expect(page.getByRole('heading', { name: 'Weapons' })).toBeVisible();
	await expect(cards(page)).toHaveText(['六尺棒 Rokushakubo', '半棒 Hanbo']);
	expect(await background(page, 'rokushakubo')).toMatch(/^url\(/);
	await page.locator('[data-id="rokushakubo"]').click();

	await expect(page).toHaveURL('/schools/kukishinden/buki/rokushakubo');
	await expect(cards(page)).toHaveText(['初伝型 Shoden Gata']); // not the hanbo's, not the taijutsu's
	await cards(page).first().click();
	await expect(page).toHaveURL('/schools/kukishinden/buki/rokushakubo/shoden');
	await cards(page).first().click();

	await expect(page).toHaveURL('/schools/kukishinden/buki/rokushakubo/shoden/chudan_kangi');
	await expect(crumbs(page)).toHaveText(['Schools', 'Kukishin Ryu', 'Buki', 'Rokushakubo', 'Shoden Gata', 'Chudan Kangi']);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('中段扞打 Chudan Kangi');
	await crumbs(page).getByRole('link', { name: 'Rokushakubo' }).click();
	await expect(page).toHaveURL('/schools/kukishinden/buki/rokushakubo');
});

test('Muto Dori is a category of its own', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/koto');
	await expect(cards(page)).toHaveText(['無刀捕 Muto Dori']);
	await cards(page).first().click();
	await expect(page).toHaveURL('/schools/koto/muto_dori');
	await expect(cards(page)).toHaveText(['劈刀型 Hekito Gata']);
	expect(await background(page, 'koto.muto_dori.hekito')).toMatch(/^url\(/);
	await cards(page).first().click();
	await expect(cards(page)).toHaveText(['跂望 Kibo']);
});

test('a school without known techniques says so', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/gyokushin');
	await expect(page.getByText('No techniques known yet for this school.')).toBeVisible();
	await expect(cards(page)).toHaveCount(0);
});

test('technique page: segment thumbnails, then comments newest first', async ({ page }) => {
	await loggedIn(page);
	await page.goto(KOKU_PAGE);

	const videos = page.locator('section').first();
	// Each segment: its picture and its duration.
	await expect(videos.getByRole('button')).toHaveText(['0:15', '0:15']);
	await expect(videos.getByRole('button', { name: 'Play the segment (0:15)' })).toHaveCount(2);
	await expect(videos.locator('img').first()).toHaveAttribute('src', '/media/segment/7/thumbnail');
	await expect(videos.locator('img').last()).toHaveAttribute('src', '/media/segment/8/thumbnail');

	const comments = page.locator('.comment');
	await expect(comments).toHaveCount(2);
	await expect(comments.first()).toContainText('Hana');
	await expect(comments.first()).toContainText('Très bien');
	await expect(comments.first().getByRole('img', { name: 'Language: Français' })).toBeVisible();
	await expect(comments.first().locator('svg.flag')).toHaveAttribute('width', '16'); // the menu's flag, smaller
	await expect(comments.last()).toContainText('kenji');
	await expect(comments.last().getByRole('img', { name: 'Language: English' })).toBeVisible();
	await expect(comments.last().locator('time')).toHaveAttribute('datetime', '2023-11-14T22:13:20.000Z');
	// Section order: description, videos, comments.
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Videos', 'Comments']);
});

test('segment thumbnail: bottom right, whether the clip is on the device', async ({ page }) => {
	await loggedIn(page);
	await page.goto(KOKU_PAGE);
	const first = page.locator('section').first().locator('li').first();
	// No service worker in these tests: not downloaded (tests/pwa: saved).
	const badge = first.locator('.badge');
	await expect(badge).toHaveAttribute('aria-label', 'Not downloaded');
	await expect(badge).toHaveAttribute('title', 'Not downloaded');
	const [picture, icon] = await Promise.all([first.locator('img').boundingBox(), badge.boundingBox()]);
	expect(picture!.x + picture!.width - (icon!.x + icon!.width)).toBeLessThan(12); // right
	expect(picture!.y + picture!.height - (icon!.y + icon!.height)).toBeLessThan(12); // bottom
});

test('clicking a segment plays its clip in a dialog', async ({ page }) => {
	await loggedIn(page);
	const asked: string[] = [];
	await page.route('/media/segment/*', (r) => {
		asked.push(new URL(r.request().url()).pathname);
		return fulfillClip(r);
	});
	await page.goto(KOKU_PAGE);
	await page.getByRole('button', { name: 'Play the segment (0:15)' }).first().click();

	const player = page.getByRole('dialog', { name: 'Koku, segment of 0:15' });
	await expect(player).toBeVisible();
	await expect(player.locator('video')).toHaveAttribute('src', '/media/segment/7');
	await expect.poll(() => player.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
	expect(asked).toContain('/media/segment/7'); // the clip only: the server cut it
	await page.keyboard.press('Escape');
	await expect(player).toHaveCount(0); // closed: the video is gone, so it stops

	await page.getByRole('button', { name: 'Play the segment (0:15)' }).last().click();
	await expect(page.locator('dialog video')).toHaveAttribute('src', '/media/segment/8');
	await page.getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('dialog')).toHaveCount(0);
});

// Exact frame steps need the browser's frame timestamps (requestVideoFrameCallback).
// Playwright's WebKit on Linux plays media through GStreamer, not Safari's media
// stack: its timestamps are not the frames' (CI measured 6, 21 and 33 ms for 40).
test.describe('frame by frame', () => {
	test.skip(({ browserName }) => browserName === 'webkit', "Linux WebKit's frame timestamps (GStreamer) are not Safari's");

	test('the player: slow motion and frame by frame', async ({ page }) => {
		await loggedIn(page);
		await page.route('/media/segment/*', fulfillClip);
		await page.goto(KOKU_PAGE);
		await page.getByRole('button', { name: 'Play the segment (0:15)' }).first().click();
		const player = page.getByRole('dialog');
		const video = player.locator('video');
		const time = () => video.evaluate((v: HTMLVideoElement) => v.currentTime);

		const speeds = player.getByRole('group', { name: 'Speed' }).getByRole('button');
		await expect(speeds).toHaveText(['1×', '0.5×', '0.25×', '0.125×']);
		await expect(speeds.first()).toHaveAttribute('aria-pressed', 'true');
		await speeds.nth(2).click();
		await expect(speeds.nth(2)).toHaveAttribute('aria-pressed', 'true');
		await expect(speeds.first()).toHaveAttribute('aria-pressed', 'false');
		expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(0.25);

		// Frame by frame: the clip is 25 fps, measured from the first frames played.
		await expect.poll(time).toBeGreaterThan(0.3);
		const moved = async (action: () => Promise<void>) => {
			const before = await time();
			await action();
			return Math.round(((await time()) - before) * 1000);
		};
		await player.getByRole('button', { name: 'Next frame' }).click(); // pauses: measured from here
		expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
		expect(await moved(() => player.getByRole('button', { name: 'Next frame' }).click())).toBe(40);
		expect(await moved(() => player.getByRole('button', { name: 'Previous frame' }).click())).toBe(-40);
		expect(await moved(() => page.keyboard.press('ArrowRight'))).toBe(40);
		await video.focus(); // also when the video has the focus (its own arrows jump 5 s)
		expect(await moved(() => page.keyboard.press('ArrowLeft'))).toBe(-40);
	});
});

test('the player: own play/pause, also with Space', async ({ page }) => {
	await loggedIn(page);
	await page.route('/media/segment/*', fulfillClip);
	await page.goto(KOKU_PAGE);
	await page.getByRole('button', { name: 'Play the segment (0:15)' }).first().click();
	const player = page.getByRole('dialog');
	const paused = () => player.locator('video').evaluate((v: HTMLVideoElement) => v.paused);
	await expect.poll(paused).toBe(false); // starts by itself
	await player.getByRole('button', { name: 'Pause' }).click();
	await expect.poll(paused).toBe(true);
	await player.getByRole('button', { name: 'Play' }).click();
	await expect.poll(paused).toBe(false);
	await player.locator('video').focus();
	await page.keyboard.press(' ');
	await expect.poll(paused).toBe(true);
});

test.describe('the player on a phone', () => {
	test.use({ viewport: { width: 393, height: 851 }, hasTouch: true, isMobile: true });

	test('play/pause can be tapped; the controls are small, on one line', async ({ page }) => {
		await loggedIn(page);
		await page.route('/media/segment/*', fulfillClip);
		await page.goto(KOKU_PAGE);
		await page.getByRole('button', { name: 'Play the segment (0:15)' }).first().tap();
		const player = page.getByRole('dialog');
		const paused = () => player.locator('video').evaluate((v: HTMLVideoElement) => v.paused);
		await expect.poll(paused).toBe(false);
		await player.getByRole('button', { name: 'Pause' }).tap();
		await expect.poll(paused).toBe(true);
		await player.getByRole('button', { name: 'Play' }).tap();
		await expect.poll(paused).toBe(false);

		const controls = [
			player.getByRole('button', { name: 'Previous frame' }),
			player.getByRole('button', { name: 'Pause' }),
			player.getByRole('button', { name: 'Next frame' }),
			...(await player.getByRole('group', { name: 'Speed' }).getByRole('button').all())
		];
		const boxes = await Promise.all(controls.map(async (c) => (await c.boundingBox())!));
		for (const box of boxes) expect(box.height).toBeLessThanOrEqual(34);
		expect(new Set(boxes.map((box) => Math.round(box.y))).size).toBe(1); // one line
	});
});

test('the player in French: speeds with a decimal comma', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await loggedIn(page);
	await page.route('/media/segment/*', fulfillClip);
	await page.goto(KOKU_PAGE);
	await page.getByRole('button', { name: 'Lire le segment (0:15)' }).first().click();
	const player = page.getByRole('dialog');
	await expect(player.getByRole('group', { name: 'Vitesse' }).getByRole('button')).toHaveText(['1×', '0,5×', '0,25×', '0,125×']);
	await expect(player.getByRole('button', { name: 'Image suivante' })).toBeVisible();
});

test('a clip that cannot be played says so', async ({ page }) => {
	await loggedIn(page);
	await page.route('/media/segment/*', (r) => r.fulfill({ status: 404 }));
	await page.goto(KOKU_PAGE);
	await page.getByRole('button', { name: 'Play the segment (0:15)' }).first().click();
	await expect(page.getByRole('dialog')).toContainText('This clip cannot be played.');
});

test('another clip still downloading (429): says so, Try again plays it', async ({ page }) => {
	await loggedIn(page);
	let busy = true; // the server sends one clip per user at a time
	await page.route('/media/segment/*', (r) => (busy ? r.fulfill({ status: 429 }) : fulfillClip(r)));
	await page.goto(KOKU_PAGE);
	await page.getByRole('button', { name: 'Play the segment (0:15)' }).first().click();
	const player = page.getByRole('dialog');
	await expect(player.getByRole('alert')).toHaveText(
		'Another video is still downloading. Try again when it has finished.'
	);
	busy = false;
	await player.getByRole('button', { name: 'Try again' }).click();
	await expect.poll(() => player.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0);
	await expect(player.getByRole('alert')).toHaveCount(0);
});

test('technique without videos or comments', async ({ page }) => {
	await loggedIn(page);
	await page.route('/media/segment/*/thumbnail', (r) => r.fulfill({ status: 404 })); // newest route wins
	await page.goto('/schools/gyokko/taijutsu/jo_ryaku/keto');
	// The thumbnail is missing: a placeholder keeps the place.
	await expect(page.getByRole('button', { name: 'Play the segment (0:04)' }).locator('.placeholder')).toBeVisible();
	await expect(page.getByText('No comments yet.')).toBeVisible();
});

test('unknown or misplaced steps: not found, breadcrumbs to what exists', async ({ page }) => {
	await loggedIn(page);
	await page.goto('/schools/nope');
	await expect(page.getByText('Not found.')).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools']);

	// A technique of another section is not found under this one.
	await page.goto('/schools/gyokko/taijutsu/ge_ryaku/koku');
	await expect(page.getByText('Not found.')).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu', 'Taijutsu', 'Ge Ryaku no Maki']);
	await crumbs(page).getByRole('link', { name: 'Ge Ryaku no Maki' }).click();
	await expect(page).toHaveURL('/schools/gyokko/taijutsu/ge_ryaku');
	await expect(page.getByText('No techniques in this section yet.')).toBeVisible();

	// A weapon the school does not teach; an old URL by level.
	await page.goto('/schools/gyokko/buki');
	await expect(page.getByText('Not found.')).toBeVisible();
	await expect(crumbs(page)).toHaveText(['Schools', 'Gyokko Ryu']);
	await page.goto('/schools/gyokko/shoden/gyokko.koku');
	await expect(page.getByText('Not found.')).toBeVisible();
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await loggedIn(page);
	await page.goto(KOKU_PAGE);
	await expect(crumbs(page, "Fil d'Ariane")).toHaveText(['Écoles', 'Gyokko Ryu', 'Taijutsu', 'Jo Ryaku no Maki', 'Koku']);
	await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Vidéos', 'Commentaires']);
	await expect(page.locator('.comment').first().getByRole('img', { name: 'Langue : Français' })).toBeVisible();
});

test('a segment published later shows without reloading the app', async ({ page }) => {
	await page.clock.install();
	await loggedIn(page);
	let catalog = { ...CATALOG, segments: [] as typeof CATALOG.segments };
	await page.route('/api/catalog', (r) => r.fulfill({ json: catalog }));
	await page.goto(KOKU_PAGE);
	await expect(page.getByText('No videos yet.')).toBeVisible();

	// Published on the server meanwhile; the user goes on navigating in the app.
	catalog = CATALOG;
	await crumbs(page).getByRole('link', { name: 'Jo Ryaku no Maki' }).click();
	await page.clock.fastForward('00:31');
	await page.getByRole('link', { name: /Koku/ }).click();
	await expect(page.locator('section').first().getByRole('button', { name: /Play the segment/ })).toHaveCount(2);
});
