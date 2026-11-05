// What the search must find, worked out on its own from the data the API gives (the
// catalogue in every language, the videos, the books): the e2e tests compare the results
// page with it, so every match is checked, not only some. Written apart from
// src/lib/search/search.ts on purpose; it follows the same rules: words split on spaces and
// punctuation (Japanese also per character), accents and case ignored, every word of the
// query the start of a word of the item (or, from 6 letters, a word within
// round(length × 0.2) edits), the item's text in every language.

export type Group = 'catalog' | 'segments' | 'videos' | 'books';

interface Named {
	id: string;
	kanji: string;
	romaji: string;
	description?: string;
}
interface Section extends Named {
	ryu: string;
	category: string;
	weapon?: string;
}
interface Technique extends Named {
	section: string;
}
interface Segment {
	id: number;
	technique: string;
	performer: string;
	tags?: { id: string; value?: string }[];
}
export interface Catalog {
	schools: Named[];
	categories: Named[];
	weapons: Named[];
	sections: Section[];
	techniques: Technique[];
	segments: Segment[];
	performers?: { id: string; name: string }[];
	tags?: { id: string; name: string; values?: { id: string; name: string }[] }[];
}
interface Name {
	family?: string | null;
	given?: string | null;
	literal?: string | null;
}
export interface Video {
	id: number;
	original_filename: string;
	uploaded_by: string | null;
	tags: { id: string; value?: string | null }[];
}
export interface Book {
	id: number;
	status: string;
	original_filename: string;
	uploaded_by: string | null;
	tags: { id: string; value?: string | null }[];
	reference: Record<string, unknown> & {
		title?: string;
		author?: Name[] | null;
		editor?: Name[] | null;
		translator?: Name[] | null;
		issued?: { 'date-parts': number[][] } | null;
	};
}

const SPLIT = /[\p{Z}\p{P}\p{S}\s]+/u;
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const fold = (s: string) =>
	s
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
const words = (text: string) => {
	const parts = text.split(SPLIT).filter(Boolean);
	return [...parts, ...parts.filter((w) => CJK.test(w)).flatMap((w) => [...w].filter((c) => CJK.test(c)))]
		.map(fold)
		.filter(Boolean);
};

function distance(a: string, b: string) {
	let row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = [i];
		for (let j = 1; j <= b.length; j++)
			next[j] = Math.min(row[j]! + 1, next[j - 1]! + 1, row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
		row = next;
	}
	return row[b.length]!;
}

/** Every word of the query matches a word of the text. */
export function matches(text: string, query: string) {
	const have = words(text);
	const wanted = words(query);
	return (
		wanted.length > 0 &&
		wanted.every((w) => {
			const edits = w.length >= 6 ? Math.min(6, Math.round(w.length * 0.2)) : 0;
			return have.some((h) => h.startsWith(w) || (edits > 0 && distance(h, w) <= edits));
		})
	);
}

const last = (id: string) => id.slice(id.lastIndexOf('.') + 1);
const nameOf = (n: Name) => n.literal ?? [n.given, n.family].filter(Boolean).join(' ');

/** The page of each item a query must find, by group (paths without the base, sorted).
 * `catalogs`: every language's; `videos`/`books`: null when the user may not see them. */
export function expected(
	catalogs: Catalog[],
	videos: Video[] | null,
	books: Book[] | null,
	query: string
): Record<Group, string[]> {
	const [base] = catalogs;
	const all = <T extends { id: string }>(pick: (c: Catalog) => T[], id: string) =>
		catalogs.map((c) => pick(c).find((x) => x.id === id));
	const text = (items: (Named | undefined)[]) =>
		items.flatMap((x) => (x ? [x.romaji, x.kanji, x.description ?? ''] : [])).join(' ');
	const names = (items: (Named | undefined)[]) => items.flatMap((x) => (x ? [x.romaji, x.kanji] : [])).join(' ');
	const tagText = (tags: { id: string; value?: string | null }[] | undefined) =>
		catalogs
			.flatMap((c) =>
				(tags ?? []).map((t) => {
					const def = c.tags?.find((d) => d.id === t.id);
					const value = t.value ? (def?.values?.find((v) => v.id === t.value)?.name ?? t.value) : '';
					return `${def?.name ?? t.id} ${value}`;
				})
			)
			.join(' ');
	const sectionPath = (s: Section) =>
		`/schools/${s.ryu}/${s.category}${s.category === 'buki' ? `/${s.weapon}` : ''}/${last(s.id)}`;
	const techniquePath = (id: string) => {
		const t = base!.techniques.find((x) => x.id === id);
		const s = t && base!.sections.find((x) => x.id === t.section);
		return t && s ? `${sectionPath(s)}/${last(t.id)}` : null;
	};
	const out: Record<Group, string[]> = { catalog: [], segments: [], videos: [], books: [] };

	for (const school of base!.schools)
		if (matches(text(all((c) => c.schools, school.id)), query)) out.catalog.push(`/schools/${school.id}`);
	for (const s of base!.sections) {
		// Where it is: its school's name, its category's and weapon's names and descriptions.
		const where = catalogs.map(
			(c) =>
				`${names([c.schools.find((x) => x.id === s.ryu)])} ${text([
					c.categories.find((x) => x.id === s.category),
					s.weapon ? c.weapons.find((x) => x.id === s.weapon) : undefined
				])}`
		);
		if (matches(`${text(all((c) => c.sections, s.id))} ${where.join(' ')}`, query)) out.catalog.push(sectionPath(s));
	}
	for (const t of base!.techniques) {
		const s = base!.sections.find((x) => x.id === t.section);
		// Where it is: its section's and school's names.
		const where = catalogs.map((c) =>
			names([c.sections.find((x) => x.id === t.section), c.schools.find((x) => x.id === s?.ryu)])
		);
		const path = techniquePath(t.id);
		if (path && matches(`${text(all((c) => c.techniques, t.id))} ${where.join(' ')}`, query)) out.catalog.push(path);
	}
	for (const sg of base!.segments) {
		const t = all((c) => c.techniques, sg.technique);
		const performer = base!.performers?.find((p) => p.id === sg.performer)?.name ?? '';
		const path = techniquePath(sg.technique);
		if (path && matches(`${text(t)} ${performer} ${tagText(sg.tags)}`, query)) out.segments.push(path);
	}
	for (const v of videos ?? [])
		if (matches(`${v.original_filename} ${v.uploaded_by ?? ''} ${tagText(v.tags)}`, query))
			out.videos.push(`/videos/${v.id}`);
	for (const b of books ?? []) {
		if (b.status !== 'published') continue;
		const r = b.reference;
		const people = [...(r.author ?? []), ...(r.editor ?? []), ...(r.translator ?? [])].map(nameOf);
		const fields = ['title', 'original-title', 'container-title', 'collection-title', 'publisher'];
		const more = ['publisher-place', 'genre', 'archive', 'ISBN', 'note'];
		const plain = [...fields, ...more].map((f) => (typeof r[f] === 'string' ? (r[f] as string) : ''));
		const year = r.issued?.['date-parts'][0]?.[0] ?? '';
		const all = [...plain, ...people, year, b.original_filename, b.uploaded_by ?? '', tagText(b.tags)];
		if (matches(all.join(' '), query)) out.books.push(`/books/${b.id}`);
	}
	for (const list of Object.values(out)) list.sort();
	return out;
}
