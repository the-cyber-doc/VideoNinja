// A book's annotations kept in step with the viewer's plugin: its committed changes saved,
// one chain per annotation; quotes, crops and uploads faked.
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { BookAnnotation } from '../api/types';
import {
	BookAnnotations,
	HIGHLIGHT,
	QUOTE_MAX,
	revive,
	SQUARE,
	uidOf,
	type AnnotationDeps,
	type PdfAnnotation
} from './annotations.svelte';

const RECT = { origin: { x: 10, y: 20 }, size: { width: 100, height: 30 } };
const highlight = (id = 'h1', more: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
	id,
	type: HIGHLIGHT,
	pageIndex: 2,
	rect: RECT,
	segmentRects: [RECT],
	color: '#FFCD45',
	custom: { text: ' Togakure-ryū\n' },
	...more
});
const region = (id = 'r1', more: Partial<PdfAnnotation> = {}): PdfAnnotation => ({
	id,
	type: SQUARE,
	pageIndex: 0,
	rect: RECT,
	strokeColor: '#E11D48',
	...more
});
const row = (id: number, a: PdfAnnotation, more: Partial<BookAnnotation> = {}): BookAnnotation => ({
	id,
	page: a.pageIndex + 1,
	kind: a.type === SQUARE ? 'region' : 'text',
	target: JSON.stringify(a),
	quote: null,
	color: null,
	note: null,
	technique: null,
	has_image: false,
	created_by: 'Aiko',
	created_at: '2026-11-01T10:00:00+01:00',
	modified_at: '2026-11-01T10:00:00+01:00',
	mine: true,
	...more
});
const committed = (type: 'create' | 'update' | 'delete', annotation: PdfAnnotation) => ({
	type,
	annotation,
	committed: true
});

function fakes(over: Partial<AnnotationDeps> = {}) {
	let next = 10;
	const deps: AnnotationDeps = {
		create: vi.fn(async (_book, body) => row(++next, JSON.parse(body.target), { quote: body.quote ?? null })),
		change: vi.fn(async (id, body) => row(id, JSON.parse(body.target ?? JSON.stringify(highlight())), body as never)),
		remove: vi.fn(async () => undefined),
		attachImage: vi.fn(async () => undefined),
		crop: vi.fn(async () => new Blob(['jpeg'])),
		upload: vi.fn(async () => 'tus-1'),
		...over
	};
	return deps;
}

describe('saved annotations', () => {
	it('given to the plugin with their dates back as dates; known by their PDF annotation', () => {
		const a = highlight('h1', { created: '2026-11-01T09:00:00.000Z' as never, modified: new Date(0) });
		const annotations = new BookAnnotations(7, [row(5, a)], fakes());
		const [item] = annotations.items();
		expect(item.annotation.created).toEqual(new Date('2026-11-01T09:00:00.000Z'));
		expect(item.annotation.modified).toEqual(new Date(0));
		expect(uidOf(annotations.rows[0])).toBe('h1');
		expect(revive(JSON.stringify(highlight())).created).toBeUndefined();
	});

	it('the plugin creating them again (its import) saves nothing', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [row(5, highlight())], deps);
		annotations.handle(committed('create', highlight()));
		annotations.handle({ type: 'loaded' });
		annotations.handle({ type: 'update', annotation: highlight(), committed: false }); // a preview
		annotations.handle(committed('update', highlight('other'))); // the PDF's own
		annotations.handle(committed('delete', highlight('other')));
		await annotations.settled();
		expect(
			[deps.create, deps.change, deps.remove].map((f) => (f as ReturnType<typeof vi.fn>).mock.calls.length)
		).toEqual([0, 0, 0]);
	});
});

