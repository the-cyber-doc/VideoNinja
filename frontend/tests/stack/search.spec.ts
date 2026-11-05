import { expect, test, type Browser, type Cookie, type Page } from '@playwright/test';
import { admin, loggedIn, register } from '../accounts';
import { everyMatch, inLanguage } from '../search-page';

// The real containers only (tools/test-e2e-stack.sh), project "search": after every other
// spec (their videos and books are there too, and none changes under books.spec's checks).
// One made-up word, "quokka", put in every kind of thing the search covers: a video's file
// name and tag, a segment's performer and tag, a book's title and pages (its own text, read
// by the browser at the upload), a book annotation's quote and note, a comment on the
// annotation, a comment on a technique. Every one found, nothing else; in other languages
// (tag names, accents, Japanese); and each user gets only what they may open.
test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000); // an encoding, on a slow machine

const VIDEO = 'tests/fixtures/quokka-kata.webm'; // 4 s, VP9
const BOOK = 'tests/fixtures/book-search.pdf'; // 2 pages: "The Quokka Scroll…", "Le déplacement du quokka…"
const KOKU = 'gyokko.taijutsu.jo_ryaku.koku';
const KOKU_PAGE = '/schools/gyokko/taijutsu/jo_ryaku/koku';
const KETO = 'gyokko.taijutsu.jo_ryaku.keto';
const KETO_PAGE = '/schools/gyokko/taijutsu/jo_ryaku/keto';
const PLAYER = 'video:not([aria-hidden="true"])';

let adminCookies: Cookie[] = [];
const ids: Record<string, number> = {};

test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, admin());
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

async function as(browser: Browser, username: string, role: string, page: Page) {
	const context = await loggedIn(browser, await register(page.request, username, role));
	return { context, page: await context.newPage() };
}

test('one word in everything: a video, its segment, a book, its pages, a note, comments', async ({ page }) => {
	const tag = { id: 'search_remark', names: { en: 'Remark', fr: 'Remarque' }, format: 'free' };
	expect((await page.request.post('api/admin/tags', { data: tag })).status()).toBe(201);
	const performer = await (await page.request.post('api/performers', { data: { name: 'Quokka Sensei' } })).json();

	// The video: uploaded, encoded, published; then its segment and tags.
	await page.goto('upload');
	await page.getByLabel('Video file').setInputFiles(VIDEO);
	await expect(page.locator(PLAYER)).toBeVisible();
	await page.getByLabel('This video does not contain any technique segment').check();
	await page.getByRole('button', { name: 'Proceed' }).click();
	await expect(page.getByRole('status')).toContainText('Uploaded.', { timeout: 60_000 });
	const video = async () =>
		((await (await page.request.get('api/videos')).json()) as { id: number; original_filename: string }[]).find(
			(v) => v.original_filename === 'quokka-kata.webm'
		);
	await expect.poll(async () => (await video())?.id, { timeout: 240_000, intervals: [2_000] }).toBeDefined();
	ids.video = (await video())!.id;
	const outdoor = { id: 'location', value: 'outdoor' };
	const saved = await page.request.put(`api/videos/${ids.video}/annotations`, {
		data: {
			all_segments_done: true,
			tags: [outdoor, { id: 'search_remark', value: 'a quokka kata' }],
			segments: [
				{
					begin_s: 0,
					end_s: 3,
					technique: KOKU,
					performer: performer.id,
					tags: [outdoor, { id: 'search_remark', value: 'quokka' }]
				}
			]
		}
	});
	expect(saved.status()).toBe(200);

	// The book: its text read here by EmbedPDF, sent once submitted.
	await page.goto('upload');
	await page.getByLabel('Choose a PDF file').setInputFiles(BOOK);
	await expect(page.getByRole('img', { name: 'First page of the book' })).toBeVisible({ timeout: 20_000 });
	await expect(page.getByLabel('Title *')).toHaveValue('The Quokka Scroll'); // from the PDF
	await page.getByLabel('As written', { exact: true }).uncheck();
	await page.getByLabel('Family name').fill('Sato');
	await page.getByLabel('Given name').fill('Hana');
	await page.getByLabel('Date', { exact: true }).fill('2026');
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('Uploaded: the book is published')).toBeVisible({ timeout: 60_000 });
	const book = async () =>
		(
			(await (await page.request.get('api/books')).json()) as {
				id: number;
				original_filename: string;
				status: string;
				has_text: boolean;
			}[]
		).find((b) => b.original_filename === 'book-search.pdf');
	await expect.poll(async () => (await book())?.status, { timeout: 60_000 }).toBe('published');
	await expect.poll(async () => (await book())?.has_text).toBe(true);
	ids.book = (await book())!.id;

	// A highlight's note about Koku, a comment on it, a comment on Keto.
	const target = {
		type: 9,
		id: 'search-e2e',
		pageIndex: 1,
		rect: { origin: { x: 60, y: 80 }, size: { width: 220, height: 20 } }
	};
	const annotation = await page.request.post(`api/books/${ids.book}/annotations`, {
		data: {
			page: 2,
			kind: 'text',
			target: JSON.stringify(target),
			quote: 'Le déplacement du quokka',
			note: 'Quokka: 虚空の構え',
			technique: KOKU
		}
	});
	expect(annotation.status()).toBe(201);
	ids.annotation = (await annotation.json()).id;
	const reply = await page.request.post(`api/book-annotations/${ids.annotation}/comments`, {
		data: { text: 'Très bien, ce quokka', lang: 'fr' }
	});
	expect(reply.status()).toBe(201);
	const comment = await page.request.post(`api/techniques/${KETO}/comments`, {
		data: { text: 'A quokka at the Daikomyosai', lang: 'en' }
	});
	expect(comment.status()).toBe(201);

	// The catalogue snapshot (rebuilt a moment after the segment's save) has the segment.
	await expect
		.poll(async () =>
			(await (await page.request.get('api/catalog')).json()).performers?.map((p: { name: string }) => p.name)
		)
		.toContain('Quokka Sensei');
});

