import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { BookRow, Tag } from '../../src/lib/api/types';
import { CATALOG, KOKU } from '../catalog';
import { pdfAnnotations } from '../pdf-annotations';
import { bluish, drag, drawnColor, pageBox, yellowish } from '../viewer';

// A 1×1 PNG (the books' thumbnails).
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';

// Books (the 'book_mgmt' access): in the menu between Upload and Videos, unreachable
// without the access; uploading one; the list. The API and tusd are faked.
const BOOKS = {
	username: 'aiko',
	name: null,
	role: 'book_mgmt',
	role_name: 'Book manager',
	access: ['segment', 'comment', 'annotate', 'upload', 'book_mgmt']
};

async function setup(page: Page, user: object = BOOKS) {
	await page.route('/api/setup/status', (r) => r.fulfill({ json: { initialized: true } }));
	await page.route('/api/auth/me', (r) => r.fulfill({ json: user }));
}

test('Books: in the menu between Upload and Videos, only with the book_mgmt access', async ({ page }) => {
	await setup(page, { ...BOOKS, role: 'content_mgmt', access: [...BOOKS.access, 'video_mgmt'] });
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Books', 'Videos']);
	await nav.getByRole('link', { name: 'Books' }).click();
	await expect(page).toHaveURL('/books');
	await expect(page.getByRole('heading', { name: 'Books', level: 1 })).toBeVisible();
});

test('without the book_mgmt access: no menu entry, back to the home page', async ({ page }) => {
	await setup(page, { ...BOOKS, role: 'video_mgmt', access: ['upload', 'video_mgmt'] });
	await page.goto('/');
	const nav = page.getByRole('navigation', { name: 'Main navigation' });
	await expect(nav.getByRole('link')).toHaveText(['Schools', 'Upload', 'Videos']);
	await page.goto('/books');
	await expect(page).toHaveURL('/');
});

test('in French', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('lang', 'fr'));
	await setup(page);
	await page.route('/api/books', (r) => r.fulfill({ json: [] }));
	await page.route('/api/tags', (r) => r.fulfill({ json: [] }));
	await page.goto('/books');
	await expect(page.getByRole('heading', { name: 'Livres', level: 1 })).toBeVisible();
	await expect(page.getByText('Pas encore de livre.')).toBeVisible();
});

// --- uploading a book (the API and tusd faked; the PDF really read by EmbedPDF here) ---

const PDF = 'tests/fixtures/book.pdf';
const TAGS: Tag[] = [{ id: 'year', name: 'Year', format: 'regexp', input_mode: 'numeric', regexp: '[12][0-9]{3}' }];

interface Fake {
	exists: boolean;
	submitted: unknown[];
	tus: { method: string; path: string; kind?: string }[];
	books: BookRow[];
}

async function uploading(page: Page, user: object = BOOKS) {
	await setup(page, user);
	const fake: Fake = { exists: false, submitted: [], tus: [], books: [] };
	await page.route('/api/tags', (r) => r.fulfill({ json: TAGS }));
	await page.route('/api/uploads/limits', (r) =>
		r.fulfill({ json: { max_bytes: 20 * 1024 ** 3, extensions: ['mp4'], book_max_bytes: 1024 ** 3 } })
	);
	await page.route('/api/uploads/available', (r) => r.fulfill({ json: { available: true } }));
	await page.route('/api/uploads/mine', (r) => r.fulfill({ json: [] }));
	await page.route('/api/performers', (r) => r.fulfill({ json: [] }));
	await page.route('/api/catalog', (r) => r.fulfill({ json: { schools: [] } }));
	await page.route('/api/books/exists*', (r) => r.fulfill({ json: { exists: fake.exists } }));
	await page.route('/api/books', (r) => {
		if (r.request().method() === 'GET') return r.fulfill({ json: fake.books });
		fake.submitted.push(r.request().postDataJSON());
		return r.fulfill({ status: 201, json: { id: 9 } });
	});
	let created = 0;
	const lengths: Record<string, string> = {}; // WebKit gives routes no PATCH body: the announced size
	await page.route('/files/**', (r) => {
		const req = r.request();
		const tus = { 'Tus-Resumable': '1.0.0' };
		const path = new URL(req.url()).pathname;
		if (req.method() === 'POST') {
			const meta = Object.fromEntries(
				(req.headers()['upload-metadata'] ?? '').split(',').map((kv) => {
					const [k, v] = kv.split(' ');
					return [k, Buffer.from(v ?? '', 'base64').toString()];
				})
			);
			fake.tus.push({ method: 'POST', path, kind: meta.kind });
			created += 1;
			const location = `/files/${'0'.repeat(31)}${created}`;
			lengths[location] = req.headers()['upload-length'];
			return r.fulfill({ status: 201, headers: { ...tus, Location: location } });
		}
		fake.tus.push({ method: req.method(), path });
		return r.fulfill({ status: 204, headers: { ...tus, 'Upload-Offset': lengths[path] } });
	});
	return fake;
}

