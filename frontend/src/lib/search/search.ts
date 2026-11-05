// The search (client side, MiniSearch): one document per school, section, technique,
// segment, video and book, holding the text of EVERY language (the catalogue's of each),
// so that a French word finds what is shown in English. Hits are shown in the page's
// language (`describe`). Accents and case are ignored (`fold`); words match by prefix,
// longer ones also with a typo; Japanese text matches by character too.
import MiniSearch from 'minisearch';
import type { BookRow, TagIn, VideoRow } from '../api/types';
import { nameOf, year } from '../books/citation';
import { fold } from '../books/filter';
import { catalogHref, pathOf, schoolHref, type Catalog, type Segment } from '../catalog.svelte';
import { LANGUAGES, type Lang } from '../i18n.svelte';
import { formatTime } from '../time';
import { url } from '../base';

export type Kind = 'school' | 'section' | 'technique' | 'segment' | 'video' | 'book';
/** How the results are grouped, in this order. */
export type Group = 'catalog' | 'segments' | 'videos' | 'books';
export const GROUPS: readonly Group[] = ['catalog', 'segments', 'videos', 'books'];
export const groupOf = (kind: Kind): Group =>
	kind === 'segment' ? 'segments' : kind === 'video' ? 'videos' : kind === 'book' ? 'books' : 'catalog';

const LANGS = Object.keys(LANGUAGES) as Lang[];

/** What is searched: the catalogue in each language; videos and books when the user may open them. */
export interface Sources {
	catalogs: Partial<Record<Lang, Catalog>>;
	videos: VideoRow[] | null;
	books: BookRow[] | null;
}

/** A searched document: `names` (Japanese names, titles), `other` (people, numbers, free text),
 * and per language its translated text (`<lang>`) and where it is (`ctx_<lang>`). */
export interface Doc {
	id: string; // "<kind>:<id>"
	kind: Kind;
	ref: string | number;
	[field: string]: string | number;
}

const FIELDS = ['names', 'other', ...LANGS, ...LANGS.map((l) => `ctx_${l}`)];
const BOOST: Record<string, number> = {
	names: 3,
	other: 1.5,
	...Object.fromEntries(LANGS.map((l) => [l, 2])),
	...Object.fromEntries(LANGS.map((l) => [`ctx_${l}`, 1]))
};

const join = (...parts: (string | number | null | undefined)[]) => parts.filter((p) => p || p === 0).join(' ');
const named = (x: { kanji: string; romaji: string } | undefined) => (x ? join(x.romaji, x.kanji) : '');

/** Per language, the names of these tags (and of their list values); free values in `other`. */
function tagText(tags: TagIn[] | Segment['tags'], catalogs: Sources['catalogs']) {
	const out: Record<string, string> = {};
	const free: string[] = [];
	for (const lang of LANGS) {
		const defs = catalogs[lang]?.tags ?? [];
		const words: string[] = [];
		for (const tag of tags ?? []) {
			const def = defs.find((d) => d.id === tag.id);
			words.push(def?.name ?? tag.id);
			if (!tag.value) continue;
			const value = def?.values?.find((v) => v.id === tag.value);
			if (value) words.push(value.name);
			else if (lang === LANGS[0]) free.push(tag.value);
		}
		out[lang] = words.join(' ');
	}
	return { byLang: out, free: free.join(' ') };
}

/** Every document of these sources (the catalogue's IDs are the same in every language). */
export function documents(src: Sources): Doc[] {
	const each = LANGS.map((l) => src.catalogs[l]).filter((c): c is Catalog => !!c);
	const base = each[0];
	if (!base) return [];
	const perLang = (fn: (c: Catalog) => string, prefix = '') =>
		Object.fromEntries(LANGS.map((l) => [`${prefix}${l}`, src.catalogs[l] ? fn(src.catalogs[l]) : '']));
	const byId = <T extends { id: string }>(list: T[], id: string | undefined) => list.find((x) => x.id === id);
	const docs: Doc[] = [];

	for (const s of base.schools)
		docs.push({
			id: `school:${s.id}`,
			kind: 'school',
			ref: s.id,
			names: named(s),
			...perLang((c) => byId(c.schools, s.id)?.description ?? '')
		});
	for (const s of base.sections) {
		const where = (c: Catalog) => {
			const category = byId(c.categories, s.category);
			const weapon = byId(c.weapons, s.weapon);
			return join(
				named(byId(c.schools, s.ryu)),
				named(category),
				category?.description,
				named(weapon),
				weapon?.description
			);
		};
		docs.push({
			id: `section:${s.id}`,
			kind: 'section',
			ref: s.id,
			names: named(s),
			...perLang((c) => byId(c.sections, s.id)?.description ?? ''),
			...perLang(where, 'ctx_')
		});
	}
	for (const tq of base.techniques) {
		const section = byId(base.sections, tq.section);
		docs.push({
			id: `technique:${tq.id}`,
			kind: 'technique',
			ref: tq.id,
			names: named(tq),
			...perLang((c) => byId(c.techniques, tq.id)?.description ?? ''),
			...perLang((c) => join(named(byId(c.sections, tq.section)), named(byId(c.schools, section?.ryu))), 'ctx_')
		});
	}
	for (const sg of base.segments) {
		const tags = tagText(sg.tags, src.catalogs);
		docs.push({
			id: `segment:${sg.id}`,
			kind: 'segment',
			ref: sg.id,
			names: named(byId(base.techniques, sg.technique)),
			other: join(byId(base.performers ?? [], sg.performer)?.name, tags.free),
			...tags.byLang,
			...perLang((c) => byId(c.techniques, sg.technique)?.description ?? '', 'ctx_')
		});
	}
	for (const v of src.videos ?? []) {
		const tags = tagText(v.tags, src.catalogs);
		docs.push({
			id: `video:${v.id}`,
			kind: 'video',
			ref: v.id,
			names: v.original_filename,
			other: join(v.uploaded_by, tags.free),
			...tags.byLang
		});
	}
	for (const b of src.books ?? []) {
		if (b.status !== 'published') continue; // the others cannot be opened
		const r = b.reference;
		const tags = tagText(b.tags, src.catalogs);
		const people = [...(r.author ?? []), ...(r.editor ?? []), ...(r.translator ?? [])].map((n) => nameOf(n));
		docs.push({
			id: `book:${b.id}`,
			kind: 'book',
			ref: b.id,
			names: join(r.title, r['original-title'], r['container-title'], r['collection-title']),
			other: join(
				...people,
				r.publisher,
				r['publisher-place'],
				year(r.issued),
				r.genre,
				r.archive,
				r.ISBN,
				r.note,
				b.original_filename,
				b.uploaded_by,
				tags.free
			),
			...tags.byLang
		});
	}
	return docs;
}

