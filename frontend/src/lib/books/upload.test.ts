// The book upload's steps, with fakes for hashing, the API, the PDF reader and tus.
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { UploadCallbacks } from '../upload/upload';
import type { PdfFacts } from './pdf';
vi.mock('./pdf', () => ({ readPdf: vi.fn() })); // the engine and its .wasm: pdf.test.ts
const startUpload = vi.fn();
vi.mock('../upload/upload', () => ({ startUpload }));
const { BookUpload, DEPS } = await import('./upload.svelte');
import type { BookUploadDeps } from './upload.svelte';

const PDF = new File(['%PDF-1.4'], 'Densho.PDF', { type: 'application/pdf' });
const THUMB = new Blob(['jpeg'], { type: 'image/jpeg' });
const FACTS: PdfFacts = {
	pages: 120,
	title: 'Ninjutsu',
	author: 'Masaaki Hatsumi',
	thumbnail: THUMB,
	text: ['Page one', '']
};

function fakes(over: Partial<BookUploadDeps> = {}) {
	const uploads: { blob: Blob; meta: object; callbacks: UploadCallbacks; abort: ReturnType<typeof vi.fn> }[] = [];
	const deps: BookUploadDeps = {
		sha256File: async (blob, progress) => {
			progress(1);
			return blob === THUMB ? 'b'.repeat(64) : 'a'.repeat(64);
		},
		bookExists: async () => false,
		readPdf: async () => FACTS,
		submitBook: vi.fn(async () => ({ id: 7 })),
		sendText: vi.fn(async () => {}),
		startUpload: (blob, meta, callbacks) => {
			const abort = vi.fn(async () => {});
			uploads.push({ blob, meta, callbacks, abort });
			queueMicrotask(() => {
				callbacks.onUrl('/files/x');
				callbacks.onProgress(0.5);
				callbacks.onSuccess(`tus-${uploads.length}`);
			});
			return { abort };
		},
		objectUrl: () => 'blob:thumb',
		revokeUrl: vi.fn(),
		...over
	};
	return { deps, uploads };
}

