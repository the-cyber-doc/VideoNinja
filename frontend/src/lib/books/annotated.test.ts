// The downloaded copy's annotations: each row's own, its comments as replies.
import { describe, expect, it } from 'vitest';
import type { BookAnnotation, BookComment } from '../api/types';
import { annotatedName, annotatedObjects, TEXT } from './annotated';

const RECT = { origin: { x: 10, y: 20 }, size: { width: 100, height: 30 } };
const target = { type: 9, id: 'h1', pageIndex: 2, rect: RECT, color: '#FFCD45', author: 'aiko' };
const row = (more: Partial<BookAnnotation> = {}): BookAnnotation => ({
	id: 5,
	page: 3,
	kind: 'text',
	target: JSON.stringify(target),
	quote: 'Togakure-ryū',
	color: '#FFCD45',
	note: 'The first school',
	technique: 'togakure.taijutsu.x.koto',
	has_image: false,
	created_by: 'Aiko',
	created_at: '2026-11-01T10:00:00+01:00',
	modified_at: '2026-11-03T10:00:00+01:00',
	mine: true,
	...more
});
const comment = (id: number, annotation: number, user: string | null): BookComment => ({
	id,
	annotation,
	user,
	created_at: '2026-11-02T10:00:00+01:00',
	modified_at: '2026-11-02T11:00:00+01:00',
	lang: 'en',
	text: `Comment ${id}`,
	mine: false
});
const WORDS = {
	technique: (id: string) => (id.endsWith('koto') ? 'Technique: 虎倒 Kotō — https://x/k' : null),
	unknownAuthor: '?'
};

describe('annotatedObjects', () => {
	it('the annotation: its author, dates, technique and note; its comments as replies, in order', () => {
		const objects = annotatedObjects([row()], [comment(1, 5, 'Ren'), comment(2, 9, 'Mei'), comment(3, 5, null)], WORDS);
		expect(objects[0]).toEqual({
			...target,
			author: 'Aiko',
			created: new Date('2026-11-01T10:00:00+01:00'),
			modified: new Date('2026-11-03T10:00:00+01:00'),
			contents: 'Technique: 虎倒 Kotō — https://x/k\n\nThe first school'
		});
		expect(objects.slice(1)).toEqual([
			{
				type: TEXT,
				id: 'comment-1',
				pageIndex: 2,
				rect: { origin: RECT.origin, size: { width: 20, height: 20 } },
				contents: 'Comment 1',
				author: 'Ren',
				created: new Date('2026-11-02T10:00:00+01:00'),
				modified: new Date('2026-11-02T11:00:00+01:00'),
				inReplyToId: 'h1'
			},
			expect.objectContaining({ id: 'comment-3', author: '?', inReplyToId: 'h1' })
		]);
	});

	it('nothing to say: no contents; an unknown author, an unknown technique', () => {
		const [plain] = annotatedObjects([row({ note: null, technique: null, created_by: null })], [], WORDS);
		expect([plain.author, 'contents' in plain]).toEqual(['?', false]);
		const [unknown] = annotatedObjects([row({ technique: 'gone', note: null })], [], WORDS);
		expect('contents' in unknown).toBe(false);
	});
});

describe('annotatedName', () => {
	it('the original name, annotated on that day', () => {
		expect(annotatedName('Densho.PDF', '2026-11-04')).toBe('Densho (annotated 2026-11-04).pdf');
		expect(annotatedName('scan', '2026-11-04')).toBe('scan (annotated 2026-11-04).pdf');
	});
});
