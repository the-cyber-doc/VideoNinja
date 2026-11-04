// What the browser reads from a PDF, with EmbedPDF's engine faked (the real one, its
// WebAssembly, runs in the browser tests: tests/mocked/books.spec.ts).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const task = <T>(value: T) => ({ toPromise: () => Promise.resolve(value) });
const failing = () => ({ toPromise: () => Promise.reject(new Error('broken')) });

const engine = {
	openDocumentBuffer: vi.fn(),
	getMetadata: vi.fn(),
	renderPage: vi.fn(),
	closeDocument: vi.fn(() => task(true)),
	destroy: vi.fn(() => task(true))
};
const createPdfiumEngine = vi.fn<(url: string, options: object) => Promise<typeof engine>>(async () => engine);
vi.mock('@embedpdf/engines/pdfium-direct-engine', () => ({ createPdfiumEngine }));
vi.mock('@embedpdf/pdfium/pdfium.wasm?url', () => ({ default: '/pdfium.wasm' }));

const { around, cropOf, CROP_SIZE, lineRects, quoteOf, QUOTE_MAX, readPdf, textRects, THUMBNAIL_WIDTH } =
	await import('./pdf');

const PAGE = { index: 0, size: { width: 595, height: 842 } };
const file = new Blob(['%PDF-1.4']);

beforeEach(() => {
	vi.clearAllMocks();
	engine.openDocumentBuffer.mockReturnValue(task({ id: 'upload', pageCount: 3, pages: [PAGE] }));
	engine.getMetadata.mockReturnValue(task({ title: '  Ninjutsu  ', author: '' }));
	engine.renderPage.mockReturnValue(task(new Blob(['jpeg'], { type: 'image/jpeg' })));
});

describe('readPdf', () => {
	it('pages, metadata, the first page as a JPEG; no font from elsewhere; the engine closed', async () => {
		const facts = await readPdf(file);
		expect(facts).toEqual({ pages: 3, title: 'Ninjutsu', author: null, thumbnail: expect.any(Blob) });
		expect(createPdfiumEngine).toHaveBeenCalledWith('/pdfium.wasm', { fontFallback: null });
		expect(engine.renderPage).toHaveBeenCalledWith(expect.anything(), PAGE, {
			scaleFactor: THUMBNAIL_WIDTH / 595,
			imageType: 'image/jpeg',
			imageQuality: 0.85
		});
		expect(engine.closeDocument).toHaveBeenCalled();
		expect(engine.destroy).toHaveBeenCalled();
	});

	it('no metadata, no picture: the book goes anyway', async () => {
		engine.getMetadata.mockReturnValue(failing());
		engine.renderPage.mockReturnValue(failing());
		expect(await readPdf(file)).toEqual({ pages: 3, title: null, author: null, thumbnail: null });
	});

	it('no page at all', async () => {
		engine.openDocumentBuffer.mockReturnValue(task({ id: 'upload', pageCount: 0, pages: [] }));
		engine.getMetadata.mockReturnValue(task({ title: null, author: 'Hatsumi' }));
		expect(await readPdf(file)).toEqual({ pages: 0, title: null, author: 'Hatsumi', thumbnail: null });
		expect(engine.renderPage).not.toHaveBeenCalled();
	});

	it('not a PDF: the error, the engine destroyed', async () => {
		engine.openDocumentBuffer.mockReturnValue(failing());
		await expect(readPdf(file)).rejects.toThrow('broken');
		expect(engine.destroy).toHaveBeenCalled();
	});
});

// --- the viewer's engine ---

const box = (x: number, y: number, width: number, height: number) => ({ origin: { x, y }, size: { width, height } });
// Two lines: "Ab" at y 10-30, a hole (a space), "Cd" at y 40-60.
const GLYPHS = [
	box(10, 10, 10, 20),
	box(20, 10, 10, 20),
	undefined,
	box(10, 40, 10, 20),
	box(20, 40, 10, 20),
	box(30, 40, 0, 20)
];
const DOC = { pages: [{ index: 0, size: { width: 400, height: 600 } }] };

