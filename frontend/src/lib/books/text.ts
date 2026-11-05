// A book's page text, for the search (the server has no PDF parser): read by the browser
// with EmbedPDF's engine (at the upload, else once by the viewer) and sent in batches small
// enough for nginx (1 MB per API request). A page that gives no text (a scan) or garbled
// text (a font without its ToUnicode map, ./quality.ts) is sent empty: not searched.
import type { BookText } from '../api/types';
import { looksGarbled } from './quality';

/** What pageTexts uses of the engine (PdfEngine), so that tests can fake it. */
export interface TextEngine {
	extractText(doc: unknown, pageIndexes: number[]): { toPromise(): Promise<string> };
}

/** At most this many characters of a page (the server's page_text rule). */
export const PAGE_CHARS = 100_000;
/** A batch's JSON at most this many bytes (nginx: 1 MB). */
export const BATCH_BYTES = 800_000;

/** Every page's text, in order ("" for none). */
export async function pageTexts(engine: TextEngine, doc: { pages: { index: number }[] }): Promise<string[]> {
	const out: string[] = [];
	for (const page of doc.pages) {
		const text = await engine
			.extractText(doc, [page.index])
			.toPromise()
			.catch(() => '');
		out.push(looksGarbled(text) ? '' : text.trim().slice(0, PAGE_CHARS));
	}
	return out;
}

const bytes = (s: string) => new TextEncoder().encode(JSON.stringify(s)).length + 1;

/** The pages in batches of at most BATCH_BYTES; the last one says so (none: one empty batch). */
export function batches(pages: string[], max = BATCH_BYTES): BookText[] {
	const out: BookText[] = [];
	let batch: BookText = { first: 1, pages: [], last: false };
	let size = 0;
	pages.forEach((page, i) => {
		const n = bytes(page);
		if (batch.pages.length && size + n > max) {
			out.push(batch);
			batch = { first: i + 1, pages: [], last: false };
			size = 0;
		}
		batch.pages.push(page);
		size += n;
	});
	out.push({ ...batch, last: true });
	return out;
}

/** Send them all, in order (a failure stops: the viewer sends them again another time). */
export async function sendText(bookId: number, pages: string[], put: (id: number, body: BookText) => Promise<void>) {
	for (const batch of batches(pages)) await put(bookId, batch);
}
