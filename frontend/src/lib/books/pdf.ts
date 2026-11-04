// What the browser reads from a PDF before uploading it: its page count, its own
// metadata (title, author: offered to the reference form) and its first page as a
// JPEG (the book's thumbnail). EmbedPDF's PDFium engine (WebAssembly), loaded on
// demand (only the pages that need it get the chunk and the .wasm). Never a fallback
// font from a CDN (fontFallback null: the CSP allows 'self' only).
import wasmUrl from '@embedpdf/pdfium/pdfium.wasm?url';

/** Thumbnail width in pixels (the server re-encodes it, at most this wide). */
export const THUMBNAIL_WIDTH = 480;

export interface PdfFacts {
	pages: number;
	title: string | null;
	author: string | null;
	/** Page 1 as a JPEG; null if it could not be rendered (the book is uploaded anyway). */
	thumbnail: Blob | null;
}

export async function readPdf(file: Blob): Promise<PdfFacts> {
	const { createPdfiumEngine } = await import('@embedpdf/engines/pdfium-direct-engine');
	const engine = await createPdfiumEngine(wasmUrl, { fontFallback: null });
	try {
		const content = await file.arrayBuffer();
		const doc = await engine.openDocumentBuffer({ id: 'upload', content }).toPromise();
		try {
			const meta = await engine
				.getMetadata(doc)
				.toPromise()
				.catch(() => null);
			let thumbnail: Blob | null = null;
			const first = doc.pages[0];
			if (first) {
				try {
					thumbnail = await engine
						.renderPage(doc, first, {
							scaleFactor: THUMBNAIL_WIDTH / first.size.width,
							imageType: 'image/jpeg',
							imageQuality: 0.85
						})
						.toPromise();
				} catch {
					thumbnail = null;
				}
			}
			return { pages: doc.pageCount, title: clean(meta?.title), author: clean(meta?.author), thumbnail };
		} finally {
			await engine.closeDocument(doc).toPromise();
		}
	} finally {
		await engine.destroy().toPromise();
	}
}

const clean = (s: string | null | undefined) => s?.trim() || null;

// --- the viewer's engine (EmbedPDF's, the document it shows) ---

/** What these helpers use of the engine (PdfEngine), so that tests can fake it. */
export interface PageEngine {
	/** Holes where a character has no box (spaces, line ends). */
	getPageGlyphs(doc: unknown, page: unknown): { toPromise(): Promise<({ origin: Point; size: Size } | undefined)[]> };
	getTextSlices(
		doc: unknown,
		slices: { pageIndex: number; charIndex: number; charCount: number }[]
	): { toPromise(): Promise<string[]> };
	renderPageRect(doc: unknown, page: unknown, rect: Box, options: object): { toPromise(): Promise<Blob> };
}
interface Point {
	x: number;
	y: number;
}
interface Size {
	width: number;
	height: number;
}
export interface Box {
	origin: Point;
	size: Size;
}
export interface PageDoc {
	pages: { index: number; size: Size }[];
}

/** Longest quote kept (the server's annotation_quote rule). */
export const QUOTE_MAX = 4000;
/** A crop's longest side in pixels. */
export const CROP_SIZE = 1200;

const inside = (p: Point, r: Box) =>
	p.x >= r.origin.x && p.x <= r.origin.x + r.size.width && p.y >= r.origin.y && p.y <= r.origin.y + r.size.height;

/** The text whose characters' centres fall in the rectangles (a highlight's), in reading
 * order; null when there is none (a scanned page has no text). */
export async function quoteOf(engine: PageEngine, doc: PageDoc, pageIndex: number, rects: Box[]) {
	const page = doc.pages[pageIndex];
	if (!page) return null;
	const glyphs = await engine.getPageGlyphs(doc, page).toPromise();
	const runs: { pageIndex: number; charIndex: number; charCount: number }[] = [];
	glyphs.forEach((g, i) => {
		if (!g?.size) return; // the engine leaves holes (spaces, line ends)
		const centre = { x: g.origin.x + g.size.width / 2, y: g.origin.y + g.size.height / 2 };
		if (!rects.some((r) => inside(centre, r))) return;
		const last = runs.at(-1);
		if (last && last.charIndex + last.charCount === i) last.charCount += 1;
		else runs.push({ pageIndex, charIndex: i, charCount: 1 });
	});
	if (!runs.length) return null;
	const text = (await engine.getTextSlices(doc, runs).toPromise()).join(' ').replace(/\s+/g, ' ').trim();
	return text ? text.slice(0, QUOTE_MAX) : null;
}

/** A region of a page as a JPEG, its longest side CROP_SIZE pixels at most (null: none). */
export async function cropOf(engine: PageEngine, doc: PageDoc, pageIndex: number, rect: Box) {
	const page = doc.pages[pageIndex];
	if (!page || rect.size.width <= 0 || rect.size.height <= 0) return null;
	const scaleFactor = Math.min(4, CROP_SIZE / Math.max(rect.size.width, rect.size.height));
	try {
		return await engine
			.renderPageRect(doc, page, rect, { scaleFactor, imageType: 'image/jpeg', imageQuality: 0.85 })
			.toPromise();
	} catch {
		return null;
	}
}

/** The smallest box around both. */
const union = (a: Box, b: Box): Box => {
	const x = Math.min(a.origin.x, b.origin.x);
	const y = Math.min(a.origin.y, b.origin.y);
	const right = Math.max(a.origin.x + a.size.width, b.origin.x + b.size.width);
	const bottom = Math.max(a.origin.y + a.size.height, b.origin.y + b.size.height);
	return { origin: { x, y }, size: { width: right - x, height: bottom - y } };
};

/** A highlight's rectangles: one per line, around the glyphs whose centres fall in `area`
 * (in reading order: lines top to bottom). Empty: no text there. */
export function lineRects(glyphs: (Partial<Box> | undefined)[], area: Box): Box[] {
	const lines: Box[] = [];
	for (const g of glyphs) {
		const { origin, size } = g ?? {}; // the engine leaves holes (spaces, line ends)
		if (!origin || !size || size.width <= 0 || size.height <= 0) continue; // spaces, line ends: no box
		const centre = { x: origin.x + size.width / 2, y: origin.y + size.height / 2 };
		if (!inside(centre, area)) continue;
		const line = lines.findIndex(
			(l) => centre.y >= l.origin.y && centre.y <= l.origin.y + l.size.height // same line: overlapping heights
		);
		const box = { origin, size };
		if (line < 0) lines.push(box);
		else lines[line] = union(lines[line], box);
	}
	return lines.sort((a, b) => a.origin.y - b.origin.y);
}

/** The bounding box of rectangles (they are never empty here). */
export const around = (rects: Box[]) => rects.reduce(union);

/** The text's line rectangles in `area` of a page (the highlight tool). */
export async function textRects(engine: PageEngine, doc: PageDoc, pageIndex: number, area: Box) {
	const page = doc.pages[pageIndex];
	if (!page) return [];
	return lineRects(await engine.getPageGlyphs(doc, page).toPromise(), area);
}