describe('choosing the PDF', () => {
	it('hashed, read: the form prefilled from the PDF, page 1 shown', async () => {
		const flow = new BookUpload(1000, fakes().deps);
		await flow.choose(PDF);
		expect(flow.step).toBe('edit');
		expect(flow.hashProgress).toBe(1);
		expect(flow.pages).toBe(120);
		expect(flow.thumbnailSrc).toBe('blob:thumb');
		expect(flow.draft.fields.title).toBe('Ninjutsu');
		expect(flow.draft.names[0]).toMatchObject({ family: 'Masaaki Hatsumi', literal: true });
		expect(flow.problems).toEqual({});
	});

	it('not a PDF, too large, already on the server, unreadable: said, nothing kept', async () => {
		let flow = new BookUpload(1000, fakes().deps);
		await flow.choose(new File(['x'], 'kata.mp4'));
		expect([flow.step, flow.error]).toEqual(['pick', 'Only PDF files can be uploaded here.']);

		flow = new BookUpload(1, fakes().deps);
		await flow.choose(PDF);
		expect(flow.error).toMatch(/^This file is too large \(at most /);

		flow = new BookUpload(null, fakes({ bookExists: async () => true }).deps);
		await flow.choose(PDF);
		expect([flow.step, flow.error, flow.file]).toEqual(['pick', 'This book is already on the server.', null]);

		flow = new BookUpload(null, fakes({ readPdf: async () => Promise.reject(new Error('bad')) }).deps);
		await flow.choose(PDF);
		expect([flow.step, flow.error]).toEqual(['pick', 'This PDF cannot be read.']);
	});

	it('busy while reading, then while submitting', async () => {
		let read: (f: PdfFacts) => void = () => {};
		let submitted: (v: { id: number }) => void = () => {};
		const flow = new BookUpload(
			null,
			fakes({
				readPdf: () => new Promise((resolve) => (read = resolve)),
				submitBook: () => new Promise((resolve) => (submitted = resolve))
			}).deps
		);
		const choosing = flow.choose(PDF);
		await vi.waitFor(() => expect(flow.step).toBe('reading'));
		expect(flow.busy).toBe(true);
		read(FACTS);
		await choosing;
		expect(flow.busy).toBe(false);
		const proceeding = flow.proceed();
		await vi.waitFor(() => expect(flow.step).toBe('submitting'));
		expect(flow.busy).toBe(true);
		submitted({ id: 1 });
		await proceeding;
	});

	it('a PDF without pages, metadata or picture still goes', async () => {
		const flow = new BookUpload(null, fakes({ readPdf: async () => ({ ...FACTS, pages: 0, thumbnail: null }) }).deps);
		await flow.choose(PDF);
		expect([flow.step, flow.pages, flow.thumbnailSrc]).toEqual(['edit', null, '']);
	});

	it('a hashing failure is shown; a cancelled one is not', async () => {
		let flow = new BookUpload(null, fakes({ sha256File: async () => Promise.reject(new Error('disk')) }).deps);
		await flow.choose(PDF);
		expect([flow.step, (flow.error as Error).message]).toEqual(['pick', 'disk']);

		let release: () => void = () => {};
		const slow = fakes({
			sha256File: (_b, _p, signal) =>
				new Promise((_, reject) => {
					release = () => reject(new Error('aborted'));
					signal.addEventListener('abort', () => release());
				})
		});
		flow = new BookUpload(null, slow.deps);
		const choosing = flow.choose(PDF);
		expect([flow.step, flow.busy]).toEqual(['hashing', true]);
		await flow.cancel();
		await choosing;
		expect([flow.step, flow.error]).toEqual(['pick', null]);
	});
});

describe('uploading', () => {
	it('the PDF, then its first page, then the submit: the book queued', async () => {
		const { deps, uploads } = fakes();
		const flow = new BookUpload(null, deps);
		await flow.choose(PDF);
		flow.tags = [{ id: 'note', value: 'scan' }];
		await flow.proceed();
		expect(uploads.map((u) => u.meta)).toEqual([
			{ sha256: 'a'.repeat(64), originalFilename: 'Densho.PDF', kind: 'book' },
			{ sha256: 'b'.repeat(64), originalFilename: 'Densho.jpg', kind: 'image' }
		]);
		expect(deps.submitBook).toHaveBeenCalledWith({
			upload: 'tus-1',
			thumbnail_upload: 'tus-2',
			original_filename: 'Densho.PDF',
			pages: 120,
			reference: { type: 'book', title: 'Ninjutsu', author: [{ literal: 'Masaaki Hatsumi' }] },
			tags: [{ id: 'note', value: 'scan' }]
		});
		expect([flow.step, flow.submittedId, flow.file]).toEqual(['done', 7, null]);
		expect(deps.sendText).toHaveBeenCalledWith(7, ['Page one', '']); // the search's, in the background
		expect(deps.revokeUrl).toHaveBeenCalledWith('blob:thumb');
	});

	it('without a picture: the PDF only', async () => {
		const { deps, uploads } = fakes({ readPdf: async () => ({ ...FACTS, thumbnail: null }) });
		const flow = new BookUpload(null, deps);
		await flow.choose(PDF);
		await flow.proceed();
		expect(uploads).toHaveLength(1);
		expect(deps.submitBook).toHaveBeenCalledWith(expect.objectContaining({ thumbnail_upload: null }));
	});

	it('not before the form is right, nor twice', async () => {
		const { deps, uploads } = fakes();
		const flow = new BookUpload(null, deps);
		await flow.proceed(); // nothing chosen
		await flow.choose(PDF);
		flow.draft.fields.title = '';
		expect(flow.problems).toEqual({ title: 'books.reference.title_missing' });
		await flow.proceed();
		expect([flow.step, uploads.length]).toEqual(['edit', 0]);
	});

	it('a failed upload or submit: the error, the form kept to try again; a retry said', async () => {
		const error = new ApiError(413, 'upload.too_large');
		const flow = new BookUpload(
			null,
			fakes({
				startUpload: (_b, _m, callbacks) => {
					queueMicrotask(() => {
						callbacks.onRetry();
						expect(flow.retrying).toBe(true);
						callbacks.onError(error);
					});
					return { abort: async () => {} };
				}
			}).deps
		);
		await flow.choose(PDF);
		await flow.proceed();
		expect([flow.step, flow.error, flow.retrying, flow.draft.fields.title]).toEqual(['edit', error, false, 'Ninjutsu']);

		const refused = new ApiError(409, 'book.exists');
		const submitting = new BookUpload(null, fakes({ submitBook: async () => Promise.reject(refused) }).deps);
		await submitting.choose(PDF);
		await submitting.proceed();
		expect([submitting.step, submitting.error]).toEqual(['edit', refused]);
	});

	it('cancelled while uploading: the upload deleted from the server', async () => {
		const { deps, uploads } = fakes({
			startUpload: (blob, meta, callbacks) => {
				const abort = vi.fn(async () => Promise.reject(new Error('offline'))); // ignored
				uploads.push({ blob, meta, callbacks, abort });
				return { abort }; // never finishes
			}
		});
		const flow = new BookUpload(null, deps);
		await flow.choose(PDF);
		void flow.proceed();
		await Promise.resolve();
		expect([flow.step, flow.busy]).toEqual(['uploading', true]);
		await flow.cancel();
		expect(uploads[0].abort).toHaveBeenCalledWith(true);
		expect(flow.step).toBe('pick');
	});
});

describe('the real dependencies', () => {
	it('tus with the kind; object URLs made and revoked', () => {
		const callbacks = {} as UploadCallbacks;
		const meta = { sha256: 'a', originalFilename: 'b.pdf', kind: 'book' as const };
		DEPS.startUpload(PDF, meta, callbacks);
		expect(startUpload).toHaveBeenCalledWith(PDF, meta, callbacks);
		const url = DEPS.objectUrl(THUMB);
		expect(url).toMatch(/^blob:/);
		DEPS.revokeUrl(url);
		expect(new BookUpload(null).maxBytes).toBeNull();
	});

	it('the text sent through the API', async () => {
		const fetch = vi.fn(async () => new Response(null, { status: 204 }));
		vi.stubGlobal('fetch', fetch);
		await DEPS.sendText(7, ['a']);
		expect(fetch).toHaveBeenCalledWith('/api/books/7/text', expect.objectContaining({ method: 'PUT' }));
		vi.unstubAllGlobals();
	});
});
