import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Cookie, type Page } from '@playwright/test';
import { admin, loggedIn, register, type Account } from '../accounts';
import { pdfAnnotations } from '../pdf-annotations';
import { drag, pageBox } from '../viewer';

// The real containers only (tools/test-e2e-stack.sh), project "stack": every books feature
// end to end. Books uploaded through nginx and tusd, checked and published by the encoder
// (their first pages re-encoded by ffmpeg), served by nginx after the API's check; the
// Books page's filter and sort; the viewer (EmbedPDF in its worker, its fallback fonts
// from nginx) with a highlight and a region (its crop through tusd, the encoder and
// nginx), a technique, a note, a colour, comments; the reference edited; the copy with
// every annotation written in it; the technique's page for a plain user and for a book
// manager; who may see what.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const PDF = 'tests/fixtures/book.pdf'; // a text PDF (Helvetica): "Togakure-ryu" near the top
const JP = 'tests/fixtures/book-jp.pdf'; // Japanese text in a font it does not embed
const KOKU = 'gyokko.taijutsu.jo_ryaku.koku';
const KOKU_PAGE = 'schools/gyokko/taijutsu/jo_ryaku/koku';

interface Book {
	id: number;
	original_filename: string;
	status: string;
	has_thumbnail: boolean;
}
interface Annotation {
	id: number;
	kind: string;
	quote: string | null;
	note: string | null;
	color: string | null;
	technique: string | null;
	has_image: boolean;
}

let adminCookies: Cookie[] = [];
let plain: Account; // role "user": no book_mgmt
const ids: Record<string, number> = {};

// The admin logs in once (nginx's credentials limit), every test reuses the session.
test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, admin());
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

async function books(page: Page): Promise<Book[]> {
	return (await page.request.get('api/books')).json();
}
async function annotations(page: Page, bookId: number): Promise<Annotation[]> {
	return (await page.request.get(`api/books/${bookId}/annotations`)).json();
}

/** Uploaded on the book upload page, then published by the encoder: its ID. */
async function upload(page: Page, file: string, form: (page: Page) => Promise<void>) {
	await page.goto('upload/book');
	await page.getByLabel('Choose a PDF file').setInputFiles(file);
	await expect(page.getByRole('img', { name: 'First page of the book' })).toBeVisible({ timeout: 20_000 });
	await form(page);
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Uploaded', { timeout: 60_000 });
	const name = file.split('/').pop();
	const book = async () => (await books(page)).find((b) => b.original_filename === name);
	await expect.poll(async () => (await book())?.status, { timeout: 60_000 }).toBe('published');
	return (await book())!.id;
}

/** A second context, logged in as `who` (its own session). */
async function as(browser: Browser, who: Account) {
	const context = await loggedIn(browser, who);
	return { context, page: await context.newPage() };
}

test('the Books entry: in the menu with book_mgmt; the upload page offers books', async ({ page }) => {
	await page.goto('./');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link', { name: 'Books' })).toBeVisible();
	await page.goto('upload');
	await expect(page.getByRole('link', { name: 'Upload a book (PDF)' })).toBeVisible();
});

test('a text PDF: read here, its reference, uploaded through tusd, published by the encoder', async ({ page }) => {
	ids.text = await upload(page, PDF, async (p) => {
		await expect(p.getByLabel('Title *')).toHaveValue('Togakure-ryu Densho'); // from the PDF itself
		await p.getByLabel('As written', { exact: true }).uncheck();
		await p.getByLabel('Family name').fill('Hatsumi');
		await p.getByLabel('Given name').fill('Masaaki');
		await p.getByLabel('Date', { exact: true }).fill('1981');
		await expect(p.locator('.preview')).toContainText('Hatsumi, Masaaki. Togakure-ryu Densho. 1981.');
	});
});

test('a Japanese manuscript without its fonts: its first page drawn with the app’s font', async ({ page }) => {
	ids.jp = await upload(page, JP, async (p) => {
		await p.getByLabel('Type of work').selectOption('manuscript');
		await p.getByLabel('Title *').fill('Ninpō Densho');
		await p.getByLabel('Date', { exact: true }).fill('1800');
		await p.getByLabel('Language (code)').fill('ja');
	});
	const jp = (await books(page)).find((b) => b.id === ids.jp)!;
	expect(jp.has_thumbnail).toBe(true);
});

test('nginx serves a PDF as uploaded (a download), its first page, the fallback fonts', async ({ page }) => {
	const pdf = await page.request.get(`media/book/${ids.text}`);
	expect([pdf.status(), pdf.headers()['content-type'], pdf.headers()['content-disposition']]).toEqual([
		200,
		'application/pdf',
		'attachment'
	]);
	expect((await pdf.body()).equals(readFileSync(PDF))).toBe(true); // never rewritten
	const thumbnail = await page.request.get(`media/book/${ids.text}/thumbnail`);
	expect([thumbnail.status(), thumbnail.headers()['content-type']]).toEqual([200, 'image/jpeg']);

	// The viewer of the Japanese one: its missing font from nginx (font/otf), nothing from elsewhere.
	const font = page.waitForResponse((r) => /\/_app\/immutable\/pdf-fonts\/[^/]+\/jp\/NotoSansJP-/.test(r.url()));
	await page.goto(`books/${ids.jp}`);
	await pageBox(page);
	const response = await font;
	expect([response.status(), response.headers()['content-type']]).toEqual([200, 'font/otf']);
});