describe('new annotations', () => {
	it('a highlight: its page, its quote (the text the tool selected), its colour; selected', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [], deps);
		annotations.handle(committed('create', highlight()));
		expect([annotations.pending, annotations.selectedUid]).toEqual([1, 'h1']);
		await annotations.settled();
		expect(deps.create).toHaveBeenCalledWith(7, {
			page: 3,
			kind: 'text',
			target: JSON.stringify(highlight()),
			color: '#FFCD45',
			quote: 'Togakure-ryū'
		});
		expect([annotations.rows.length, annotations.pending, annotations.selected?.id]).toEqual([1, 0, 11]);
	});

	it('a region: its crop uploaded and attached; no quote', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [], deps);
		annotations.handle(committed('create', region()));
		await annotations.settled();
		expect(deps.create).toHaveBeenCalledWith(7, expect.objectContaining({ kind: 'region', color: '#E11D48' }));
		expect(deps.upload).toHaveBeenCalled();
		expect(deps.attachImage).toHaveBeenCalledWith(11, 'tus-1');
	});

	it('no quote found, no colour of ours, no crop rendered: saved without them', async () => {
		const deps = fakes({ crop: async () => null });
		const annotations = new BookAnnotations(7, [], deps);
		annotations.handle(committed('create', highlight('h1', { color: 'yellow', custom: { text: '  ' } })));
		annotations.handle(committed('create', region('r1', { strokeColor: undefined })));
		await annotations.settled();
		const bodies = (deps.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
		expect(bodies.map((b) => [b.quote, b.color])).toEqual([
			[undefined, undefined],
			[undefined, undefined]
		]);
		expect(deps.attachImage).not.toHaveBeenCalled();
	});

	it('refused: the error said; its later changes and deletion do nothing', async () => {
		const refused = new ApiError(404, 'book.unknown');
		const deps = fakes({ create: async () => Promise.reject(refused) });
		const annotations = new BookAnnotations(7, [], deps);
		annotations.handle(committed('create', highlight()));
		annotations.handle(committed('update', highlight('h1', { rect: { ...RECT, origin: { x: 0, y: 0 } } })));
		annotations.handle(committed('delete', highlight()));
		await annotations.settled();
		expect(annotations.error).toBe(refused);
		expect(deps.change).not.toHaveBeenCalled();
		expect(deps.remove).not.toHaveBeenCalled();
	});
});

describe('changes', () => {
	it('moved: its new place and page; a colour of ours kept, another not', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [row(5, highlight())], deps);
		const moved = highlight('h1', { pageIndex: 3, rect: { ...RECT, origin: { x: 5, y: 5 } }, color: '#60A5FA' });
		annotations.handle(committed('update', moved));
		await annotations.settled();
		expect(deps.change).toHaveBeenCalledWith(5, {
			target: JSON.stringify(moved),
			page: 4,
			color: '#60A5FA'
		});
		annotations.handle(committed('update', highlight('h1', { pageIndex: 3, rect: moved.rect, color: 'red' })));
		await annotations.settled();
		const last = (deps.change as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
		expect(last.color).toBeUndefined();
	});

	it('a region moved: a new crop; recoloured only: none', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [row(6, region())], deps);
		annotations.handle(committed('update', region('r1', { strokeColor: '#4ADE80' })));
		await annotations.settled();
		expect(deps.attachImage).not.toHaveBeenCalled();
		annotations.handle(committed('update', region('r1', { rect: { ...RECT, size: { width: 50, height: 30 } } })));
		await annotations.settled();
		expect(deps.attachImage).toHaveBeenCalledWith(6, 'tus-1');
		expect((deps.change as ReturnType<typeof vi.fn>).mock.calls[1][1]).not.toHaveProperty('quote');
	});

	it('a long quote kept to the server’s limit; no text selected: none', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [], deps);
		annotations.handle(committed('create', highlight('h1', { custom: { text: 'x'.repeat(QUOTE_MAX + 9) } })));
		annotations.handle(committed('create', highlight('h2', { custom: undefined })));
		await annotations.settled();
		const bodies = (deps.create as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1]);
		expect([bodies[0].quote.length, bodies[1].quote]).toEqual([QUOTE_MAX, undefined]);
	});

	it('deleted: the row goes, the selection too', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [row(5, highlight()), row(6, region())], deps);
		annotations.selectedUid = 'h1';
		annotations.handle(committed('delete', highlight()));
		await annotations.settled();
		expect(deps.remove).toHaveBeenCalledWith(5);
		expect([annotations.rows.map((r) => r.id), annotations.selectedUid]).toEqual([[6], null]);
		annotations.selectedUid = 'elsewhere';
		annotations.handle(committed('delete', region()));
		await annotations.settled();
		expect([annotations.rows, annotations.selectedUid, annotations.selected]).toEqual([[], 'elsewhere', null]);
	});

	it('the panel’s note and technique; a failure said', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [row(5, highlight())], deps);
		await annotations.edit(annotations.rows[0], { note: 'Key point', technique: null });
		expect(deps.change).toHaveBeenCalledWith(5, { note: 'Key point', technique: null });
		const failure = new ApiError(403, 'book_annotation.not_author');
		(deps.change as ReturnType<typeof vi.fn>).mockRejectedValueOnce(failure);
		await annotations.edit(annotations.rows[0], { note: 'x' });
		expect(annotations.error).toBe(failure);
	});

	it('a row the server no longer lists: its update does nothing', async () => {
		const deps = fakes();
		const annotations = new BookAnnotations(7, [row(5, highlight())], deps);
		annotations.rows = [];
		annotations.handle(committed('update', highlight()));
		await annotations.settled();
		expect(deps.change).not.toHaveBeenCalled();
	});
});
