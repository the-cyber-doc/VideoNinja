// The search: documents of every language, found by any of them, shown in the page's.
import { describe, expect, it } from 'vitest';
import type { BookRow, VideoRow } from '../api/types';
import type { Catalog } from '../catalog.svelte';
import type { SearchHits } from '../api/types';
import {
	buildIndex,
	describe as show,
	documents,
	find,
	groupOf,
	remoteShown,
	results,
	snippetParts,
	tokenize,
	type Sources
} from './search';

const catalog = (lang: 'en' | 'fr'): Catalog => ({
	schools: [
		{
			id: 'gyokko',
			kanji: '玉虎流',
			romaji: 'Gyokko Ryu',
			description: lang === 'en' ? 'Jewel tiger' : 'Tigre de jade'
		}
	],
	categories: [
		{ id: 'taijutsu', kanji: '体術', romaji: 'Taijutsu', description: lang === 'en' ? 'Unarmed' : 'Mains nues' }
	],
	weapons: [{ id: 'bo', kanji: '棒', romaji: 'Bo' }],
	sections: [
		{
			id: 'gyokko.taijutsu.jo_ryaku',
			kanji: '序略之巻',
			romaji: 'Jo Ryaku no Maki',
			ryu: 'gyokko',
			category: 'taijutsu'
		},
		{ id: 'gyokko.buki.bo.kihon', kanji: '基本', romaji: 'Kihon', ryu: 'gyokko', category: 'buki', weapon: 'bo' },
		{ id: 'gone.taijutsu.x', kanji: '', romaji: 'Orphan', ryu: 'gone', category: 'taijutsu' }
	],
	techniques: [
		{
			id: 'gyokko.taijutsu.jo_ryaku.koku',
			kanji: '虚空',
			romaji: 'Koku',
			section: 'gyokko.taijutsu.jo_ryaku',
			description: lang === 'en' ? 'Empty space' : 'Espace vide'
		},
		{ id: 'gone.taijutsu.x.y', kanji: '', romaji: 'Lost', section: 'nowhere' }
	],
	segments: [
		{
			id: 1,
			video: 9,
			technique: 'gyokko.taijutsu.jo_ryaku.koku',
			begin_s: 12,
			end_s: 27,
			performer: 'hatsumi',
			tags: [{ id: 'location', value: 'outdoor' }, { id: 'year', value: '2024' }, { id: 'event' }]
		},
		{ id: 2, video: 9, technique: 'unknown', begin_s: 0, end_s: 1, performer: 'nobody' }
	],
	performers: [{ id: 'hatsumi', name: 'Hatsumi' }],
	tags: [
		{
			id: 'location',
			name: lang === 'en' ? 'Location' : 'Lieu',
			values: [{ id: 'outdoor', name: lang === 'en' ? 'Outdoor' : 'Extérieur' }]
		},
		{ id: 'year', name: lang === 'en' ? 'Year' : 'Année' },
		{ id: 'event', name: lang === 'en' ? 'Event' : 'Événement' }
	]
});

const video = {
	id: 9,
	original_filename: 'kata-1.mp4',
	uploaded_by: 'Hana',
	duration_s: 61.4,
	tags: [
		{ id: 'country', value: 'JPN' },
		{ id: 'source', value: 'unknown-value' }
	]
} as unknown as VideoRow;
const book = (id: number, extra: object = {}) =>
	({
		id,
		status: 'published',
		original_filename: `book-${id}.pdf`,
		uploaded_by: 'Aiko',
		tags: [],
		reference: {
			type: 'book',
			title: 'Ninjutsu',
			author: [{ family: 'Hatsumi', given: 'Masaaki' }, { literal: 'Bujinkan' }],
			publisher: 'Kodansha',
			issued: { 'date-parts': [[1981]] }
		},
		...extra
	}) as unknown as BookRow;

const sources = (extra: Partial<Sources> = {}): Sources => ({
	catalogs: { en: catalog('en'), fr: catalog('fr') },
	videos: [video],
	books: [book(3), book(4, { status: 'queued' })],
	...extra
});
const search = (q: string, src = sources()) => find(buildIndex(documents(src)), q).map((h) => `${h.kind}:${h.ref}`);