test('the Books page: every book with its first page; filtered, sorted, searched', async ({ page }) => {
	await page.goto('books');
	const text = page.locator(`li[data-id="${ids.text}"]`);
	await expect(text).toContainText('Hatsumi, Masaaki. Togakure-ryu Densho. 1981.');
	await expect
		.poll(() =>
			text.getByRole('img', { name: 'First page of the book' }).evaluate((i: HTMLImageElement) => i.naturalWidth)
		)
		.toBe(480);
	await expect(page.locator(`li[data-id="${ids.jp}"]`)).toContainText('Ninpō Densho');

	const order = () =>
		page.locator('li.book').evaluateAll((items) => items.map((i) => Number(i.getAttribute('data-id'))));
	await page.getByRole('button', { name: 'Filter and sort' }).click();
	const pane = page.getByRole('dialog', { name: 'Filter and sort' });
	await pane.getByLabel('Sort by').selectOption('year');
	await pane.getByLabel('Direction').selectOption({ label: 'Oldest first' });
	await expect.poll(order).toEqual([ids.jp, ids.text]);
	await pane.getByLabel('Manuscript (densho, makimono…)').check();
	await expect.poll(order).toEqual([ids.jp]);
	await pane.getByRole('button', { name: 'Reset' }).click();
	await pane.getByLabel('Title or name').fill('togakure');
	await expect.poll(order).toEqual([ids.text]);
	await pane.getByRole('button', { name: 'Reset' }).click();
	await pane.getByRole('button', { name: 'Done' }).click();
});

test('the viewer: a highlight and a region, saved; the region’s crop published and served', async ({ page }) => {
	await page.goto('books');
	await page.locator(`li[data-id="${ids.text}"]`).getByRole('link').first().click();
	await expect(page).toHaveURL(new RegExp(`books/${ids.text}$`));
	const box = await pageBox(page);
	const pt = box.width / 420; // the fixture's page: 420 pt wide

	await page.getByRole('button', { name: 'Highlight text' }).click();
	await drag(page, [box.x + 62 * pt, box.y + 90 * pt], [box.x + 200 * pt, box.y + 90 * pt]);
	await expect.poll(async () => (await annotations(page, ids.text)).length, { timeout: 15_000 }).toBe(1);
	const [highlight] = await annotations(page, ids.text);
	expect([highlight.kind, highlight.quote?.startsWith('Togakure-ryu')]).toEqual(['text', true]);
	ids.highlight = highlight.id;

	await page.getByRole('button', { name: 'Mark a region' }).click();
	await drag(page, [box.x + 60 * pt, box.y + 115 * pt], [box.x + 300 * pt, box.y + 180 * pt]);
	await expect.poll(async () => (await annotations(page, ids.text)).length, { timeout: 15_000 }).toBe(2);
	const region = (await annotations(page, ids.text)).find((a) => a.kind === 'region')!;
	ids.region = region.id;
	// Its crop: made by the browser, uploaded through tusd, re-encoded by the encoder.
	await expect
		.poll(async () => (await annotations(page, ids.text)).find((a) => a.id === region.id)?.has_image, {
			timeout: 60_000
		})
		.toBe(true);
	const crop = await page.request.get(`media/book-annotation/${region.id}/image`);
	expect([crop.status(), crop.headers()['content-type']]).toEqual([200, 'image/jpeg']);
	await expect(page.locator('section.annotations li')).toHaveCount(2);
});

test('an annotation’s technique, note and colour; its comments', async ({ page }) => {
	await page.goto(`books/${ids.text}`);
	await pageBox(page);
	const item = page.locator(`section.annotations li[data-id="${ids.highlight}"]`);
	await item.getByRole('button', { name: /Page 1/ }).click();
	await item.getByLabel('School').selectOption('gyokko');
	await item.getByLabel('Scroll or form').selectOption('gyokko.taijutsu.jo_ryaku');
	await item.getByLabel('Technique').selectOption(KOKU);
	await item.getByLabel('Note').fill('The first school');
	await item.getByRole('button', { name: 'Save' }).first().click();
	await item.getByRole('button', { name: 'Blue' }).click();
	await expect
		.poll(async () => {
			const a = (await annotations(page, ids.text)).find((x) => x.id === ids.highlight)!;
			return [a.technique, a.note, a.color];
		})
		.toEqual([KOKU, 'The first school', '#60A5FA']);

	const comments = item.getByRole('region', { name: 'Comments on this annotation' });
	await comments.getByRole('button', { name: 'Add a comment' }).click();
	await comments.getByRole('textbox').fill('Seen in the dojo');
	await comments.getByRole('button', { name: 'Save' }).click();
	await expect(comments).toContainText('Seen in the dojo');
	const thread = await (await page.request.get(`api/book-annotations/${ids.highlight}/comments`)).json();
	expect(thread.map((c: { text: string }) => c.text)).toEqual(['Seen in the dojo']);
});

