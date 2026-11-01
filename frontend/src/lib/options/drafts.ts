// The Options page's tag drafts: a tag as the form edits it (texts per language, the
// bounds as typed), what it would send, and what stops it from being saved. Pure
// functions (unit-tested); the page's state and actions: routes/(app)/options/tags.svelte.ts.
import { LANGUAGES, type Lang, type MessageKey } from '../i18n.svelte';
import { compilePattern, type TagRule } from '../tags';
import { rules } from '../validation';
import type { TagDefinition, TagDefinitionIn } from '../api/types';

export type Texts = Record<Lang, string>;
/** The format select: the API's formats, and 'none' (no value: null in the API). */
export type FormatChoice = 'list' | 'regexp' | 'free' | 'none';
export const FORMATS: FormatChoice[] = ['list', 'regexp', 'free', 'none'];

export const LANGS = Object.keys(LANGUAGES) as Lang[];

export interface ValueDraft {
	key: number;
	id: string;
	/** Its ID on the server (a rename sends it); null: a new value. */
	previousId: string | null;
	names: Texts;
	used: number;
}

export interface TagDraft {
	key: number;
	/** Its ID on the server; null: a new tag. */
	savedId: string | null;
	id: string;
	names: Texts;
	format: FormatChoice;
	regexp: string;
	hint: Texts;
	inputMode: 'text' | 'numeric';
	min: string;
	max: string;
	values: ValueDraft[];
	used: number;
	/** What it sent when it was loaded or saved ('' for a new tag): tells a change. */
	original: string;
}

let lastKey = 0;
const nextKey = () => ++lastKey;

const texts = (from?: Partial<Record<string, string>> | null): Texts =>
	Object.fromEntries(LANGS.map((lang) => [lang, from?.[lang] ?? ''])) as Texts;
const trimmed = (t: Texts): Texts => Object.fromEntries(LANGS.map((lang) => [lang, t[lang].trim()])) as Texts;
const filled = (t: Texts) => LANGS.every((lang) => t[lang].trim());
const blank = (t: Texts) => LANGS.every((lang) => !t[lang].trim());
const INTEGER = /^-?[0-9]+$/;
const integer = (text: string) => (INTEGER.test(text.trim()) ? Number(text.trim()) : null);
const matches = (rule: { pattern?: string; max_length: number; min_length: number }, text: string) =>
	text.length >= rule.min_length &&
	text.length <= rule.max_length &&
	(!rule.pattern || new RegExp(rule.pattern, 'v').test(text));

export function newValue(): ValueDraft {
	return { key: nextKey(), id: '', previousId: null, names: texts(), used: 0 };
}

export function newDraft(): TagDraft {
	return {
		key: nextKey(),
		savedId: null,
		id: '',
		names: texts(),
		format: 'list',
		regexp: '',
		hint: texts(),
		inputMode: 'text',
		min: '',
		max: '',
		values: [],
		used: 0,
		original: ''
	};
}

/** A tag from the server, as the form edits it (`key`: keep the one it had on screen). */
export function toDraft(tag: TagDefinition, key = nextKey()): TagDraft {
	const draft: TagDraft = {
		key,
		savedId: tag.id,
		id: tag.id,
		names: texts(tag.names),
		format: tag.format ?? 'none',
		regexp: tag.regexp ?? '',
		hint: texts(tag.hint),
		inputMode: tag.input_mode,
		min: tag.min == null ? '' : String(tag.min),
		max: tag.max == null ? '' : String(tag.max),
		values: tag.values.map((v) => ({
			key: nextKey(),
			id: v.id,
			previousId: v.id,
			names: texts(v.names),
			used: v.used
		})),
		used: tag.used,
		original: ''
	};
	draft.original = JSON.stringify(toBody(draft));
	return draft;
}

const textual = (d: TagDraft) => d.format === 'regexp' || d.format === 'free';
const numeric = (d: TagDraft) => textual(d) && d.inputMode === 'numeric';

/** What the form sends (the server drops the fields of other formats too). */
export function toBody(d: TagDraft): TagDefinitionIn {
	return {
		id: d.id.trim(),
		names: trimmed(d.names),
		format: d.format === 'none' ? null : d.format,
		regexp: d.format === 'regexp' ? d.regexp : null,
		hint: textual(d) && !blank(d.hint) ? trimmed(d.hint) : null,
		input_mode: textual(d) ? d.inputMode : 'text',
		min: numeric(d) ? integer(d.min) : null,
		max: numeric(d) ? integer(d.max) : null,
		values:
			d.format === 'list'
				? d.values.map((v) => ({ id: v.id.trim(), previous_id: v.previousId, names: trimmed(v.names) }))
				: []
	};
}

export const changed = (d: TagDraft) => JSON.stringify(toBody(d)) !== d.original;

/** Why it cannot be saved yet (messages): empty when it can. The server checks again. */
export function problems(d: TagDraft): MessageKey[] {
	const out: MessageKey[] = [];
	if (!matches(rules.tag_id, d.id.trim())) out.push('options.tags.problem.id');
	if (!filled(d.names)) out.push('options.tags.problem.names');
	if (
		d.format === 'regexp' &&
		(!d.regexp || d.regexp.length > rules.tag_regexp.max_length || !compilePattern(d.regexp))
	)
		out.push('options.tags.problem.regexp');
	if (textual(d) && !filled(d.hint) && !blank(d.hint)) out.push('options.tags.problem.hint');
	if (numeric(d)) {
		const [min, max] = [integer(d.min), integer(d.max)];
		if ((d.min.trim() && min === null) || (d.max.trim() && max === null) || (min !== null && max !== null && min > max))
			out.push('options.tags.problem.range');
	}
	if (d.format === 'list') {
		if (d.values.some((v) => !matches(rules.tag_value_id, v.id.trim()))) out.push('options.tags.problem.value_id');
		if (d.values.some((v) => !filled(v.names))) out.push('options.tags.problem.value_names');
		const ids = d.values.map((v) => v.id.trim());
		if (new Set(ids).size !== ids.length) out.push('options.tags.problem.duplicate');
	}
	return out;
}

/** The rule the draft would have, for the test field (as the upload page would check). */
export function ruleOf(d: TagDraft, lang: Lang): TagRule {
	const body = toBody(d);
	return {
		format: body.format,
		values: d.values.map((v) => ({ id: v.id.trim(), name: v.names[lang] })),
		pattern: body.regexp,
		min: body.min,
		max: body.max
	};
}

/** Values whose ID or a name contains `filter` (case and accents ignored). */
export function filterValues(values: ValueDraft[], filter: string): ValueDraft[] {
	const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
	const wanted = fold(filter.trim());
	if (!wanted) return values;
	return values.filter((v) => [v.id, ...LANGS.map((lang) => v.names[lang])].some((s) => fold(s).includes(wanted)));
}

/** What a tag form calls (the page's TagOptions). */
export interface TagActions {
	busy: boolean;
	errors: Record<number, unknown>;
	saved: Record<number, boolean>;
	save(draft: TagDraft): Promise<boolean>;
	discard(draft: TagDraft): void;
	remove(draft: TagDraft): Promise<boolean>;
	addValue(draft: TagDraft): void;
	removeValue(draft: TagDraft, value: ValueDraft): void;
}