// Words: split on spaces and punctuation; Japanese (no spaces) also one character at a time.
const SPLIT = /[\p{Z}\p{P}\p{S}\s]+/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
export function tokenize(text: string): string[] {
	const words = text.split(SPLIT).filter(Boolean);
	const chars = words.filter((w) => CJK.test(w)).flatMap((w) => [...w].filter((c) => CJK.test(c)));
	return [...words, ...chars];
}

/** A word typed: by prefix; with one typo from 6 letters (shorter: romaji names one letter
 * apart are other techniques, Keto and Koto), two from 10 (MiniSearch's fraction). */
const fuzzy = (term: string) => (term.length >= 6 ? 0.2 : false);

export function buildIndex(docs: Doc[]) {
	const index = new MiniSearch<Doc>({
		fields: FIELDS,
		storeFields: ['kind', 'ref'],
		tokenize,
		processTerm: (term) => fold(term) || null
	});
	index.addAll(docs);
	return index;
}

export interface Hit {
	kind: Kind;
	ref: string | number;
}

/** Every document with all the words typed, best first. */
export function find(index: MiniSearch<Doc>, query: string): Hit[] {
	if (!query.trim()) return [];
	return index
		.search(query, { prefix: true, fuzzy, boost: BOOST, combineWith: 'AND' })
		.map((r) => ({ kind: r.kind as Kind, ref: r.ref as string | number }));
}

/** How a hit is shown: in the page's language (`catalog` is its catalogue). */
export interface Shown {
	title: string;
	detail: string;
	href: string;
}

const times = (s: Segment) => `${formatTime(s.begin_s)}–${formatTime(s.end_s)}`;

export function describe(hit: Hit, catalog: Catalog, src: Sources): Shown | null {
	const byId = <T extends { id: string | number }>(list: T[] | undefined) => list?.find((x) => x.id === hit.ref);
	const school = (id: string | undefined) => catalog.schools.find((s) => s.id === id)?.romaji;
	const section = (id: string | undefined) => catalog.sections.find((s) => s.id === id);
	const place = (id: string) => {
		const path = pathOf(catalog, id);
		return path ? catalogHref(path) : null;
	};
	switch (hit.kind) {
		case 'school': {
			const s = byId(catalog.schools);
			return s ? { title: s.romaji, detail: s.kanji, href: schoolHref(s.id) } : null;
		}
		case 'section': {
			const s = byId(catalog.sections);
			const href = s && place(s.id);
			return s && href ? { title: s.romaji, detail: join(school(s.ryu), '›', s.kanji), href } : null;
		}
		case 'technique': {
			const tq = byId(catalog.techniques);
			const sec = section(tq?.section);
			const href = tq && place(tq.id);
			return tq && href ? { title: tq.romaji, detail: join(school(sec?.ryu), '›', sec?.romaji), href } : null;
		}
		case 'segment': {
			const sg = byId(catalog.segments);
			const tq = catalog.techniques.find((x) => x.id === sg?.technique);
			const href = tq && place(tq.id);
			if (!sg || !tq || !href) return null;
			const performer = catalog.performers?.find((p) => p.id === sg.performer)?.name;
			return { title: tq.romaji, detail: join(times(sg), performer && `· ${performer}`), href };
		}
		case 'video': {
			const v = byId(src.videos ?? []);
			return v
				? {
						title: v.original_filename,
						detail: join(v.uploaded_by, v.duration_s == null ? null : `· ${formatTime(Math.round(v.duration_s))}`),
						href: url(`/videos/${v.id}`)
					}
				: null;
		}
		case 'book': {
			const b = byId(src.books ?? []);
			if (!b) return null;
			const r = b.reference;
			const people = (r.author?.length ? r.author : (r.editor ?? [])).map((n) => nameOf(n)).join(', ');
			return {
				title: r.title || b.original_filename,
				detail: join(people, year(r.issued)),
				href: url(`/books/${b.id}`)
			};
		}
	}
}

export interface ShownHit extends Shown {
	key: string; // "<kind>:<id>"
	kind: Kind;
}

/** The hits as shown, by group (at most `limit` per group; `total` counts them all). Hits the
 * page's catalogue cannot show (e.g. not yet in its language's snapshot) are left out. */
export function results(hits: Hit[], catalog: Catalog | undefined, src: Sources, limit = Infinity) {
	if (!catalog) return [];
	const shown = hits.flatMap((h) => {
		const s = describe(h, catalog, src);
		return s ? [{ ...s, key: `${h.kind}:${h.ref}`, kind: h.kind }] : [];
	});
	return GROUPS.map((group) => {
		const all = shown.filter((h) => groupOf(h.kind) === group);
		return { group, hits: all.slice(0, limit), total: all.length };
	}).filter((g) => g.total);
}