describe('tokenize', () => {
	it('words on spaces and punctuation; Japanese also by character', () => {
		expect(tokenize('Jo Ryaku-no Maki, 1981')).toEqual(['Jo', 'Ryaku', 'no', 'Maki', '1981']);
		expect(tokenize('Koku 虚空')).toEqual(['Koku', '虚空', '虚', '空']);
	});
});

describe('documents', () => {
	it('none without a catalogue', () => {
		expect(documents({ catalogs: {}, videos: null, books: null })).toEqual([]);
	});

	it('one per school, section, technique, segment, video and published book', () => {
		expect(documents(sources()).map((d) => d.id)).toEqual([
			'school:gyokko',
			'section:gyokko.taijutsu.jo_ryaku',
			'section:gyokko.buki.bo.kihon',
			'section:gone.taijutsu.x',
			'technique:gyokko.taijutsu.jo_ryaku.koku',
			'technique:gone.taijutsu.x.y',
			'segment:1',
			'segment:2',
			'video:9',
			'book:3'
		]);
	});

	it('no description, no performers: nothing to index there; a mark alone is no word', () => {
		const bare = { ...catalog('en'), performers: undefined };
		bare.schools = [{ ...bare.schools[0]!, description: undefined }];
		const docs = documents({ catalogs: { en: bare }, videos: null, books: null });
		expect(docs[0]).toMatchObject({ en: '' });
		expect(docs.find((d) => d.id === 'segment:1')).toMatchObject({ other: '2024' });
		expect(find(buildIndex(docs), '\u0301')).toEqual([]);
	});

	it('a language missing: its fields empty', () => {
		const school = documents(sources({ catalogs: { fr: catalog('fr') } }))[0];
		expect(school).toMatchObject({ en: '', fr: 'Tigre de jade' });
	});
});

describe('find', () => {
	it('a translated word of any language, whatever the page shows', () => {
		expect(search('empty')).toEqual(['technique:gyokko.taijutsu.jo_ryaku.koku', 'segment:1']);
		expect(search('espace vide')).toEqual(['technique:gyokko.taijutsu.jo_ryaku.koku', 'segment:1']);
		expect(search('tigre')).toEqual(['school:gyokko']);
	});

	it('accents and case ignored, prefixes, a typo in a longer word', () => {
		expect(search('EXTERIEUR')).toEqual(['segment:1']);
		expect(search('outd')).toEqual(['segment:1']);
		expect(search('kodanshi')).toEqual(['book:3']);
		expect(search('kok')).toContain('technique:gyokko.taijutsu.jo_ryaku.koku');
	});

	it('every word must match; nothing for an empty query', () => {
		expect(search('koku hatsumi')).toEqual(['segment:1']);
		expect(search('koku nothing')).toEqual([]);
		expect(search('  ')).toEqual([]);
	});

	it('Japanese by character', () => {
		expect(search('空')).toContain('technique:gyokko.taijutsu.jo_ryaku.koku');
	});

	it('tags: names in every language, list values by name, free values as typed', () => {
		expect(search('lieu')).toEqual(['segment:1']);
		expect(search('2024')).toEqual(['segment:1']);
		expect(search('événement')).toEqual(['segment:1']);
		expect(search('unknown-value')).toEqual(['video:9']); // a value its tag does not list
		expect(search('country')).toEqual(['video:9']); // a tag the catalogue does not know: its ID
	});

	it('sections by their school, category and weapon; videos and books by their metadata', () => {
		expect(search('kihon bo')).toEqual(['section:gyokko.buki.bo.kihon']);
		expect(search('mains nues')).toContain('section:gyokko.taijutsu.jo_ryaku');
		expect(search('hana')).toEqual(['video:9']);
		expect(search('masaaki 1981')).toEqual(['book:3']);
		expect(search('bujinkan')).toEqual(['book:3']);
	});
});

