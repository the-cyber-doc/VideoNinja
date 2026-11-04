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

const { annotatedCopy, cropOf, CROP_SIZE, readPdf, THUMBNAIL_WIDTH } = await import('./pdf');

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
const DOC = { pages: [{ index: 0, size: { width: 400, height: 600 } }] };

function pageEngine() {
	return {
		renderPageRect: vi.fn<
			(doc: unknown, page: unknown, rect: unknown, options: object) => ReturnType<typeof task<Blob>>
		>(() => task(new Blob(['crop'])))
	};
}

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

describe('annotatedCopy', () => {
	it('a fresh document from the bytes, the annotations in order, saved, closed', async () => {
		const doc = { pages: [{ index: 0, size: { width: 1, height: 1 } }] };
		const created: object[] = [];
		const engine = {
			openDocumentBuffer: vi.fn<(file: { content: ArrayBuffer }) => ReturnType<typeof task<typeof doc>>>(() =>
				task(doc)
			),
			createPageAnnotation: vi.fn((_d: unknown, _p: unknown, a: object) => (created.push(a), task('id'))),
			saveAsCopy: vi.fn(() => task(new ArrayBuffer(3))),
			closeDocument: vi.fn(() => task(true))
		};
		const pdf = new ArrayBuffer(8);
		const copy = await annotatedCopy(engine, pdf, [{ pageIndex: 0 }, { pageIndex: 4 }, { pageIndex: 0 }]);
		expect(copy.byteLength).toBe(3);
		expect(engine.openDocumentBuffer.mock.calls[0][0]).toMatchObject({ content: expect.any(ArrayBuffer) });
		expect(created).toEqual([{ pageIndex: 0 }, { pageIndex: 0 }]); // no page 5: skipped
		expect(engine.closeDocument).toHaveBeenCalledWith(doc);
		expect(pdf.byteLength).toBe(8); // the original kept
	});

	it('closed even when saving fails', async () => {
		const doc = { pages: [] };
		const engine = {
			openDocumentBuffer: () => task(doc),
			createPageAnnotation: () => task('id'),
			saveAsCopy: () => failing(),
			closeDocument: vi.fn(() => task(true))
		};
		await expect(annotatedCopy(engine as never, new ArrayBuffer(1), [])).rejects.toThrow('broken');
		expect(engine.closeDocument).toHaveBeenCalled();
	});
});
