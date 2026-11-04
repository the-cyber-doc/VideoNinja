import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookRow, Reference, Tag } from '../api/types';
import { dayOf } from '../filters/common';
import {
	activeCount,
	creatorsOf,
	effective,
	emptyFilter,
	filterOptions,
	fold,
	loadFilter,
	matches,
	parseFilter,
	saveFilter,
	sortBooks,
	type BookFilter
} from './filter';

const book = (id: number, reference: Partial<Reference>, more: Partial<BookRow> = {}): BookRow => ({
	id,
	original_filename: `${id}.pdf`,
	status: 'published',
	error: null,
	pages: null,
	reference: { type: 'book', title: `Book ${id}`, ...reference },
	uploaded_at: `2026-10-0${id}T12:00:00+02:00`,
	uploaded_by: 'Aiko',
	has_thumbnail: true,
	tags: [],
	...more
});

const HATSUMI = { family: 'Hatsumi', given: 'Masaaki' };
const HAYES = { family: 'Hayes', given: 'Stephen K.' };
const BOOKS: BookRow[] = [
	// Newest upload first, as the server sends them.
	book(
		4,
		{ title: 'Ninjutsu', author: [HATSUMI], issued: { 'date-parts': [[1981]] }, language: 'en', publisher: 'Unique' },
		{ pages: 200, tags: [{ id: 'year', value: '1981' }] }
	),
	book(
		3,
		{ type: 'manuscript', title: 'Densho', 'original-title': '伝書', editor: [{ literal: 'Bujinkan Dōjō' }] },
		{ uploaded_by: null }
	),
	book(
		2,
		{ title: 'The Ninja', author: [HAYES, HATSUMI], issued: { 'date-parts': [[1975, 3]] }, language: 'ja' },
		{ pages: 120, uploaded_by: 'Ren' }
	),
	book(1, { title: 'anonymous', publisher: 'Kodansha' }, { tags: [{ id: 'scan' }] })
];
const TAGS: Tag[] = [
	{ id: 'scan', name: 'Scan', input_mode: 'text' },
	{ id: 'unused', name: 'Unused', format: 'free', input_mode: 'text' },
	{ id: 'year', name: 'Year', format: 'regexp', input_mode: 'numeric', regexp: '[0-9]{4}' }
];
const options = filterOptions(BOOKS, TAGS);
const keep = (f: Partial<BookFilter>) =>
	BOOKS.filter((b) => matches(b, effective({ ...emptyFilter(), ...f }, options))).map((b) => b.id);

describe('what the pane offers', () => {
	it('the books’ own values: years, days, names by family name, types, languages, publishers, uploaders, tags', () => {
		expect(options.year).toEqual([1975, 1981]);
		expect(options.uploadedAt).toEqual([dayOf(BOOKS[3].uploaded_at), dayOf(BOOKS[0].uploaded_at)]);
		expect(options.authors).toEqual(['Bujinkan Dōjō', 'Masaaki Hatsumi', 'Stephen K. Hayes']);
		expect(options.types).toEqual(['book', 'manuscript']);
		expect(options.languages).toEqual(['en', 'ja']);
		expect(options.publishers).toEqual(['Kodansha', 'Unique']);
		expect(options.uploaders).toEqual(['Aiko', 'Ren', null]);
		expect(options.tags.map((o) => [o.tag.id, o.kind])).toEqual([
			['scan', 'present'],
			['year', 'range']
		]);
	});

	it('none: nothing to choose from', () => {
		expect(filterOptions([], TAGS)).toEqual({
			year: null,
			uploadedAt: null,
			authors: [],
			types: [],
			languages: [],
			publishers: [],
			uploaders: [],
			tags: []
		});
	});
});

