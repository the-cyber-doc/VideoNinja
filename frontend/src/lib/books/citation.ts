// A book's reference (CSL-JSON) as a bibliography entry in Chicago style (The Chicago
// Manual of Style, 18th ed., notes and bibliography). Pure: the words around the data
// ("Edited by", "ed.", "Vol."…) come from the caller's t(), in the page's language;
// the data itself is shown as typed (never translated). Runs, so that a page can set
// the titles of books and journals in italics.
import type { Reference, ReferenceDate, ReferenceName } from '../api/types';
import type { MessageKey } from '../i18n.svelte';

export interface Run {
	text: string;
	italic?: boolean;
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** More authors than this: the first SHOWN_AUTHORS, then "et al." (CMOS 18, 13.76). */
const MAX_AUTHORS = 6;
const SHOWN_AUTHORS = 3;

const ENDS_SENTENCE = /[.?!…]["”»']?$/u;

export function ordinal(n: number, lang: string): string {
	if (lang === 'fr') return n === 1 ? '1re' : `${n}e`;
	const tens = n % 100;
	const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${suffix}`;
}

export function nameOf(name: ReferenceName, inverted = false): string {
	if (name.literal) return name.literal;
	if (!name.given) return name.family ?? '';
	return inverted ? `${name.family}, ${name.given}` : `${name.given} ${name.family}`;
}

/** "A", "A and B", "A, B, and C" (English's serial comma; French: "A, B et C"). */
export function joinNames(names: string[], lang: string, t: Translate): string {
	const and = t('citation.and');
	if (names.length < 3) return names.join(` ${and} `);
	return `${names.slice(0, -1).join(', ')}${lang === 'fr' ? '' : ','} ${and} ${names.at(-1)}`;
}

/** The authors (or editors) leading the entry: the first one inverted. */
function leading(names: ReferenceName[], lang: string, t: Translate): string {
	const shown = names.length > MAX_AUTHORS ? names.slice(0, SHOWN_AUTHORS) : names;
	const texts = shown.map((n, i) => nameOf(n, i === 0));
	if (shown.length < names.length) return `${texts.join(', ')}, ${t('citation.et_al')}`;
	return joinNames(texts, lang, t);
}

const natural = (names: ReferenceName[], lang: string, t: Translate) =>
	joinNames(
		names.map((n) => nameOf(n)),
		lang,
		t
	);

export const year = (date: ReferenceDate | null | undefined) => date?.['date-parts'][0]?.[0];

function edition(value: string, lang: string, t: Translate): string {
	return /^[0-9]+$/.test(value) ? t('citation.edition', { n: ordinal(Number(value), lang) }) : value;
}

/** Sentences of runs, each ended by a period unless it ends with its own punctuation. In
 * English the period goes inside a closing quotation mark (“Title.”), in French outside. */
class Entry {
	sentences: Run[][] = [];
	constructor(private lang: string) {}

	add(...runs: (Run | string | false | null | undefined)[]) {
		const kept = runs.filter((r): r is Run | string => !!r).map((r) => (typeof r === 'string' ? { text: r } : r));
		if (kept.length) this.sentences.push(kept);
	}

	/** A title in quotation marks, as its own sentence. */
	quotedTitle(title: string) {
		if (this.lang === 'fr') this.add(`« ${title} »`);
		else this.add({ text: `“${ENDS_SENTENCE.test(title) ? title : `${title}.`}”` });
	}

	runs(): Run[] {
		const out: Run[] = [];
		this.sentences.forEach((sentence, i) => {
			if (i) out.push({ text: ' ' });
			const last = sentence.at(-1)!;
			out.push(...sentence.slice(0, -1));
			if (ENDS_SENTENCE.test(last.text)) out.push(last);
			else if (last.italic) out.push(last, { text: '.' });
			else out.push({ ...last, text: `${last.text}.` });
		});
		return out;
	}
}

function publication(ref: Reference): string | null {
	const place = ref['publisher-place'];
	const publisher = ref.publisher;
	const when = year(ref.issued);
	const where = place && publisher ? `${place}: ${publisher}` : (place ?? publisher);
	if (where && when) return `${where}, ${when}`;
	return where ?? (when !== undefined ? String(when) : null);
}

function link(ref: Reference): string | null {
	if (ref.DOI) return ref.DOI.startsWith('http') ? ref.DOI : `https://doi.org/${ref.DOI}`;
	return ref.URL ?? null;
}

export function citation(ref: Reference, lang: string, t: Translate): Run[] {
	const entry = new Entry(lang);
	const authors = ref.author ?? [];
	const editors = ref.editor ?? [];
	const translators = ref.translator ?? [];
	const edBy = !authors.length && editors.length; // the editors lead the entry
	if (authors.length) entry.add(leading(authors, lang, t));
	else if (edBy) entry.add(`${leading(editors, lang, t)}, ${t(editors.length > 1 ? 'citation.eds' : 'citation.ed')}`);

	const original = ref['original-title'] ? ` [${ref['original-title']}]` : '';
	const inBook = ref.type === 'chapter' || ref.type === 'article-journal';
	if (inBook || ref.type === 'thesis' || ref.type === 'manuscript') entry.quotedTitle(ref.title + original);
	else entry.add({ text: ref.title, italic: true }, original);

	if (ref.type === 'chapter') {
		const container = ref['container-title'];
		const editedIn = editors.length ? `, ${t('citation.edited_by_in', { names: natural(editors, lang, t) })}` : '';
		if (container)
			entry.add(`${t('citation.in')} `, { text: container, italic: true }, editedIn, ref.page ? `, ${ref.page}` : '');
	} else if (ref.type === 'article-journal') {
		const journal = ref['container-title'];
		const numbers = [ref.volume, ref.issue && t('citation.no', { n: ref.issue })].filter(Boolean).join(', ');
		const when = year(ref.issued);
		const tail = `${numbers ? ` ${numbers}` : ''}${when !== undefined ? ` (${when})` : ''}${ref.page ? `: ${ref.page}` : ''}`;
		entry.add(journal ? { text: journal, italic: true } : null, journal ? tail : tail.replace(/^:? /, ''));
	} else if (editors.length && !edBy) {
		entry.add(t('citation.edited_by', { names: natural(editors, lang, t) }));
	}
	if (translators.length) entry.add(t('citation.translated_by', { names: natural(translators, lang, t) }));
	if (ref.edition) entry.add(edition(ref.edition, lang, t));
	if (ref.volume && ref.type !== 'article-journal') entry.add(t('citation.vol', { n: ref.volume }));
	if (ref['collection-title']) entry.add([ref['collection-title'], ref['collection-number']].filter(Boolean).join(' '));

	if (ref.type === 'thesis') {
		entry.add([ref.genre, ref.publisher, year(ref.issued)].filter(Boolean).join(', '));
	} else if (ref.type === 'manuscript') {
		const when = year(ref.issued);
		entry.add([ref.genre ?? t('citation.manuscript'), when].filter(Boolean).join(', '));
		entry.add([ref.archive, ref['archive-place']].filter(Boolean).join(', '));
	} else if (ref.type !== 'article-journal') {
		entry.add(publication(ref));
	}
	const first = year(ref['original-date']);
	if (first !== undefined) entry.add(t('citation.first_published', { year: first }));
	entry.add(link(ref));
	return entry.runs();
}

/** The entry as plain text (titles without their italics). */
export const citationText = (runs: Run[]) => runs.map((r) => r.text).join('');

/** Who wrote it, for a list's short line: the authors, else the editors (natural order). */
export function creators(ref: Reference, lang: string, t: Translate): string {
	const names = ref.author?.length ? ref.author : (ref.editor ?? []);
	return names.length ? natural(names, lang, t) : '';
}