test('the reference edited on the book’s page', async ({ page }) => {
	await page.goto(`books/${ids.text}`);
	await page.getByRole('button', { name: 'Edit the reference' }).click();
	await page.getByLabel('Publisher (university for a thesis)').fill('Kodansha');
	await page.getByLabel('Place of publication').fill('Tokyo');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(page.getByText('Reference saved.')).toBeVisible();
	await expect(page.locator('header .reference')).toContainText(
		'Hatsumi, Masaaki. Togakure-ryu Densho. Tokyo: Kodansha, 1981.'
	);
});

test('the copy with its annotations: in the PDF, the comment as a reply', async ({ page }) => {
	await page.goto(`books/${ids.text}`);
	await pageBox(page);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download with annotations' }).click();
	const file = await download;
	const saved = test.info().outputPath('annotated.pdf'); // the browser runs in Docker: saveAs
	await file.saveAs(saved);
	const found = await pdfAnnotations(readFileSync(saved));
	const highlight = found.find((a) => a.type === 9)!;
	expect(highlight.contents).toMatch(
		/^Technique: \S+ Koku — https?:\/\/[^/]+\/videoninja\/schools\/gyokko\/taijutsu\/jo_ryaku\/koku\n\nThe first school$/
	);
	expect(found.find((a) => a.type === 5)).toBeDefined(); // the region
	const reply = found.find((a) => a.type === 1)!;
	expect([reply.contents, reply.inReplyToId]).toEqual(['Seen in the dojo', highlight.id]);
});

test('a plain user: no Books, no book; the technique’s page shows what the books say, without the book', async ({
	page,
	browser
}) => {
	plain = await register(page.request, 'yuki', 'user', 'Yuki');
	const { context, page: user } = await as(browser, plain);
	for (const path of [
		'api/books',
		`media/book/${ids.text}`,
		`media/book/${ids.text}/thumbnail`,
		`api/books/${ids.text}`
	])
		expect((await user.request.get(path)).status(), path).toBe(403);
	await user.goto('books');
	await expect(user).toHaveURL(/\/videoninja\/$/);
	await expect(
		user.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Books' })
	).toHaveCount(0);

	await user.goto(KOKU_PAGE);
	const note = user.getByRole('article', { name: 'An annotation from a book' });
	await expect(note).toHaveCount(1);
	await expect(note.locator('blockquote')).toContainText('Togakure-ryu');
	await expect(note).toContainText('The first school');
	await expect(note).toContainText('Hatsumi, Masaaki. Togakure-ryu Densho. Tokyo: Kodansha, 1981.');
	await expect(note.getByRole('list', { name: 'Comments on this annotation' })).toContainText('Seen in the dojo');
	await expect(note.getByRole('link', { name: 'Open in the book' })).toHaveCount(0);
	const headings = await user.getByRole('heading', { level: 2 }).allTextContents();
	expect(headings.indexOf('In the books')).toBeLessThan(headings.indexOf('Videos'));
	await context.close();
});

test('a region about a technique: its crop on the technique’s page, for every user', async ({ page, browser }) => {
	const changed = await page.request.patch(`api/book-annotations/${ids.region}`, { data: { technique: KOKU } });
	expect(changed.status()).toBe(200);
	const { context, page: user } = await as(browser, plain);
	await user.goto(KOKU_PAGE);
	const crop = user.getByRole('img', { name: 'The region annotated' });
	await expect.poll(() => crop.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
	await context.close();
});

test('a book manager opens the book on the annotation from the technique’s page', async ({ page }) => {
	await page.goto(KOKU_PAGE);
	await page
		.getByRole('article', { name: 'An annotation from a book' })
		.filter({ hasText: 'The first school' })
		.getByRole('link', { name: 'Open in the book' })
		.click();
	await expect(page).toHaveURL(new RegExp(`books/${ids.text}\\?annotation=${ids.highlight}$`));
	await pageBox(page);
	await expect(page.locator(`section.annotations li[data-id="${ids.highlight}"]`)).toHaveClass(/selected/);
});

test('an annotation deleted: gone from the technique’s page; its crop no longer served', async ({ page }) => {
	await page.goto(`books/${ids.text}`);
	await pageBox(page);
	const item = page.locator(`section.annotations li[data-id="${ids.region}"]`);
	await item.getByRole('button', { name: /Page 1/ }).click();
	page.once('dialog', (d) => d.accept());
	await item.getByRole('button', { name: 'Delete the annotation' }).click();
	await expect.poll(async () => (await annotations(page, ids.text)).map((a) => a.id)).toEqual([ids.highlight]);
	expect((await page.request.get(`media/book-annotation/${ids.region}/image`)).status()).toBe(404);
	const notes = await (await page.request.get(`api/techniques/${KOKU}/book-notes`)).json();
	expect(notes.map((n: { id: number }) => n.id)).toEqual([ids.highlight]);
});
