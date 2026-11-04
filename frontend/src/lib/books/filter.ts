// The Books page's filter and sort: what the pane offers (taken from the books themselves:
// their references, uploaders and tags), which books a filter keeps, their order, and the
// choice kept on this device. Pure functions but load/save (localStorage).
import type { BookRow, Reference, ReferenceName, Tag } from '../api/types';
import {
	bounds,
	dayOf,
	effectiveTags,
	isRange,
	load,
	narrowed,
	parseNames,
	parseStrings,
	parseTags,
	save,
	sortNames,
	tagOptions,
	tagsMatch,
	within,
	type Range,
	type TagFilter,
	type TagOption
} from '../filters/common';
import { nameOf, year } from './citation';
import { TYPES, type RefType } from './reference';

export type SortKey = 'uploaded_at' | 'title' | 'author' | 'year' | 'pages';
export type SortDir = 'asc' | 'desc';
export interface Sort {
	key: SortKey;
	dir: SortDir;
}
export const SORT_KEYS: readonly SortKey[] = ['uploaded_at', 'title', 'author', 'year', 'pages'];

export interface BookFilter {
	sort: Sort;
	text: string; // in the titles and names; empty: any
	year: Range | null; // the date of publication's year; null: any
	uploadedAt: Range | null; // days (dayOf); null: any
	authors: string[]; // authors or editors, as shown (nameOf); empty: anyone
	types: RefType[];
	languages: string[];
	publishers: string[];
	uploadedBy: (string | null)[]; // display names, null = unknown or deleted; empty: anyone
	tags: Record<string, TagFilter>;
}

export const DEFAULT_SORT: Sort = { key: 'uploaded_at', dir: 'desc' };
export const emptyFilter = (): BookFilter => ({
	sort: { ...DEFAULT_SORT },
	text: '',
	year: null,
	uploadedAt: null,
	authors: [],
	types: [],
	languages: [],
	publishers: [],
	uploadedBy: [],
	tags: {}
});

export interface FilterOptions {
	year: Range | null; // null: no book has a date
	uploadedAt: Range | null; // null: no book
	authors: string[]; // sorted by family name
	types: RefType[]; // in the form's order
	languages: string[];
	publishers: string[];
	uploaders: (string | null)[]; // sorted by name, unknown last
	tags: TagOption[]; // in /api/tags's order (by name)
}

/** Lower case, without accents: "Dōjō" and "dojo" alike. */
export const fold = (s: string) =>
	s
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();

const people = (ref: Reference) => [...(ref.author ?? []), ...(ref.editor ?? [])];
/** Its authors and editors, as the pane lists them. */
export const creatorsOf = (ref: Reference) => people(ref).map((n) => nameOf(n));
/** The name a list sorts on: the first author's (or editor's) family name, or the name as written. */
const familyName = (n: ReferenceName) => n.family ?? n.literal ?? '';
const sortName = (ref: Reference) => {
	const first = people(ref)[0];
	return first ? familyName(first) : '';
};
const familyOf = (books: BookRow[]) => {
	const family = new Map<string, string>();
	for (const b of books) for (const n of people(b.reference)) family.set(nameOf(n), familyName(n));
	return family;
};

const distinct = (values: (string | null | undefined)[]) =>
	[...new Set(values.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));

/** What the pane offers: the bounds and values found among these books. */
export function filterOptions(books: BookRow[], tags: Tag[]): FilterOptions {
	const family = familyOf(books);
	return {
		year: bounds(books.flatMap((b) => year(b.reference.issued) ?? [])),
		uploadedAt: bounds(books.map((b) => dayOf(b.uploaded_at))),
		authors: [...family.keys()].sort((a, b) => family.get(a)!.localeCompare(family.get(b)!) || a.localeCompare(b)),
		types: TYPES.filter((type) => books.some((b) => b.reference.type === type)),
		languages: distinct(books.map((b) => b.reference.language)),
		publishers: distinct(books.map((b) => b.reference.publisher)),
		uploaders: sortNames(books.map((b) => b.uploaded_by)),
		tags: tagOptions(books, tags)
	};
}

const offered = <T>(chosen: T[], options: readonly T[]) => chosen.filter((v) => options.includes(v));

/** The criteria that still apply to these options: full ranges, values or tags no longer offered dropped. */
export function effective(filter: BookFilter, options: FilterOptions): BookFilter {
	return {
		sort: filter.sort,
		text: filter.text.trim(),
		year: narrowed(filter.year, options.year),
		uploadedAt: narrowed(filter.uploadedAt, options.uploadedAt),
		authors: offered(filter.authors, options.authors),
		types: offered(filter.types, options.types),
		languages: offered(filter.languages, options.languages),
		publishers: offered(filter.publishers, options.publishers),
		uploadedBy: offered(filter.uploadedBy, options.uploaders),
		tags: effectiveTags(filter.tags, options.tags)
	};
}