test('every match, in each group, and nothing else', async ({ page }) => {
	const want = await everyMatch(page, 'quokka');
	const annotated = `/books/${ids.book}?annotation=${ids.annotation}`;
	expect(want).toMatchObject({
		catalog: [],
		segments: [KOKU_PAGE], // performer and tag
		videos: [`/videos/${ids.video}`], // file name and tag
		books: [`/books/${ids.book}`], // title
		texts: [annotated, `/books/${ids.book}?page=1`, `/books/${ids.book}?page=2`].sort(), // the note, both pages
		comments: [KETO_PAGE, annotated].sort()
	});
	await expect(page.getByRole('status')).toHaveText('8 result(s)');
	await expect(page.locator(`a[href$="?page=2"]`).locator('..').locator('mark')).toHaveText(['quokka']);

	// The drop-down: the same groups.
	await page.goto('books');
	await page.getByRole('combobox', { name: 'Search' }).fill('quokka');
	for (const [group, n] of [
		['Segments', 1],
		['Videos', 1],
		['Books', 1],
		['In the books', 3],
		['Comments', 2]
	] as const)
		await expect(page.getByRole('group', { name: group }).getByRole('option')).toHaveCount(n);
});

test('in other languages: tag names, accents, Japanese', async ({ page }) => {
	await inLanguage(page, 'en');
	const french = await everyMatch(page, 'remarque'); // the tag's French name, on an English page
	expect(french).toMatchObject({ segments: [KOKU_PAGE], videos: [`/videos/${ids.video}`] });
	const outdoor = await everyMatch(page, 'extérieur'); // a list value's French name: tagged videos and segments
	expect(outdoor.videos).toContain(`/videos/${ids.video}`);
	expect(outdoor.segments).toContain(KOKU_PAGE);
	expect(outdoor.catalog.length).toBeGreaterThan(0); // "Clé extérieure"…
	const accents = await everyMatch(page, 'DEPLACEMENT'); // the PDF's own "déplacement", the quote
	expect(accents.texts).toEqual([`/books/${ids.book}?annotation=${ids.annotation}`, `/books/${ids.book}?page=2`]);
	expect((await everyMatch(page, 'tres bien')).comments).toEqual([`/books/${ids.book}?annotation=${ids.annotation}`]);
	const kanji = await everyMatch(page, '虚空'); // the catalogue's Koku (two schools), the segment, the note
	expect(kanji.catalog.length).toBeGreaterThanOrEqual(2);
	expect(kanji.segments).toContain(KOKU_PAGE);
	expect(kanji.texts).toEqual([`/books/${ids.book}?annotation=${ids.annotation}`]);

	await inLanguage(page, 'fr');
	expect(await everyMatch(page, 'remark')).toMatchObject({ segments: [KOKU_PAGE], videos: [`/videos/${ids.video}`] });
	await expect(page.getByRole('heading', { name: /^Vidéos/ })).toBeVisible();
});

test('each user: only what they may open', async ({ page, browser }) => {
	const plain = await as(browser, 'searcher', 'user', page);
	const seen = await everyMatch(plain.page, 'quokka'); // no videos, no books: the note through its technique
	expect(seen).toMatchObject({
		videos: [],
		books: [],
		segments: [KOKU_PAGE],
		texts: [KOKU_PAGE],
		comments: [KETO_PAGE]
	});
	await expect(plain.page.locator('li', { has: plain.page.locator(`a[href$="${KOKU_PAGE}"]`) }).last()).toContainText(
		'A book’s note'
	);
	await plain.context.close();

	const videos = await as(browser, 'videosearcher', 'video_mgmt', page);
	expect(await everyMatch(videos.page, 'quokka')).toMatchObject({ videos: [`/videos/${ids.video}`], books: [] });
	await videos.context.close();
});
