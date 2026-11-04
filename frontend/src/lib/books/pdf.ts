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

/** A crop's longest side in pixels. */
export const CROP_SIZE = 1200;

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
