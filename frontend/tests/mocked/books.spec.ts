import { expect, test, type Page } from '@playwright/test';
import type { BookRow, Tag } from '../../src/lib/api/types';

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

test('the upload page offers books at its end, only with book_mgmt', async ({ page }) => {
	await uploading(page);
	await page.goto('/upload');
	const link = page.getByRole('link', { name: 'Upload a book (PDF)' });
	await expect(link).toHaveAttribute('href', '/upload/book');
	await link.click();
	await expect(page.getByRole('heading', { name: 'Upload a book', level: 1 })).toBeVisible();

	await uploading(page, { ...BOOKS, role: 'uploader', access: ['upload'] });
	await page.goto('/upload');
	await expect(page.getByRole('heading', { name: 'Upload a video', level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Upload a book (PDF)' })).toHaveCount(0);
	await page.goto('/upload/book');
	await expect(page).toHaveURL('/');
});

test('a PDF read here: its title, author and first page; the reference; uploaded, then queued', async ({ page }) => {
	const fake = await uploading(page);
	await page.goto('/upload/book');
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
	await expect(page.getByRole('status')).toContainText('Uploaded: the book is published in a few seconds.');
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
	await page.goto('/upload/book');
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
	await expect(first.getByRole('link', { name: 'Download the PDF' })).toHaveAttribute('href', '/media/book/1');
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
	await expect(page.getByRole('link', { name: 'Upload a book (PDF)' })).toHaveAttribute('href', '/upload/book');
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
