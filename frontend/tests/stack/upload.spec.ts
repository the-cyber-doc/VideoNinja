import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { TOTP } from 'otpauth';

// The real containers only (tools/test-e2e-stack.sh), after tests/e2e: what Playwright's
// own backend can't show. An upload through nginx and tusd, encoded by the encoder
// container, its clip cut by nginx's mp4 module, the thumbnails made by the encoder.
test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000); // the encoding, on a slow machine

const KOKU = 'gyokko.taijutsu.jo_ryaku.koku';
const CLIP = 'tests/fixtures/clip.webm'; // 4 s, VP9: encoded to H.265 by the encoder
const PLAYER = 'video:not([aria-hidden="true"])'; // not the editor's hidden measuring video

interface Segment {
	id: number;
	video: number;
	technique: string;
	begin_s: number;
	end_s: number;
}

let segment: Segment;

async function logIn(page: Page) {
	// Left by tests/e2e/account.spec.ts: its last password and authenticator.
	const admin = JSON.parse(readFileSync('.e2e/admin.json', 'utf8'));
	await page.goto('login');
	await page.getByLabel('Username').fill(admin.username);
	await page.getByLabel('Password').fill(admin.password);
	await page.getByLabel('Authenticator code').fill(new TOTP({ secret: admin.totpSecret }).generate());
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page.getByText('Logged in as')).toBeVisible();
}

async function segments(page: Page): Promise<Segment[]> {
	const res = await page.request.get('api/catalog');
	expect(res.status()).toBe(200);
	return (await res.json()).segments ?? [];
}

test('health: nginx, the API, the database, the encoder and tusd answer', async ({ request }) => {
	const res = await request.get('health');
	expect(res.status()).toBe(200);
	expect(await res.json()).toEqual({ status: 'ok', database: 'ok', encoder: 'ok', tusd: 'ok' });
});

test('upload: through tusd, encoded by the encoder, published', async ({ page }) => {
	await logIn(page);
	await page.goto('upload');
	await page.getByLabel('Video file').setInputFiles(CLIP);
	await expect(page.locator(PLAYER)).toBeVisible();

	// One segment: drag across the timeline, 10 to 60 % of 4 s.
	const slider = page.getByRole('slider', { name: 'Timeline' });
	await slider.scrollIntoViewIfNeeded();
	const box = (await slider.boundingBox())!;
	const y = box.y + box.height / 2;
	await page.mouse.move(box.x + box.width * 0.1, y);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.35, y, { steps: 3 });
	await page.mouse.move(box.x + box.width * 0.6, y, { steps: 3 });
	await page.mouse.up();
	const first = page.getByRole('article', { name: 'Segment 1' });
	await first.getByLabel('School').selectOption('gyokko');
	await first.getByLabel('Scroll or form').selectOption('gyokko.taijutsu.jo_ryaku');
	await first.getByLabel('Technique').selectOption(KOKU);
	await first.getByLabel('Performer').selectOption({ label: 'Add a performer…' });
	await first.getByPlaceholder("Performer's name").fill('Stack Test');
	await first.getByRole('button', { name: 'Add' }).first().click();
	await page.getByRole('checkbox', { name: /All the segments have been created/ }).check();
	await page.getByRole('button', { name: 'Proceed' }).click();
	await expect(page.getByRole('status')).toContainText('Uploaded.', { timeout: 60_000 });

	// Queued, encoded, published: "My uploads" follows it.
	const mine = page.getByRole('heading', { name: 'My uploads' }).locator('..');
	await expect(mine.getByText('Published')).toBeVisible({ timeout: 200_000 });

	// In the catalogue: rebuilt by the API as soon as the encoder has published it.
	const published = async () => (await segments(page)).filter((s) => s.technique === KOKU);
	await expect.poll(async () => (await published()).length, { timeout: 15_000 }).toBe(1);
	segment = (await published())[0];
	expect(segment).toMatchObject({ begin_s: 0, end_s: 3 }); // whole seconds, begin down, end up
});

test('the segment plays: its clip cut by nginx, its thumbnail served', async ({ page }) => {
	await logIn(page);
	const thumbnail = await page.request.get(`media/segment/${segment.id}/thumbnail`);
	expect(thumbnail.status()).toBe(200);
	expect(thumbnail.headers()['content-type']).toBe('image/jpeg');

	await page.goto('schools/gyokko/taijutsu/jo_ryaku/koku');
	const clip = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/media/segment/${segment.id}`));
	await page.getByRole('button', { name: /Play the segment/ }).first().click();
	const response = await clip;
	expect(response.status()).toBeLessThan(300);
	expect(response.headers()['content-type']).toBe('video/mp4');
	const video = page.getByRole('dialog').locator('video');
	// The 3 s clip, not the whole video (4 s): nginx cut it at the segment's keyframes.
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(2.5);
	expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeLessThan(3.6);
	await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2); // playing
});

test('a segment added on the Videos page gets its thumbnail from the encoder', async ({ page }) => {
	await logIn(page);
	const annotations = await (await page.request.get(`api/videos/${segment.video}/annotations`)).json();
	const kept = annotations.segments.map(({ created_by: _, ...s }: Record<string, unknown>) => s);
	const saved = await page.request.put(`api/videos/${segment.video}/annotations`, {
		data: {
			all_segments_done: true,
			tags: annotations.tags,
			segments: [...kept, { begin_s: 3, end_s: 4, technique: KOKU, performer: kept[0].performer, tags: [] }]
		}
	});
	expect(saved.status()).toBe(200);
	const added = (await saved.json()).segments.find((s: Segment) => s.begin_s === 3);

	// Until the encoder has made it, the segment shows its video's thumbnail.
	const videoThumbnail = await (await page.request.get(`media/video/${segment.video}/thumbnail`)).body();
	await expect
		.poll(
			async () => {
				const res = await page.request.get(`media/segment/${added.id}/thumbnail`);
				return res.status() === 200 && !(await res.body()).equals(videoThumbnail);
			},
			{ timeout: 60_000 }
		)
		.toBe(true);
});