test('the upload page ends with the book upload form, only with book_mgmt', async ({ page }) => {
	await uploading(page);
	await page.goto('/upload');
	const form = page.getByRole('region', { name: 'Upload a book' });
	await expect(form.getByLabel('Choose a PDF file')).toBeVisible(); // the form itself, no link to it
	const headings = await page.getByRole('heading').allTextContents();
	expect(headings.at(-1)).toBe('Upload a book');

	await uploading(page, { ...BOOKS, role: 'uploader', access: ['upload'] });
	await page.goto('/upload');
	await expect(page.getByRole('heading', { name: 'Upload a video', level: 1 })).toBeVisible();
	await expect(page.getByRole('region', { name: 'Upload a book' })).toHaveCount(0);
});

test('a PDF read here: its title, author and first page; the reference; uploaded, then queued', async ({ page }) => {
	const fake = await uploading(page);
	await page.goto('/upload');
	await page.getByLabel('Choose a PDF file').setInputFiles(PDF);

	// What the PDF says about itself, and its first page (rendered by EmbedPDF's PDFium).
	await expect(page.getByLabel('Title *')).toHaveValue('Togakure-ryu Densho');
	await expect(page.getByLabel('Name, as written')).toHaveValue('Masaaki Hatsumi');
	const firstPage = page.getByRole('img', { name: 'First page of the book' });
	await expect(firstPage).toBeVisible();
	expect(await firstPage.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(480);
	await expect(page.getByText('1 page(s)')).toBeVisible();

	// The family name first, as typed: "as written" off gives family + given fields.
	await page.getByLabel('As written', { exact: true }).uncheck();
	await page.getByLabel('Family name').fill('Hatsumi');
	await page.getByLabel('Given name').fill('Masaaki');
	await page.getByLabel('Publisher (university for a thesis)').fill('Kodansha');
	await page.getByLabel('Place of publication').fill('Tokyo');
	await page.getByLabel('Date', { exact: true }).fill('May');
	await page.getByLabel('Date', { exact: true }).blur();
	await expect(page.getByText('A date is a year, or year-month')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Upload', exact: true })).toBeDisabled();
	await page.getByLabel('Date', { exact: true }).fill('1981');
	const preview = page.locator('.preview');
	await expect(preview).toContainText('Hatsumi, Masaaki. Togakure-ryu Densho. Tokyo: Kodansha, 1981.');
	await expect(preview.locator('i')).toHaveText('Togakure-ryu Densho');
	await page.getByLabel('Add a tag').selectOption('year');
	await page.getByLabel('Value', { exact: true }).fill('1981');
	await page.getByRole('button', { name: 'Add', exact: true }).click();

	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByText('Uploaded: the book is published in a few seconds.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'See the books' })).toHaveAttribute('href', '/books');
	expect(fake.tus.map((r) => `${r.method} ${r.kind ?? ''}`.trim())).toEqual([
		'POST book',
		'PATCH',
		'POST image',
		'PATCH'
	]);
	expect(fake.submitted).toEqual([
		{
			upload: `${'0'.repeat(31)}1`,
			thumbnail_upload: `${'0'.repeat(31)}2`,
			original_filename: 'book.pdf',
			pages: 1,
			reference: {
				type: 'book',
				title: 'Togakure-ryu Densho',
				publisher: 'Kodansha',
				'publisher-place': 'Tokyo',
				issued: { 'date-parts': [[1981]] },
				author: [{ family: 'Hatsumi', given: 'Masaaki' }]
			},
			tags: [{ id: 'year', value: '1981' }]
		}
	]);
});

test('a book already on the server, a file that is not a PDF: said at once', async ({ page }) => {
	const fake = await uploading(page);
	fake.exists = true;
	await page.goto('/upload');
	await page.getByLabel('Choose a PDF file').setInputFiles(PDF);
	await expect(page.getByRole('alert')).toHaveText('This book is already on the server.');
	await page.getByLabel('Choose a PDF file').setInputFiles({
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from('hello')
	});
	await expect(page.getByRole('alert')).toHaveText('Only PDF files can be uploaded here.');
	expect(fake.tus).toEqual([]);
});

// --- the list ---

const BOOK: BookRow = {
	id: 1,
	original_filename: 'densho.pdf',
	status: 'published',
	error: null,
	pages: 12,
	reference: { type: 'book', title: 'Ninjutsu', author: [{ family: 'Hatsumi', given: 'Masaaki' }] },
	uploaded_at: '2026-10-23T12:13:38+02:00',
	uploaded_by: 'Aiko',
	has_thumbnail: true,
	tags: []
};

test('the books: first page, reference, uploader; waiting or failed ones deletable', async ({ page }) => {
	const fake = await uploading(page);
	fake.books = [
		BOOK,
		{ ...BOOK, id: 2, status: 'queued', has_thumbnail: false, uploaded_by: null, pages: null },
		{ ...BOOK, id: 3, status: 'failed', error: 'Not a PDF file', has_thumbnail: false }
	];
	await page.route('/media/book/1/thumbnail', (r) =>
		r.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') })
	);
	let deleted = '';
	await page.route('/api/books/*', (r) => {
		deleted = new URL(r.request().url()).pathname;
		fake.books = fake.books.filter((b) => b.id !== 3);
		return r.fulfill({ status: 204 });
	});
	await page.goto('/books');
	await expect(page.getByText('3 book(s)', { exact: true })).toBeVisible();
	const first = page.locator('li[data-id="1"]');
	await expect(first).toContainText('Hatsumi, Masaaki. Ninjutsu.');
	await expect(first).toContainText('Uploaded by Aiko on Oct 23, 2026 · 12 page(s)');
	await expect(first.getByRole('img', { name: 'First page of the book' })).toBeVisible();
	await expect(first.getByRole('link', { name: 'Download the PDF' })).toHaveCount(0); // in the viewer only
	await expect(page.locator('li[data-id="2"]')).toContainText('Being published…');
	await expect(page.locator('li[data-id="2"]')).toContainText('Uploaded by a deleted user');
	const failed = page.locator('li[data-id="3"]');
	await expect(failed).toContainText('Not published: Not a PDF file');
	page.once('dialog', (d) => d.accept());
	await failed.getByRole('button', { name: 'Delete' }).click();
	await expect(page.locator('li[data-id="3"]')).toHaveCount(0);
	expect(deleted).toBe('/api/books/3');
});

test('no book yet: the way to upload one', async ({ page }) => {
	await uploading(page);
	await page.goto('/books');
	await expect(page.getByText('No book yet.')).toBeVisible();
	await expect(page.getByRole('link', { name: 'Upload a book (PDF)' })).toHaveAttribute('href', '/upload#book');
});

// --- filter and sort ---

const LIBRARY: BookRow[] = [
	{
		...BOOK,
		id: 3,
		reference: {
			type: 'book',
			title: 'Ninjutsu',
			author: [{ family: 'Hatsumi', given: 'Masaaki' }],
			issued: { 'date-parts': [[1981]] },
			language: 'en'
		},
		uploaded_at: '2026-10-25T10:00:00+02:00',
		pages: 200,
		tags: [{ id: 'year', value: '1981' }]
	},
	{
		...BOOK,
		id: 2,
		reference: {
			type: 'manuscript',
			title: 'Densho',
			'original-title': '伝書',
			editor: [{ literal: 'Bujinkan Dōjō' }]
		},
		uploaded_at: '2026-10-24T10:00:00+02:00',
		pages: null,
		uploaded_by: 'Ren'
	},
	{
		...BOOK,
		id: 1,
		reference: {
			type: 'book',
			title: 'Art of Invisibility',
			author: [{ family: 'Hayes', given: 'Stephen K.' }],
			issued: { 'date-parts': [[1975]] },
			language: 'ja'
		},
		uploaded_at: '2026-10-23T10:00:00+02:00',
		pages: 120
	}
];
const order = (page: Page) =>
	page.locator('li.book').evaluateAll((items) => items.map((i) => i.getAttribute('data-id')));

test('filter and sort: a pane with what the books offer, applied at once, kept on this device', async ({ page }) => {
	const fake = await uploading(page);
	fake.books = LIBRARY;
	await page.goto('/books');
	await expect(page.getByText('3 book(s)', { exact: true })).toBeVisible();
	expect(await order(page)).toEqual(['3', '2', '1']); // newest upload first

	const button = page.getByRole('button', { name: 'Filter and sort' });
	await button.click();
	const pane = page.getByRole('dialog', { name: 'Filter and sort' });
	await pane.getByLabel('Sort by').selectOption('title');
	await pane.getByLabel('Direction').selectOption({ label: 'A to Z' });
	await expect.poll(() => order(page)).toEqual(['1', '2', '3']);
	await pane.getByLabel('Sort by').selectOption('year');
	await expect(pane.getByLabel('Direction').locator('option')).toHaveText(['Oldest first', 'Most recent first']);
	await expect.poll(() => order(page)).toEqual(['1', '3', '2']); // without a date: last

	// The books' own values: names (authors and editors), types, languages (named), tags.
	await expect(pane.getByRole('group', { name: 'Authors and editors' }).getByRole('checkbox')).toHaveCount(3);
	await expect(pane.getByRole('group', { name: 'Language' })).toContainText('English');
	await expect(pane.getByRole('group', { name: 'Language' })).toContainText('Japanese');
	await pane.getByLabel('Masaaki Hatsumi').check();
	await pane.getByLabel('Bujinkan Dōjō').check();
	await expect.poll(() => order(page)).toEqual(['3', '2']);
	await pane.getByLabel('Manuscript (densho, makimono…)').check();
	await expect(pane.getByRole('status')).toHaveText('1 of 3 book(s) shown');
	await pane.getByRole('button', { name: 'Done' }).click();
	await expect(page.getByRole('button', { name: 'Filter and sort (3 active)' })).toBeVisible();
	await expect(page.getByRole('status').first()).toHaveText('1 of 3 book(s) shown');

	// Kept on this device: the same after a reload.
	await page.reload();
	await expect.poll(() => order(page)).toEqual(['2']);
	await page.getByRole('button', { name: 'Filter and sort (3 active)' }).click();
	await pane.getByRole('button', { name: 'Reset' }).click();
	await expect.poll(() => order(page)).toEqual(['3', '2', '1']);

	// A text in the titles (the original's too) or names, accents ignored; nothing matching says so.
	await pane.getByLabel('Title or name').fill('dojo');
	await expect.poll(() => order(page)).toEqual(['2']);
	await pane.getByLabel('Title or name').fill('伝書');
	await expect.poll(() => order(page)).toEqual(['2']);
	await pane.getByLabel('Title or name').fill('nothing like it');
	await expect(page.getByText('No book matches the filter.')).toBeVisible();
	await pane.getByLabel('Title or name').fill('');
	await pane.getByRole('button', { name: 'Close' }).click();
	await expect(pane).toBeHidden();
	await expect.poll(() => order(page)).toEqual(['3', '2', '1']);
});

// --- one book: the viewer (EmbedPDF really runs here), its annotations saved through the API ---

interface Saved {
	created: object[];
	changed: { id: number; body: Record<string, unknown> }[];
	deleted: number[];
	images: number[];
	thumbnails: number;
}

async function viewing(page: Page, annotations: object[] = [], book: Partial<BookRow> = {}) {
	const fake = await uploading(page);
	const saved: Saved = { created: [], changed: [], deleted: [], images: [], thumbnails: 0 };
	const row = { ...BOOK, id: 7, original_filename: 'book.pdf', pages: 1, ...book };
	fake.books = [row];
	await page.route('/api/books/7', (r) => r.fulfill({ json: row }));
	await page.route('/media/book/7', (r) => r.fulfill({ contentType: 'application/pdf', body: readFileSync(PDF) }));
	await page.route('/api/books/7/thumbnail', (r) => ((saved.thumbnails += 1), r.fulfill({ status: 204 })));
	let next = 100;
	const rows = new Map<number, Record<string, unknown>>(annotations.map((a) => [(a as { id: number }).id, a as never]));
	await page.route('/api/books/7/annotations', (r) => {
		if (r.request().method() === 'GET') return r.fulfill({ json: annotations });
		const body = r.request().postDataJSON();
		saved.created.push(body);
		next += 1;
		rows.set(next, annotationRow(next, body));
		return r.fulfill({ status: 201, json: rows.get(next) });
	});
	await page.route('/api/book-annotations/*', (r) => {
		const id = Number(new URL(r.request().url()).pathname.split('/').at(-1));
		if (r.request().method() === 'DELETE') return (saved.deleted.push(id), r.fulfill({ status: 204 }));
		const body = r.request().postDataJSON();
		saved.changed.push({ id, body });
		rows.set(id, { ...rows.get(id), ...body });
		return r.fulfill({ json: rows.get(id) });
	});
	await page.route('/api/book-annotations/*/image', (r) => {
		saved.images.push(Number(new URL(r.request().url()).pathname.split('/').at(-2)));
		return r.fulfill({ status: 204 });
	});
	await page.route('/api/catalog', (r) => r.fulfill({ json: VIEWER_CATALOG }));
	return saved;
}

const HIGHLIGHT_ROW = { page: 1, kind: 'text', target: '{}', quote: null, color: null, note: null, technique: null };
const annotationRow = (id: number, body: Record<string, unknown>) => ({
	...HIGHLIGHT_ROW,
	...body,
	id,
	has_image: false,
	created_by: 'Aiko',
	created_at: '2026-11-01T10:00:00+01:00',
	modified_at: '2026-11-01T10:00:00+01:00',
	mine: true
});
const VIEWER_CATALOG = { schools: [], categories: [], weapons: [], sections: [], techniques: [], segments: [] };

test('a book opened: the PDF shown, a highlight and a region saved, the first page made again', async ({ page }) => {
	const saved = await viewing(page, [], { has_thumbnail: false });
	await page.goto('/books');
	await page.getByRole('link', { name: /Ninjutsu/ }).click();
	await expect(page).toHaveURL('/books/7');
	const box = await pageBox(page);
	await expect(page.getByRole('status').filter({ hasText: 'Page 1 of 1' })).toBeVisible();
	await expect.poll(() => saved.thumbnails).toBe(1); // the book had no first page
	const pt = box.width / 420; // the fixture's page: 420 pt wide; its title at 24 pt, 60 pt from the left, near the top

	// EmbedPDF's highlight tool: the title's text selected by a drag, highlighted, its text kept as the quote.
	await page.getByRole('button', { name: 'Highlight text' }).click();
	await drag(page, [box.x + 62 * pt, box.y + 90 * pt], [box.x + 200 * pt, box.y + 90 * pt]);
	await expect.poll(() => saved.created.length, { timeout: 10_000 }).toBe(1);
	expect(saved.created[0]).toMatchObject({ page: 1, kind: 'text', quote: expect.stringMatching(/^Togakure-ryu/) });
	const highlight = JSON.parse((saved.created[0] as { target: string }).target);
	expect([highlight.type, highlight.segmentRects.length, highlight.author]).toEqual([9, 1, 'aiko']);
	await expect(page.locator('section.annotations li')).toHaveCount(1);
	await expect(page.getByRole('button', { name: 'Highlight text' })).toHaveAttribute('aria-pressed', 'false'); // done

	// EmbedPDF's square tool (a region, for scans): the box drawn, its crop uploaded and attached.
	await page.getByRole('button', { name: 'Mark a region' }).click();
	await drag(page, [box.x + 60 * pt, box.y + 115 * pt], [box.x + 300 * pt, box.y + 180 * pt]);
	await expect.poll(() => saved.created.length, { timeout: 10_000 }).toBe(2);
	expect(saved.created[1]).toMatchObject({ page: 1, kind: 'region' });
	expect(JSON.parse((saved.created[1] as { target: string }).target).strokeWidth).toBe(3); // half the default
	await expect.poll(() => saved.images, { timeout: 10_000 }).toEqual([102]);
	await expect(page.locator('section.annotations li')).toHaveCount(2);

	// A drag where there is no text, with the highlight tool: no annotation.
	await page.getByRole('button', { name: 'Highlight text' }).click();
	await drag(page, [box.x + 300 * pt, box.y + 30 * pt], [box.x + 400 * pt, box.y + 60 * pt]);
	await page.waitForTimeout(500);
	expect(saved.created).toHaveLength(2);
});

test('saved annotations shown; the selected one gets a note, a colour, or is deleted', async ({ page }) => {
	const target = {
		type: 9,
		id: 'saved-1',
		pageIndex: 0,
		rect: { origin: { x: 60, y: 78 }, size: { width: 141, height: 23 } },
		segmentRects: [{ origin: { x: 60, y: 78 }, size: { width: 141, height: 23 } }],
		strokeColor: '#FFCD45', // what the highlight tool writes: the colour drawn…
		color: '#FFCD45', // …and EmbedPDF's deprecated name, never drawn
		opacity: 0.5,
		author: 'Aiko'
	};
	const saved = await viewing(page, [
		annotationRow(5, { ...HIGHLIGHT_ROW, target: JSON.stringify(target), quote: 'Togakure-ryu', color: '#FFCD45' })
	]);
	await page.goto('/books/7');
	const box = await pageBox(page);
	const pt = box.width / 420; // the fixture's page: 420 pt wide
	const marked = { x: box.x + 60 * pt + 3, y: box.y + 78 * pt + 3, width: 141 * pt - 6, height: 23 * pt - 6 };
	await expect.poll(() => drawnColor(page, marked).then(yellowish)).toBe(true);
	const item = page.locator('section.annotations li[data-id="5"]');
	await expect(item).toContainText('Togakure-ryu');
	await expect(item).toContainText('By Aiko');
	await item.getByRole('button', { name: /Page 1/ }).click();
	await item.getByLabel('Note').fill('The first school');
	await item.getByRole('button', { name: 'Save' }).click();
	await expect.poll(() => saved.changed.at(-1)?.body).toEqual({ note: 'The first school' });
	await item.getByRole('button', { name: 'Blue' }).click();
	await expect.poll(() => saved.changed.at(-1)?.body.color).toBe('#60A5FA');
	expect(JSON.parse(saved.changed.at(-1)!.body.target as string).strokeColor).toBe('#60A5FA'); // as the PDF holds it
	await expect(item.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => drawnColor(page, marked).then(bluish)).toBe(true); // drawn blue, not only saved
	page.once('dialog', (d) => d.accept());
	await item.getByRole('button', { name: 'Delete the annotation' }).click();
	await expect.poll(() => saved.deleted).toEqual([5]);
	await expect(page.locator('section.annotations li')).toHaveCount(0);
});

// --- comments on an annotation; the copy with every annotation and comment in it ---

const SAVED_TARGET = {
	type: 9,
	id: 'saved-1',
	pageIndex: 0,
	rect: { origin: { x: 60, y: 78 }, size: { width: 141, height: 23 } },
	segmentRects: [{ origin: { x: 60, y: 78 }, size: { width: 141, height: 23 } }],
	color: '#FFCD45',
	opacity: 0.5,
	author: 'Aiko'
};
const SAVED_ROW = {
	...HIGHLIGHT_ROW,
	target: JSON.stringify(SAVED_TARGET),
	quote: 'Togakure-ryu',
	note: 'The first school',
	technique: 'gyokko.taijutsu.jo_ryaku.koku'
};
const THREAD_COMMENT = {
	id: 30,
	annotation: 5,
	user: 'Ren',
	created_at: '2026-11-02T10:00:00+01:00',
	modified_at: '2026-11-02T10:00:00+01:00',
	lang: 'en',
	text: 'Seen in the dojo',
	mine: false
};

test('an annotation’s comments: its thread, a new one added', async ({ page }) => {
	await viewing(page, [annotationRow(5, SAVED_ROW)]);
	const thread = [THREAD_COMMENT];
	await page.route('/api/book-annotations/5/comments', (r) => {
		if (r.request().method() === 'POST') {
			thread.push({ ...THREAD_COMMENT, id: 31, user: 'Aiko', mine: true, ...r.request().postDataJSON() });
			return r.fulfill({ status: 201, json: thread.at(-1) });
		}
		return r.fulfill({ json: thread });
	});
	await page.goto('/books/7');
	await pageBox(page);
	const item = page.locator('section.annotations li[data-id="5"]');
	await item.getByRole('button', { name: /Page 1/ }).click();
	const comments = item.getByRole('region', { name: 'Comments on this annotation' });
	await expect(comments).toContainText('Seen in the dojo');
	await comments.getByRole('button', { name: 'Add a comment' }).click();
	await comments.getByRole('textbox').fill('And in the scroll');
	await comments.getByRole('button', { name: 'Save' }).click();
	await expect(comments).toContainText('And in the scroll');
});

test('downloaded with its annotations: in the PDF, with author, technique, note and the comments as replies', async ({
	page
}) => {
	await viewing(page, [annotationRow(5, SAVED_ROW)]);
	await page.route('/api/books/7/comments', (r) => r.fulfill({ json: [THREAD_COMMENT] }));
	await page.route('/api/catalog', (r) => r.fulfill({ json: CATALOG }));
	await page.goto('/books/7');
	await pageBox(page);
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Download with annotations' }).click();
	const file = await download;
	// WebKit writes the spaces as underscores.
	expect(file.suggestedFilename()).toMatch(/^book[ _]\(annotated[ _]\d{4}-\d{2}-\d{2}\)\.pdf$/);
	const saved = test.info().outputPath('annotated.pdf'); // saveAs: the browser may run elsewhere (Docker)
	await file.saveAs(saved);
	const annotations = await pdfAnnotations(readFileSync(saved));
	const highlight = annotations.find((a) => a.type === 9)!;
	expect(highlight.author).toBe('Aiko');
	expect(highlight.contents).toMatch(
		/^Technique: \S+ Koku — https:\/\/localhost:\d+\/schools\/gyokko\/taijutsu\/jo_ryaku\/koku\n\nThe first school$/
	);
	const reply = annotations.find((a) => a.type === 1)!;
	expect([reply.author, reply.contents, reply.inReplyToId]).toEqual(['Ren', 'Seen in the dojo', highlight.id]);
	expect(annotations).toHaveLength(2);
});

// --- the technique's page: what the books say about it ---

const KOKU_PAGE = '/schools/gyokko/taijutsu/jo_ryaku/koku';
const NOTES = [
	{
		id: 5,
		book_id: 7,
		page: 3,
		kind: 'text',
		quote: 'Koku: the empty space',
		note: 'The key point',
		has_image: false,
		created_by: 'Aiko',
		created_at: '2026-11-01T10:00:00+01:00',
		modified_at: '2026-11-01T10:00:00+01:00',
		reference: BOOK.reference,
		comments: [{ ...THREAD_COMMENT, annotation: undefined }]
	},
	{
		id: 6,
		book_id: 7,
		page: 9,
		kind: 'region',
		quote: null,
		note: null,
		has_image: true,
		created_by: null,
		created_at: '2026-11-01T10:00:00+01:00',
		modified_at: '2026-11-03T10:00:00+01:00',
		reference: BOOK.reference,
		comments: []
	}
];

async function techniquePage(page: Page, user: object, notes: object[]) {
	await setup(page, user);
	await page.route('/api/catalog', (r) => r.fulfill({ json: { ...CATALOG, segments: [] } }));
	await page.route('/api/techniques/*/comments', (r) => r.fulfill({ json: [] }));
	await page.route('/api/techniques/*/book-notes', (r) => r.fulfill({ json: notes }));
	await page.route('/media/book-annotation/6/image', (r) =>
		r.fulfill({ contentType: 'image/png', body: Buffer.from(PNG, 'base64') })
	);
}

test('a technique’s page: the books’ annotations about it, after the description, before the videos', async ({
	page
}) => {
	const plain = { username: 'kenji', name: null, role: 'user', role_name: 'User', access: ['segment', 'comment'] };
	await techniquePage(
		page,
		plain,
		NOTES.map((n) => ({ ...n, book_id: null }))
	);
	await page.goto(KOKU_PAGE);
	const books = page.getByRole('heading', { name: 'In the books', level: 2 });
	await expect(books).toBeVisible();
	const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
	expect(headings.indexOf('In the books')).toBeLessThan(headings.indexOf('Videos'));
	const [first, second] = await page.getByRole('article', { name: 'An annotation from a book' }).all();
	await expect(first.locator('blockquote')).toHaveText('Koku: the empty space');
	await expect(first).toContainText('The key point');
	await expect(first).toContainText('Hatsumi, Masaaki. Ninjutsu. (PDF page 3)');
	await expect(first.locator('.source i')).toHaveText('Ninjutsu');
	await expect(first).toContainText('By Aiko, Nov 1, 2026');
	await expect(first.getByRole('list', { name: 'Comments on this annotation' })).toContainText('Seen in the dojo');
	await expect(second.getByRole('img', { name: 'The region annotated' })).toBeVisible();
	await expect(second).toContainText('By a deleted user');
	await expect(page.getByRole('link', { name: 'Open in the book' })).toHaveCount(0); // not a book manager
});

test('no book about it: nothing shown; a book manager opens the book on the annotation', async ({ page }) => {
	await techniquePage(page, BOOKS, []);
	await page.goto(KOKU_PAGE);
	await expect(page.getByRole('heading', { name: 'Comments', level: 2 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'In the books' })).toHaveCount(0);

	await viewing(page, [annotationRow(5, SAVED_ROW)]);
	await page.unroute('/api/techniques/*/book-notes');
	await page.route('/api/catalog', (r) => r.fulfill({ json: { ...CATALOG, segments: [] } })); // the technique's
	await page.route('/api/techniques/*/book-notes', (r) => r.fulfill({ json: NOTES.slice(0, 1) }));
	await page.goto(KOKU_PAGE);
	await page.getByRole('link', { name: 'Open in the book' }).click();
	await expect(page).toHaveURL('/books/7?annotation=5');
	await pageBox(page);
	await expect(page.locator('section.annotations li[data-id="5"]')).toHaveClass(/selected/);
});

test('a PDF without its fonts: the missing font fetched from the app (never a CDN), the page drawn', async ({
	page
}) => {
	await viewing(page);
	await page.route('/media/book/7', (r) =>
		r.fulfill({ contentType: 'application/pdf', body: readFileSync('tests/fixtures/book-jp.pdf') })
	);
	const elsewhere: string[] = [];
	// Every request on the page's own origin (blob: workers and data: are the page's too).
	const host = new URL(test.info().project.use.baseURL!).host;
	page.on('request', (r) => {
		const at = new URL(r.url());
		if (!['blob:', 'data:'].includes(at.protocol) && at.host !== host) elsewhere.push(r.url());
	});
	const font = page.waitForResponse((r) => /\/_app\/immutable\/pdf-fonts\/[^/]+\/jp\/NotoSansJP-/.test(r.url()));
	await page.goto('/books/7');
	await pageBox(page);
	expect((await font).status()).toBe(200);
	expect(elsewhere).toEqual([]);
	// The text drawn (with the app's font): dark pixels in its band of the page (48 pt glyphs on a
	// 400 pt baseline, from the bottom of a 595 pt page).
	const sheet = page.locator('.page[data-page="1"] img').first();
	await expect
		.poll(() =>
			sheet.evaluate((img: HTMLImageElement) => {
				const canvas = document.createElement('canvas');
				[canvas.width, canvas.height] = [img.naturalWidth, img.naturalHeight];
				const context = canvas.getContext('2d')!;
				context.drawImage(img, 0, 0);
				const top = Math.round(img.naturalHeight * (150 / 595));
				const band = context.getImageData(0, top, img.naturalWidth, Math.round(img.naturalHeight * (50 / 595)));
				let dark = 0;
				for (let i = 0; i < band.data.length; i += 4) if (band.data[i] < 100) dark++;
				return dark;
			})
		)
		.toBeGreaterThan(500);
});

test('a quote the PDF gives garbled (a font without its map): said in the panel and on the technique page', async ({
	page
}) => {
	const garbled = 'RUV\u000fDLUFRQGLWLRQHUV Note: :KHQSRVLWLRQLQJWKHGHYLFH';
	await viewing(page, [
		annotationRow(5, { ...SAVED_ROW, quote: garbled }),
		annotationRow(6, { ...SAVED_ROW, target: JSON.stringify({ ...SAVED_TARGET, id: 'saved-2' }) })
	]);
	await page.goto('/books/7');
	await pageBox(page);
	await expect(page.locator('section.annotations li[data-id="5"]')).toContainText('this quote is garbled');
	await expect(page.locator('section.annotations li[data-id="6"]')).not.toContainText('garbled');

	await page.route('/api/catalog', (r) => r.fulfill({ json: { ...CATALOG, segments: [] } }));
	await page.route('/api/techniques/*/comments', (r) => r.fulfill({ json: [] }));
	await page.route('/api/techniques/*/book-notes', (r) => r.fulfill({ json: [{ ...NOTES[0], quote: garbled }] }));
	await page.goto(KOKU_PAGE);
	await expect(page.getByRole('article', { name: 'An annotation from a book' })).toContainText(
		'The book’s text could not be read here'
	);
});

test('an annotation saved with a technique and no note (a note is optional)', async ({ page }) => {
	const saved = await viewing(page, [annotationRow(5, { ...SAVED_ROW, note: null, technique: null })]);
	await page.route('/api/catalog', (r) => r.fulfill({ json: { ...CATALOG, segments: [] } }));
	await page.goto('/books/7');
	await pageBox(page);
	const item = page.locator('section.annotations li[data-id="5"]');
	await item.getByRole('button', { name: /Page 1/ }).click();
	const save = item.getByRole('button', { name: 'Save', exact: true });
	await expect(save).toBeDisabled(); // nothing changed yet
	const open = item.getByRole('link', { name: 'Open its page in the catalogue' });
	await expect(open).toHaveCount(0); // no technique yet
	await item.getByLabel('School').selectOption('gyokko');
	await item.getByLabel('Scroll or form').selectOption('gyokko.taijutsu.jo_ryaku');
	await item.getByLabel('Technique').selectOption(KOKU);
	await save.click();
	await expect.poll(() => saved.changed.at(-1)?.body).toEqual({ technique: KOKU });
	await expect(open).toHaveAttribute('href', '/schools/gyokko/taijutsu/jo_ryaku/koku'); // after its name
});

test('a highlight given other text without deleting it: its ends moved, its quote changed', async ({ page }) => {
	const saved = await viewing(page, [annotationRow(5, { ...SAVED_ROW, quote: 'Togakure-ryu' })]);
	await page.goto('/books/7');
	const box = await pageBox(page);
	const pt = box.width / 420;
	const item = page.locator('section.annotations li[data-id="5"]');
	await item.getByRole('button', { name: /Page 1/ }).click();
	await item.getByRole('button', { name: 'Change the highlighted text' }).click();
	await expect(item.getByRole('status')).toContainText('Select the new text on page 1');
	await drag(page, [box.x + 62 * pt, box.y + 90 * pt], [box.x + 140 * pt, box.y + 90 * pt]); // part of the title
	await expect.poll(() => saved.changed.length, { timeout: 10_000 }).toBeGreaterThan(0);
	const change = saved.changed.at(-1)!;
	expect(change.id).toBe(5);
	expect(change.body.quote).toMatch(/^Toga/); // part of the title only
	expect(change.body.quote).not.toBe('Togakure-ryu');
	expect(JSON.parse(change.body.target as string).id).toBe('saved-1'); // the same annotation
	expect(saved.deleted).toEqual([]);
	await expect(item.getByRole('button', { name: 'Change the highlighted text' })).toBeVisible();
});

test('a quote cut, not selected, at a region picture’s height, ending with “…”; whole once selected', async ({
	page
}) => {
	const long = 'Togakure-ryu '.repeat(60).trim();
	await viewing(page, [annotationRow(5, { ...SAVED_ROW, quote: long })]);
	await page.goto('/books/7');
	await pageBox(page);
	const quote = page.locator('section.annotations li[data-id="5"] q');
	const lines = () => quote.evaluate((q) => getComputedStyle(q).webkitLineClamp);
	await expect.poll(lines).toBe('6');
	const height = await quote.evaluate((q) => q.getBoundingClientRect().height);
	const fontSize = await quote.evaluate((q) => parseFloat(getComputedStyle(q).fontSize));
	expect(height).toBeLessThanOrEqual(6 * 1.5 * fontSize + 1);
	await page
		.locator('section.annotations li[data-id="5"]')
		.getByRole('button', { name: /Page 1/ })
		.click();
	await expect.poll(lines).toBe('none');
});