describe('describe and results', () => {
	const en = catalog('en');
	const src = sources();
	const shown = (kind: Parameters<typeof show>[0]['kind'], ref: string | number, c = en) => show({ kind, ref }, c, src);

	it('each kind, in the catalogue given (the page’s language), with its page', () => {
		expect(shown('school', 'gyokko')).toEqual({ title: 'Gyokko Ryu', detail: '玉虎流', href: '/schools/gyokko' });
		expect(shown('section', 'gyokko.buki.bo.kihon')).toEqual({
			title: 'Kihon',
			detail: 'Gyokko Ryu › 基本',
			href: '/schools/gyokko/buki/bo/kihon'
		});
		expect(shown('technique', 'gyokko.taijutsu.jo_ryaku.koku')).toEqual({
			title: 'Koku',
			detail: 'Gyokko Ryu › Jo Ryaku no Maki',
			href: '/schools/gyokko/taijutsu/jo_ryaku/koku'
		});
		expect(shown('segment', 1)).toEqual({
			title: 'Koku',
			detail: '0:12–0:27 · Hatsumi',
			href: '/schools/gyokko/taijutsu/jo_ryaku/koku'
		});
		expect(shown('video', 9)).toEqual({ title: 'kata-1.mp4', detail: 'Hana · 1:01', href: '/videos/9' });
		expect(shown('book', 3)).toEqual({ title: 'Ninjutsu', detail: 'Masaaki Hatsumi, Bujinkan 1981', href: '/books/3' });
	});

	it('what the catalogue cannot place: not shown', () => {
		expect(shown('school', 'nope')).toBeNull();
		expect(shown('section', 'gone.taijutsu.x')).toEqual(expect.objectContaining({ title: 'Orphan' }));
		expect(shown('section', 'nope')).toBeNull();
		expect(shown('technique', 'gone.taijutsu.x.y')).toBeNull(); // its section unknown
		expect(shown('segment', 2)).toBeNull(); // its technique unknown
		expect(shown('segment', 99)).toBeNull();
		expect(shown('video', 1)).toBeNull();
		expect(shown('book', 1)).toBeNull();
		expect(show({ kind: 'video', ref: 9 }, en, sources({ videos: null }))).toBeNull();
		expect(show({ kind: 'book', ref: 3 }, en, sources({ books: null }))).toBeNull();
	});

	it('details missing: left out; a book without a title: its file; editors when no author', () => {
		const bare = { ...video, uploaded_by: null, duration_s: null } as unknown as VideoRow;
		const edited = book(5, {
			reference: { type: 'book', title: '', editor: [{ family: 'Doe', given: 'Jane' }] }
		});
		const anonymous = book(6, { reference: { type: 'book', title: 'Untitled' } });
		const s = sources({ videos: [bare], books: [edited, anonymous] });
		expect(show({ kind: 'video', ref: 9 }, en, s)?.detail).toBe('');
		expect(show({ kind: 'book', ref: 5 }, en, s)).toMatchObject({ title: 'book-5.pdf', detail: 'Jane Doe' });
		expect(show({ kind: 'book', ref: 6 }, en, s)?.detail).toBe('');
		const lonely = { ...en, performers: undefined, schools: [] };
		expect(show({ kind: 'segment', ref: 1 }, lonely, s)?.detail).toBe('0:12–0:27');
		expect(show({ kind: 'technique', ref: 'gyokko.taijutsu.jo_ryaku.koku' }, lonely, s)?.detail).toBe(
			'› Jo Ryaku no Maki'
		);
	});

	it('grouped in order, limited, counted; none without the page’s catalogue', () => {
		const hits = [
			{ kind: 'book', ref: 3 },
			{ kind: 'segment', ref: 1 },
			{ kind: 'technique', ref: 'gyokko.taijutsu.jo_ryaku.koku' },
			{ kind: 'school', ref: 'gyokko' },
			{ kind: 'segment', ref: 2 } // not shown
		] as const;
		const groups = results([...hits], en, src, 1);
		expect(groups.map((g) => [g.group, g.hits.map((h) => h.key), g.total])).toEqual([
			['catalog', ['technique:gyokko.taijutsu.jo_ryaku.koku'], 2],
			['segments', ['segment:1'], 1],
			['books', ['book:3'], 1]
		]);
		expect(results([...hits], undefined, src)).toEqual([]);
		expect(groupOf('video')).toBe('videos');
	});
});

