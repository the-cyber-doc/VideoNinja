// One book's page: its PDF downloaded with progress, a missing first page made once, its
// reference edited; the API and uploads faked.
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { BookRow } from '../api/types';
import { BookPage, DEPS, downloadPdf, saveFile, type BookPageDeps } from './book.svelte';
import type { ViewerControls } from './ViewerPages.svelte';

const WORDS = { technique: () => 'Technique: x', unknownAuthor: 'a deleted user' };

const BOOK: BookRow = {
	id: 7,
	original_filename: 'densho.pdf',
	status: 'published',
	error: null,
	pages: 3,
	reference: { type: 'book', title: 'Ninjutsu', author: [{ family: 'Hatsumi', given: 'Masaaki' }] },
	uploaded_at: '2026-10-23T12:13:38+02:00',
	uploaded_by: 'Aiko',
	has_thumbnail: true,
	has_text: true,
	tags: [
		{ id: 'year', value: '1981' },
		{ id: 'scan', value: null }
	]
};

/** A response streaming these chunks, with or without its length. */
function streamed(chunks: number[][], length = true, status = 200) {
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const c of chunks) controller.enqueue(new Uint8Array(c));
			controller.close();
		}
	});
	const size = chunks.reduce((n, c) => n + c.length, 0);
	return new Response(status === 200 ? body : null, {
		status,
		headers: length ? { 'Content-Length': String(size), 'X-Request-ID': 'rid' } : {}
	});
}

function fakes(over: Partial<BookPageDeps> = {}): BookPageDeps {
	return {
		fetch: vi.fn(async () => streamed([[1, 2], [3]])),
		save: vi.fn(),
		editBook: vi.fn(async (_id, body) => ({ ...BOOK, reference: body.reference, tags: body.tags })) as never,
		replaceThumbnail: vi.fn(async () => undefined),
		sendText: vi.fn(async () => undefined),
		uploadPicture: vi.fn(async () => 'tus-9'),
		annotations: {
			create: vi.fn(),
			change: vi.fn(),
			remove: vi.fn(),
			attachImage: vi.fn()
		},
		...over
	};
}

const controls = (over: Partial<ViewerControls> = {}): ViewerControls => ({
	select: vi.fn(),
	remove: vi.fn(),
	recolor: vi.fn(),
	crop: vi.fn(async () => new Blob(['crop'])),
	firstPage: vi.fn(async () => new Blob(['jpeg'])),
	pageTexts: vi.fn(async () => ['Page one', '']),
	showPage: vi.fn(),
	annotatedCopy: vi.fn(async () => new TextEncoder().encode('%PDF copy').buffer),
	reselect: vi.fn(async () => true),
	cancelReselect: vi.fn(),
	...over
});

describe('downloadPdf', () => {
	it('the bytes, the progress as they come', async () => {
		const progress: (number | null)[] = [];
		const bytes = await downloadPdf(
			'/media/book/7',
			(f) => progress.push(f),
			async () =>
				streamed([
					[1, 2],
					[3, 4]
				])
		);
		expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3, 4]);
		expect(progress).toEqual([0.5, 1]);
	});

	it('no length said: progress unknown; refused: the error', async () => {
		const progress: (number | null)[] = [];
		await downloadPdf(
			'/x',
			(f) => progress.push(f),
			async () => streamed([[1]], false)
		);
		expect(progress).toEqual([null]);
		const e = await downloadPdf(
			'/x',
			() => {},
			async () => streamed([], true, 403)
		).catch((e) => e);
		expect([e instanceof ApiError, e.status, e.requestId]).toEqual([true, 403, 'rid']);
	});
});