function pageEngine(texts = ['Ab', 'Cd']) {
	return {
		getPageGlyphs: vi.fn(() => task(GLYPHS)),
		getTextSlices: vi.fn(() => task(texts)),
		renderPageRect: vi.fn(() => task(new Blob(['crop'])))
	};
}

describe('the text under a box', () => {
	it('one rectangle per line, top to bottom, around the characters inside', () => {
		expect(lineRects(GLYPHS, box(0, 0, 100, 100))).toEqual([box(10, 10, 20, 20), box(10, 40, 20, 20)]);
		expect(lineRects(GLYPHS, box(0, 35, 100, 30))).toEqual([box(10, 40, 20, 20)]);
		expect(lineRects([...GLYPHS].reverse(), box(0, 0, 100, 100))[0]).toEqual(box(10, 10, 20, 20)); // sorted
		expect(lineRects(GLYPHS, box(200, 200, 10, 10))).toEqual([]);
		expect(around([box(10, 10, 20, 20), box(10, 40, 20, 20)])).toEqual(box(10, 10, 20, 50));
	});

	it('the quote: the runs of characters inside, as one line of text', async () => {
		const engine = pageEngine([' Ab ', 'Cd\n']);
		expect(await quoteOf(engine, DOC, 0, [box(0, 0, 100, 100)])).toBe('Ab Cd');
		expect(engine.getTextSlices).toHaveBeenCalledWith(DOC, [
			{ pageIndex: 0, charIndex: 0, charCount: 2 },
			{ pageIndex: 0, charIndex: 3, charCount: 3 }
		]);
		expect(await quoteOf(engine, DOC, 0, [box(200, 200, 1, 1)])).toBeNull(); // nothing there
		expect(await quoteOf(engine, DOC, 5, [box(0, 0, 1, 1)])).toBeNull(); // no such page
		expect(await quoteOf(pageEngine(['  ']), DOC, 0, [box(0, 0, 100, 100)])).toBeNull(); // only blanks
		const long = await quoteOf(pageEngine(['x'.repeat(QUOTE_MAX + 5)]), DOC, 0, [box(0, 0, 100, 100)]);
		expect(long).toHaveLength(QUOTE_MAX);
	});

	it('the line rectangles of a page', async () => {
		expect(await textRects(pageEngine(), DOC, 0, box(0, 0, 100, 35))).toEqual([box(10, 10, 20, 20)]);
		expect(await textRects(pageEngine(), DOC, 3, box(0, 0, 100, 35))).toEqual([]);
	});
});

describe('a region as a picture', () => {
	it('a JPEG, its longest side CROP_SIZE pixels at most', async () => {
		const engine = pageEngine();
		expect(await cropOf(engine, DOC, 0, box(0, 0, 300, 100))).toEqual(new Blob(['crop']));
		expect(engine.renderPageRect).toHaveBeenCalledWith(DOC, DOC.pages[0], box(0, 0, 300, 100), {
			scaleFactor: CROP_SIZE / 300,
			imageType: 'image/jpeg',
			imageQuality: 0.85
		});
		await cropOf(engine, DOC, 0, box(0, 0, 10, 10));
		expect(engine.renderPageRect.mock.calls[1][3]).toMatchObject({ scaleFactor: 4 }); // small: 4× at most
	});

	it('nothing to render, or not rendered: none', async () => {
		expect(await cropOf(pageEngine(), DOC, 2, box(0, 0, 10, 10))).toBeNull();
		expect(await cropOf(pageEngine(), DOC, 0, box(0, 0, 0, 10))).toBeNull();
		const broken = { ...pageEngine(), renderPageRect: () => failing() };
		expect(await cropOf(broken as never, DOC, 0, box(0, 0, 10, 10))).toBeNull();
	});
});