/** The number of criteria of an effective filter, and 1 more for an order other than the default. */
export function activeCount(filter: BookFilter): number {
	const sorted = filter.sort.key !== DEFAULT_SORT.key || filter.sort.dir !== DEFAULT_SORT.dir;
	return (
		Number(sorted) +
		Number(!!filter.text) +
		Number(filter.year !== null) +
		Number(filter.uploadedAt !== null) +
		[filter.authors, filter.types, filter.languages, filter.publishers, filter.uploadedBy].filter((l) => l.length)
			.length +
		Object.keys(filter.tags).length
	);
}

/** Titles and names, folded, for the text search. */
const searchable = (ref: Reference) =>
	fold([ref.title, ref['original-title'], ref['container-title'], ...creatorsOf(ref)].filter(Boolean).join(' '));

const any = <T>(chosen: T[], value: T) => !chosen.length || chosen.includes(value);

/** Whether a book passes an EFFECTIVE filter: every criterion (AND), any of the values chosen in one (OR). */
export function matches(book: BookRow, filter: BookFilter): boolean {
	const ref = book.reference;
	return (
		(!filter.text || searchable(ref).includes(fold(filter.text))) &&
		(!filter.year || within(year(ref.issued), filter.year)) &&
		(!filter.uploadedAt || within(dayOf(book.uploaded_at), filter.uploadedAt)) &&
		(!filter.authors.length || creatorsOf(ref).some((n) => filter.authors.includes(n))) &&
		any(filter.types, ref.type) &&
		(!filter.languages.length || filter.languages.includes(ref.language ?? '')) &&
		(!filter.publishers.length || filter.publishers.includes(ref.publisher ?? '')) &&
		any(filter.uploadedBy, book.uploaded_by) &&
		tagsMatch(book, filter.tags)
	);
}

/**
 * A copy in that order (lang: how titles and names compare). Books without the value
 * (no author, no date, no page count) last either way; equal ones keep the server's
 * order (newest upload first). Same upload time (to the second): by ID, in the same direction.
 */
export function sortBooks(books: BookRow[], sort: Sort, lang: string): BookRow[] {
	const sign = sort.dir === 'asc' ? 1 : -1;
	const collator = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
	const text = (x: string, y: string) => (!x || !y ? (x === y ? 0 : x ? -1 : 1) : collator.compare(x, y) * sign);
	const number = (x: number | null | undefined, y: number | null | undefined) =>
		x == null || y == null ? (x == y ? 0 : x == null ? 1 : -1) : (x - y) * sign;
	return [...books].sort((a, b) => {
		switch (sort.key) {
			case 'title':
				return text(a.reference.title, b.reference.title);
			case 'author':
				return (
					text(sortName(a.reference), sortName(b.reference)) ||
					text(creatorsOf(a.reference)[0] ?? '', creatorsOf(b.reference)[0] ?? '')
				);
			case 'year':
				return number(year(a.reference.issued), year(b.reference.issued));
			case 'pages':
				return number(a.pages, b.pages);
			default:
				return (Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at) || a.id - b.id) * sign;
		}
	});
}

// Kept on this device (the page is left for a book, then back).
const STORAGE_KEY = 'books.filter';

/** A stored filter, checked part by part: what is not understood is the default. */
export function parseFilter(raw: unknown): BookFilter {
	const filter = emptyFilter();
	if (typeof raw !== 'object' || raw === null) return filter;
	const o = raw as Record<string, unknown>;
	const sort = o.sort as Partial<Sort> | undefined;
	if (sort && SORT_KEYS.includes(sort.key as SortKey) && (sort.dir === 'asc' || sort.dir === 'desc')) {
		filter.sort = { key: sort.key as SortKey, dir: sort.dir };
	}
	if (typeof o.text === 'string') filter.text = o.text;
	if (isRange(o.year)) filter.year = o.year;
	if (isRange(o.uploadedAt)) filter.uploadedAt = o.uploadedAt;
	filter.authors = parseStrings(o.authors);
	filter.types = parseStrings(o.types).filter((t): t is RefType => TYPES.includes(t as RefType));
	filter.languages = parseStrings(o.languages);
	filter.publishers = parseStrings(o.publishers);
	filter.uploadedBy = parseNames(o.uploadedBy);
	filter.tags = parseTags(o.tags);
	return filter;
}

export const loadFilter = (): BookFilter => load(STORAGE_KEY, parseFilter);
export const saveFilter = (filter: BookFilter): void => save(STORAGE_KEY, filter);