describe('BookPage', () => {
	it('loads its PDF; a failure kept for the page', async () => {
		const page = new BookPage(BOOK, [], fakes());
		await page.load();
		expect([page.pdf?.byteLength, page.progress, page.error]).toEqual([3, 1, null]);
		const failing = new BookPage(BOOK, [], fakes({ fetch: async () => streamed([], true, 404) }));
		await failing.load();
		expect((failing.error as ApiError).status).toBe(404);
	});

	it('its annotations crop and upload through the viewer once ready', async () => {
		const deps = fakes();
		const page = new BookPage(BOOK, [], deps);
		const annotationDeps = (page.annotations as unknown as { deps: Record<string, (...a: unknown[]) => unknown> }).deps;
		expect(await annotationDeps.crop(0, {})).toBeNull(); // no viewer yet
		await page.ready(controls());
		expect(await annotationDeps.crop(0, {})).toEqual(new Blob(['crop']));
		await annotationDeps.upload(new Blob(['x']));
		expect(deps.uploadPicture).toHaveBeenCalledWith(new Blob(['x']), 'annotation-7.jpg');
		await page.ready(controls({ crop: async () => null })); // ready again: the latest helpers
		expect(await annotationDeps.crop(0, {})).toBeNull();
		expect(deps.replaceThumbnail).not.toHaveBeenCalled(); // it has its first page
	});

	it('opened on an annotation (from a technique’s page): shown once the viewer is ready, once', async () => {
		const row = { id: 5, page: 2 } as never;
		const page = new BookPage(BOOK, [], fakes(), 5);
		page.annotations.rows = [row];
		const viewer = controls();
		await page.ready(viewer);
		await page.ready(viewer);
		expect(viewer.select).toHaveBeenCalledTimes(1);
		expect(viewer.select).toHaveBeenCalledWith(row);
	});

	it('no first page: made from the viewer, once per visit', async () => {
		const deps = fakes();
		const page = new BookPage({ ...BOOK, has_thumbnail: false }, [], deps);
		await page.ready(controls());
		await page.ready(controls());
		expect(deps.uploadPicture).toHaveBeenCalledTimes(1);
		expect(deps.replaceThumbnail).toHaveBeenCalledWith(7, 'tus-9');
		expect(page.book.has_thumbnail).toBe(true);
	});

	it('no text yet: read from the viewer and sent, once per visit; a failure silently', async () => {
		const deps = fakes();
		const page = new BookPage({ ...BOOK, has_text: false }, [], deps);
		await page.ready(controls());
		await page.ready(controls());
		expect(deps.sendText).toHaveBeenCalledTimes(1);
		expect(deps.sendText).toHaveBeenCalledWith(7, ['Page one', '']);
		expect(page.book.has_text).toBe(true);
		const refused = fakes({ sendText: async () => Promise.reject(new Error('down')) });
		const again = new BookPage({ ...BOOK, has_text: false }, [], refused);
		await again.ready(controls());
		expect([again.book.has_text, again.error]).toEqual([false, null]);
		await new BookPage(BOOK, [], deps).ready(controls()); // has text: not sent
		expect(deps.sendText).toHaveBeenCalledTimes(1);
	});

	it('?page=: that page shown, once; an annotation asked for comes first', async () => {
		const viewer = controls();
		const page = new BookPage(BOOK, [], fakes(), null, 4);
		await page.ready(viewer);
		await page.ready(viewer);
		expect(viewer.showPage).toHaveBeenCalledTimes(1);
		expect(viewer.showPage).toHaveBeenCalledWith(4);
	});

	it('the first page not rendered, or refused: tried again next visit, silently', async () => {
		const none = fakes();
		await new BookPage({ ...BOOK, has_thumbnail: false }, [], none).ready(controls({ firstPage: async () => null }));
		expect(none.uploadPicture).not.toHaveBeenCalled();
		const refused = fakes({ replaceThumbnail: async () => Promise.reject(new Error('down')) });
		const page = new BookPage({ ...BOOK, has_thumbnail: false }, [], refused);
		await page.ready(controls());
		expect([page.book.has_thumbnail, page.error]).toEqual([false, null]);
	});

	it('the reference edited: as a draft, its tags too, saved', async () => {
		const deps = fakes();
		const page = new BookPage(BOOK, [], deps);
		await page.save(); // not editing
		expect(page.problems).toEqual({}); // no draft yet
		page.edit();
		expect(page.draft.fields.title).toBe('Ninjutsu');
		expect(page.tags).toEqual([{ id: 'year', value: '1981' }, { id: 'scan' }]);
		page.draft.fields.title = '';
		await page.save(); // a title is needed
		expect(deps.editBook).not.toHaveBeenCalled();
		page.draft.fields.title = 'Ninjutsu, revised';
		await page.save();
		expect(deps.editBook).toHaveBeenCalledWith(7, {
			reference: expect.objectContaining({ title: 'Ninjutsu, revised' }),
			tags: [{ id: 'year', value: '1981' }, { id: 'scan' }]
		});
		expect([page.editing, page.saved, page.saving, page.book.reference.title]).toEqual([
			false,
			true,
			false,
			'Ninjutsu, revised'
		]);
	});

	it('a refused edit: the error, still editing', async () => {
		const refused = new ApiError(422, 'tag.unknown');
		const page = new BookPage(BOOK, [], fakes({ editBook: async () => Promise.reject(refused) }));
		page.edit();
		await page.save();
		expect([page.error, page.editing, page.saving]).toEqual([refused, true, false]);
	});

	it('downloads a copy with its annotations', async () => {
		const deps = fakes();
		const page = new BookPage(BOOK, [], deps);
		await page.download(WORDS, '2026-11-04'); // no PDF, no viewer yet: nothing
		expect(deps.save).not.toHaveBeenCalled();
		await page.load();
		const viewer = controls();
		await page.ready(viewer);
		await page.download(WORDS, '2026-11-04');
		expect(viewer.annotatedCopy).toHaveBeenCalledWith(page.pdf, []);
		const [file, name] = (deps.save as ReturnType<typeof vi.fn>).mock.calls[0];
		expect([file.type, await file.text(), name]).toEqual([
			'application/pdf',
			'%PDF copy',
			'densho (annotated 2026-11-04).pdf'
		]);
		expect(page.downloading).toBe(false);
	});

	it('a failed download: the error said', async () => {
		const failure = new Error('engine');
		const page = new BookPage(BOOK, [], fakes());
		await page.load();
		await page.ready(controls({ annotatedCopy: async () => Promise.reject(failure) }));
		await page.download(WORDS, '2026-11-04');
		expect([page.error, page.downloading]).toEqual([failure, false]);
	});

	it('the real dependencies', async () => {
		const real = vi.fn(async () => new Response('ok'));
		vi.stubGlobal('fetch', real);
		await DEPS.fetch('/media/book/7');
		expect(real).toHaveBeenCalledWith('/media/book/7');
		real.mockResolvedValueOnce(new Response(null, { status: 204 }));
		await DEPS.sendText(7, []);
		expect(real).toHaveBeenLastCalledWith('/api/books/7/text', expect.objectContaining({ method: 'PUT' }));
		vi.unstubAllGlobals();
		expect(new BookPage(BOOK, []).annotations.bookId).toBe(7);
	});
});

describe('saveFile', () => {
	it('a link the browser follows, its URL let go later', () => {
		vi.useFakeTimers();
		const link = { href: '', download: '', click: vi.fn() };
		vi.stubGlobal('document', { createElement: () => link });
		const revoke = vi.spyOn(URL, 'revokeObjectURL');
		saveFile(new Blob(['x']), 'copy.pdf');
		expect([link.href.startsWith('blob:'), link.download, link.click.mock.calls.length]).toEqual([true, 'copy.pdf', 1]);
		vi.advanceTimersByTime(60_000);
		expect(revoke).toHaveBeenCalledWith(link.href);
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
});
