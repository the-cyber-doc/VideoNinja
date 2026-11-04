import { readFileSync } from 'node:fs';
import { expect, test, type Cookie } from '@playwright/test';
import { admin, loggedIn, register } from '../accounts';

// The real containers only (tools/test-e2e-stack.sh), project "stack": a book uploaded
// through nginx and tusd, checked and published by the encoder container (its first page
// re-encoded by ffmpeg), the PDF and the thumbnail served by nginx after the API's check.
test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const PDF = 'tests/fixtures/book.pdf';
let adminCookies: Cookie[] = [];
let bookId = 0;

// The admin logs in once (nginx's credentials limit), every test reuses the session.
test.beforeAll(async ({ browser }) => {
	const context = await loggedIn(browser, admin());
	adminCookies = await context.cookies();
	await context.close();
});

test.beforeEach(async ({ context }) => {
	await context.addCookies(adminCookies);
});

test('a book: read here, uploaded through tusd, published by the encoder', async ({ page }) => {
	await page.goto('upload/book');
	await page.getByLabel('Choose a PDF file').setInputFiles(PDF);
	await expect(page.getByLabel('Title *')).toHaveValue('Togakure-ryu Densho');
	await expect(page.getByRole('img', { name: 'First page of the book' })).toBeVisible();
	await page.getByLabel('Date', { exact: true }).fill('1981');
	await page.getByRole('button', { name: 'Upload', exact: true }).click();
	await expect(page.getByRole('status')).toContainText('Uploaded', { timeout: 60_000 });

	const published = async () => {
		const books = await (await page.request.get('api/books')).json();
		const book = books.find((b: { original_filename: string }) => b.original_filename === 'book.pdf');
		bookId = book?.id ?? 0;
		return book?.status;
	};
	await expect.poll(published, { timeout: 60_000 }).toBe('published');
});

test('nginx serves the PDF as uploaded (a download) and its first page', async ({ page }) => {
	const pdf = await page.request.get(`media/book/${bookId}`);
	expect(pdf.status()).toBe(200);
	expect(pdf.headers()['content-type']).toBe('application/pdf');
	expect(pdf.headers()['content-disposition']).toBe('attachment');
	expect((await pdf.body()).equals(readFileSync(PDF))).toBe(true); // never rewritten
	const thumbnail = await page.request.get(`media/book/${bookId}/thumbnail`);
	expect(thumbnail.status()).toBe(200);
	expect(thumbnail.headers()['content-type']).toBe('image/jpeg');

	await page.goto('books');
	const card = page.locator(`li[data-id="${bookId}"]`);
	await expect(card).toContainText('Togakure-ryu Densho. 1981.');
	const img = card.getByRole('img', { name: 'First page of the book' });
	await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(480);
});

test('without book_mgmt: neither the list nor the files', async ({ page, browser }) => {
	const viewer = await loggedIn(browser, await register(page.request, 'yuki', 'user', 'Yuki'));
	for (const path of ['api/books', `media/book/${bookId}`, `media/book/${bookId}/thumbnail`])
		expect((await viewer.request.get(path)).status(), path).toBe(403);
	await viewer.close();
});
