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

const { readPdf, THUMBNAIL_WIDTH } = await import('./pdf');

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