describe('which books a filter keeps', () => {
	it('every book without criteria', () => {
		expect(keep({})).toEqual([4, 3, 2, 1]);
	});

	it('text: in titles (original ones too) and names, accents and case ignored', () => {
		expect(keep({ text: ' NINJ ' })).toEqual([4, 2]);
		expect(keep({ text: '伝書' })).toEqual([3]);
		expect(keep({ text: 'dojo' })).toEqual([3]);
		expect(keep({ text: 'hayes' })).toEqual([2]);
		expect(fold('Dōjō')).toBe('dojo');
	});

	it('a year range: books without a date out', () => {
		expect(keep({ year: [1970, 1976] })).toEqual([2]);
		expect(keep({ year: [1975, 1981] })).toEqual([4, 3, 2, 1]); // the whole range: no criterion
	});

	it('names (authors or editors), types, languages, publishers, uploaders: any chosen', () => {
		expect(keep({ authors: ['Masaaki Hatsumi'] })).toEqual([4, 2]);
		expect(keep({ authors: ['Bujinkan Dōjō', 'Stephen K. Hayes'] })).toEqual([3, 2]);
		expect(keep({ types: ['manuscript'] })).toEqual([3]);
		expect(keep({ languages: ['ja'] })).toEqual([2]);
		expect(keep({ publishers: ['Kodansha', 'Unique'] })).toEqual([4, 1]);
		expect(keep({ uploadedBy: [null] })).toEqual([3]);
		expect(keep({ uploadedAt: [dayOf(BOOKS[3].uploaded_at), dayOf(BOOKS[2].uploaded_at)] })).toEqual([2, 1]);
	});

	it('tags, and every criterion at once', () => {
		expect(keep({ tags: { scan: { present: true } } })).toEqual([1]);
		expect(keep({ tags: { year: { range: [1980, 1980] } } })).toEqual([]);
		expect(keep({ authors: ['Masaaki Hatsumi'], languages: ['en'] })).toEqual([4]);
	});

	it('what is no longer offered is dropped; the criteria are counted', () => {
		const f = effective(
			{
				...emptyFilter(),
				authors: ['Nobody'],
				types: ['thesis'],
				languages: ['fr'],
				publishers: ['X'],
				uploadedBy: ['Y']
			},
			options
		);
		expect(f).toEqual({ ...emptyFilter() });
		expect(activeCount(f)).toBe(0);
		const busy = effective(
			{
				...emptyFilter(),
				sort: { key: 'title', dir: 'asc' },
				text: 'x',
				year: [1975, 1976],
				uploadedAt: [0, 1],
				authors: ['Masaaki Hatsumi'],
				types: ['book'],
				tags: { scan: { present: true } }
			},
			options
		);
		expect(activeCount(busy)).toBe(7);
	});

	it('names by family name, then as shown; a name without any part sorts first', () => {
		const books = [
			book(1, { author: [{ family: 'Hatsumi', given: 'Yoshiaki' }] }),
			book(2, { author: [HATSUMI] }),
			book(3, { author: [{}] }),
			book(4, {}),
			book(5, {})
		];
		expect(filterOptions(books, []).authors).toEqual(['', 'Masaaki Hatsumi', 'Yoshiaki Hatsumi']);
		expect(sortBooks(books, { key: 'author', dir: 'asc' }, 'en').map((b) => b.id)).toEqual([2, 1, 3, 4, 5]);
	});

	it('names as the pane lists them', () => {
		expect(creatorsOf(BOOKS[2].reference)).toEqual(['Stephen K. Hayes', 'Masaaki Hatsumi']);
	});
});

describe('order', () => {
	const ids = (key: BookFilter['sort']['key'], dir: 'asc' | 'desc' = 'asc') =>
		sortBooks(BOOKS, { key, dir }, 'en').map((b) => b.id);

	it('upload date, newest first by default', () => {
		expect(ids('uploaded_at', 'desc')).toEqual([4, 3, 2, 1]);
		expect(ids('uploaded_at')).toEqual([1, 2, 3, 4]);
		const same = [
			book(1, {}, { uploaded_at: '2026-10-01T12:00:00Z' }),
			book(2, {}, { uploaded_at: '2026-10-01T12:00:00Z' })
		];
		expect(sortBooks(same, { key: 'uploaded_at', dir: 'desc' }, 'en').map((b) => b.id)).toEqual([2, 1]);
	});

	it('title and author: as the language compares them, case and accents ignored', () => {
		expect(ids('title')).toEqual([1, 3, 4, 2]); // anonymous, Densho, Ninjutsu, The Ninja
		expect(ids('title', 'desc')).toEqual([2, 4, 3, 1]);
		expect(ids('author')).toEqual([3, 4, 2, 1]); // Bujinkan, Hatsumi, Hayes; none last
		expect(ids('author', 'desc')).toEqual([2, 4, 3, 1]);
	});

	it('year and pages: books without one last either way', () => {
		expect(ids('year')).toEqual([2, 4, 3, 1]);
		expect(ids('year', 'desc')).toEqual([4, 2, 3, 1]);
		expect(ids('pages')).toEqual([2, 4, 3, 1]);
		expect(ids('pages', 'desc')).toEqual([4, 2, 3, 1]);
		const untitled = [book(1, { title: '' }), book(2, { title: 'A' }), book(3, { title: '' })];
		expect(sortBooks(untitled, { key: 'title', dir: 'desc' }, 'en').map((b) => b.id)).toEqual([2, 1, 3]);
	});
});

describe('kept on this device', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('saved and loaded; what is not understood is the default', () => {
		const f: BookFilter = {
			...emptyFilter(),
			sort: { key: 'year', dir: 'asc' },
			text: 'ninja',
			year: [1970, 1980],
			uploadedAt: [1, 2],
			authors: ['Masaaki Hatsumi'],
			types: ['book'],
			languages: ['ja'],
			publishers: ['Unique'],
			uploadedBy: [null, 'Aiko'],
			tags: { scan: { present: true } }
		};
		const stored = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => stored.get(k) ?? null,
			setItem: (k: string, v: string) => stored.set(k, v)
		});
		saveFilter(f);
		expect([...stored.keys()]).toEqual(['books.filter']);
		expect(loadFilter()).toEqual(f);
		expect(
			parseFilter({
				sort: { key: 'colour', dir: 'up' },
				text: 3,
				year: [2, 1],
				types: ['book', 'novel', 7],
				authors: 'x',
				uploadedBy: [1, null],
				tags: { a: 'b' }
			})
		).toEqual({ ...emptyFilter(), types: ['book'], uploadedBy: [null] });
		expect(parseFilter({ sort: { key: 'year', dir: 'up' } }).sort).toEqual(emptyFilter().sort);
		expect(parseFilter(null)).toEqual(emptyFilter());
	});

	it('storage blocked: the default, nothing thrown', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => {
				throw new Error('blocked');
			},
			setItem: () => {
				throw new Error('blocked');
			}
		});
		expect(loadFilter()).toEqual(emptyFilter());
		expect(() => saveFilter(emptyFilter())).not.toThrow();
	});
});
