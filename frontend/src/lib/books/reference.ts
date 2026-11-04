// The reference form's model: which fields each type of work asks for, a draft as the
// form edits it (plain strings, names as rows, dates as "YYYY[-MM[-DD]]"), and the CSL
// item sent to the server (only the fields of its type, nothing empty). Pure: the form
// (ReferenceForm.svelte) binds to a draft; the server checks the CSL item again.
import type { Reference, ReferenceDate, ReferenceName } from '../api/types';
import type { MessageKey } from '../i18n.svelte';
import { rules } from '../validation';

export type RefType = Reference['type'];
export const TYPES: readonly RefType[] = ['book', 'chapter', 'article-journal', 'thesis', 'manuscript'];

export type Role = 'author' | 'editor' | 'translator';
export const ROLES: readonly Role[] = ['author', 'editor', 'translator'];

/** Text fields (CSL names), in the form's order. */
export type TextField =
	| 'title'
	| 'original-title'
	| 'container-title'
	| 'edition'
	| 'volume'
	| 'issue'
	| 'page'
	| 'collection-title'
	| 'collection-number'
	| 'genre'
	| 'publisher'
	| 'publisher-place'
	| 'archive'
	| 'archive-place'
	| 'issued'
	| 'original-date'
	| 'number-of-pages'
	| 'ISBN'
	| 'ISSN'
	| 'DOI'
	| 'URL'
	| 'language'
	| 'note';

export const DATE_FIELDS: readonly TextField[] = ['issued', 'original-date'];

/** The fields each type asks for (title first; the rest as Chicago orders them). */
export const FIELDS: Record<RefType, readonly TextField[]> = {
	book: [
		'title',
		'original-title',
		'edition',
		'volume',
		'collection-title',
		'collection-number',
		'publisher',
		'publisher-place',
		'issued',
		'original-date',
		'number-of-pages',
		'ISBN',
		'DOI',
		'URL',
		'language',
		'note'
	],
	chapter: [
		'title',
		'original-title',
		'container-title',
		'page',
		'edition',
		'volume',
		'collection-title',
		'publisher',
		'publisher-place',
		'issued',
		'ISBN',
		'DOI',
		'URL',
		'language',
		'note'
	],
	'article-journal': [
		'title',
		'original-title',
		'container-title',
		'volume',
		'issue',
		'page',
		'issued',
		'ISSN',
		'DOI',
		'URL',
		'language',
		'note'
	],
	thesis: [
		'title',
		'original-title',
		'genre',
		'publisher',
		'issued',
		'number-of-pages',
		'DOI',
		'URL',
		'language',
		'note'
	],
	manuscript: ['title', 'original-title', 'genre', 'issued', 'archive', 'archive-place', 'URL', 'language', 'note']
};

/** Which rule of validation.json a field follows (lengths, patterns). */
export function ruleOf(field: TextField) {
	if (field === 'URL') return rules.reference_url;
	if (field === 'language') return rules.reference_language;
	if (field === 'note') return rules.reference_note;
	if (['edition', 'volume', 'issue', 'page', 'collection-number', 'genre', 'number-of-pages'].includes(field))
		return rules.reference_short;
	if (['ISBN', 'ISSN', 'DOI'].includes(field)) return rules.reference_short;
	return rules.reference_text;
}

export interface NameRow {
	role: Role;
	family: string;
	given: string;
	/** Written as is (an organisation, a single name, a Japanese name family name first): `family` only. */
	literal: boolean;
}

export interface ReferenceDraft {
	type: RefType;
	fields: Partial<Record<TextField, string>>;
	names: NameRow[];
}

export const emptyName = (role: Role = 'author'): NameRow => ({ role, family: '', given: '', literal: false });

export function emptyDraft(): ReferenceDraft {
	return { type: 'book', fields: {}, names: [emptyName()] };
}

/** A draft from what the PDF says about itself (both often missing or wrong: the user checks). */
export function draftFromPdf(title: string | null, author: string | null): ReferenceDraft {
	const draft = emptyDraft();
	if (title) draft.fields.title = title;
	if (author) draft.names = [{ ...emptyName(), family: author, literal: true }];
	return draft;
}

const DATE = /^([0-9]{1,4})(?:-([0-9]{1,2})(?:-([0-9]{1,2}))?)?$/;

/** "1981", "1981-05", "1981-05-12" → CSL; null if not a date. */
export function parseDate(text: string): ReferenceDate | null {
	const m = DATE.exec(text.trim());
	if (!m) return null;
	const parts = m
		.slice(1)
		.filter((p) => p !== undefined)
		.map(Number);
	const [y, mo, d] = parts;
	if (y < 1 || (mo !== undefined && (mo < 1 || mo > 12)) || (d !== undefined && (d < 1 || d > 31))) return null;
	return { 'date-parts': [parts] };
}

export function formatDate(date: ReferenceDate | null | undefined): string {
	const parts = date?.['date-parts'][0] ?? [];
	return parts.map((p, i) => (i ? String(p).padStart(2, '0') : String(p))).join('-');
}

function nameOf(row: NameRow): ReferenceName | null {
	const family = row.family.trim();
	const given = row.given.trim();
	if (!family) return null;
	if (row.literal) return { literal: family };
	return given ? { family, given } : { family };
}

/** What is wrong with the draft, field by field (message keys); empty when it can be sent. */
export function problems(draft: ReferenceDraft): Partial<Record<TextField | 'names', MessageKey>> {
	const out: Partial<Record<TextField | 'names', MessageKey>> = {};
	for (const field of FIELDS[draft.type]) {
		const value = draft.fields[field]?.trim() ?? '';
		if (field === 'title' && !value) out.title = 'books.reference.title_missing';
		if (!value) continue;
		const rule = ruleOf(field);
		if (DATE_FIELDS.includes(field)) {
			if (!parseDate(value)) out[field] = 'books.reference.date_invalid';
		} else if (value.length > rule.max_length) out[field] = 'books.reference.too_long';
		else if ('pattern' in rule && !new RegExp(rule.pattern as string, 'v').test(value))
			out[field] = 'books.reference.invalid';
	}
	if (draft.names.some((n) => !n.family.trim() && n.given.trim())) out.names = 'books.reference.family_missing';
	return out;
}

/** The CSL item: the type's fields that are filled in, the names by role (rows left empty dropped). */
export function toReference(draft: ReferenceDraft): Reference {
	const ref: Record<string, unknown> = { type: draft.type };
	for (const field of FIELDS[draft.type]) {
		const value = draft.fields[field]?.trim();
		if (!value) continue;
		ref[field] = DATE_FIELDS.includes(field) ? parseDate(value) : value;
	}
	for (const role of ROLES) {
		const names = draft.names.filter((n) => n.role === role).flatMap((n) => nameOf(n) ?? []);
		if (names.length) ref[role] = names;
	}
	return ref as Reference;
}

/** A stored reference as a draft (editing a book's reference). */
export function toDraft(ref: Reference): ReferenceDraft {
	const fields: Partial<Record<TextField, string>> = {};
	for (const field of FIELDS[ref.type]) {
		const value = ref[field as keyof Reference];
		if (value === null || value === undefined) continue;
		fields[field] = DATE_FIELDS.includes(field) ? formatDate(value as ReferenceDate) : String(value);
	}
	const names = ROLES.flatMap((role) =>
		(ref[role] ?? []).map((n) => ({
			role,
			family: n.literal ?? n.family ?? '',
			given: n.literal ? '' : (n.given ?? ''),
			literal: !!n.literal
		}))
	);
	return { type: ref.type, fields, names };
}