describe("the server's full text", () => {
	const en = catalog('en');
	const KOKU = 'gyokko.taijutsu.jo_ryaku.koku';
	const REMOTE: SearchHits = {
		pages: [
			{ book: 3, page: 2, snippet: 'Le \u0002dōjō\u0003' },
			{ book: 99, page: 1, snippet: 'unknown book' }
		],
		annotations: [
			{ id: 5, book: 3, page: 4, technique: KOKU, snippet: 'quote' },
			{ id: 6, book: 3, page: 5, technique: null, snippet: 'plain' },
			{ id: 7, book: null, page: 1, technique: KOKU, snippet: 'for everyone' },
			{ id: 8, book: null, page: 1, technique: 'unknown', snippet: 'lost' },
			{ id: 9, book: 99, page: 1, technique: null, snippet: 'lost' }
		],
		comments: [
			{ id: 10, technique: KOKU, user: 'Hana', snippet: 'nice' },
			{ id: 11, technique: KOKU, user: null, snippet: 'old' },
			{ id: 12, technique: 'unknown', user: 'Hana', snippet: 'lost' }
		],
		book_comments: [
			{ id: 13, annotation: 5, book: 3, user: 'Aiko', snippet: 'reply' },
			{ id: 14, annotation: 9, book: 99, user: 'Aiko', snippet: 'lost' }
		]
	};

	it('each hit with its page to open; those the page cannot show left out', () => {
		const shown = remoteShown(REMOTE, en, sources());
		expect(shown.map((h) => [h.key, h.title, h.detail, h.href, h.snippet])).toEqual([
			['page:3-2', 'Ninjutsu', 'Page 2', '/books/3?page=2', 'Le \u0002dōjō\u0003'],
			['annotation:5', 'Ninjutsu', 'Page 4 · Koku', '/books/3?annotation=5', 'quote'],
			['annotation:6', 'Ninjutsu', 'Page 5', '/books/3?annotation=6', 'plain'],
			['annotation:7', 'Koku', 'A book’s note', '/schools/gyokko/taijutsu/jo_ryaku/koku', 'for everyone'],
			['comment:10', 'Koku', 'Hana', '/schools/gyokko/taijutsu/jo_ryaku/koku', 'nice'],
			['comment:11', 'Koku', 'a deleted user', '/schools/gyokko/taijutsu/jo_ryaku/koku', 'old'],
			['book_comment:13', 'Ninjutsu', 'Aiko', '/books/3?annotation=5', 'reply']
		]);
		const untitled = sources({ books: [book(3, { reference: { type: 'book', title: '' } })] });
		expect(remoteShown({ ...REMOTE, annotations: [], comments: [], book_comments: [] }, en, untitled)[0]?.title).toBe(
			'book-3.pdf'
		);
		expect(remoteShown(REMOTE, en, sources({ books: null })).map((h) => h.kind)).toEqual([
			'annotation',
			'comment',
			'comment'
		]);
	});

	it('after the browser’s hits, in their groups', () => {
		const groups = results([{ kind: 'book', ref: 3 }], en, sources(), 2, REMOTE);
		expect(groups.map((g) => [g.group, g.total])).toEqual([
			['books', 1],
			['texts', 4],
			['comments', 3]
		]);
		expect(groupOf('page')).toBe('texts');
	});
});

describe('snippetParts', () => {
	it('the matches marked, the rest plain; markers left open or empty: dropped', () => {
		expect(snippetParts('Le \u0002dōjō\u0003 de \u0002Kamae\u0003')).toEqual([
			{ text: 'Le ', mark: false },
			{ text: 'dōjō', mark: true },
			{ text: ' de ', mark: false },
			{ text: 'Kamae', mark: true }
		]);
		expect(snippetParts('\u0002\u0003a \u0002open')).toEqual([{ text: 'a open', mark: false }]);
		expect(snippetParts('')).toEqual([]);
	});
});
