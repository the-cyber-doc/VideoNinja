// What the Videos and Books filters share: ranges, days, tag criteria (what a filter pane
// offers for each tag the items use, which criteria still apply, whether an item passes),
// lists of names, and the choice kept on this device. Pure functions but load/save
// (localStorage). Items carry their own tags (never their segments').
import type { Tag, TagIn } from '../api/types';

/** Both ends included. */
export type Range = [number, number];

/** One tag's criterion, by the kind of input the pane shows for it. */
export type TagFilter = { values: string[] } | { range: Range } | { text: string } | { present: boolean };

/** What the pane offers for a tag the items use. */
export type TagOption =
	| { kind: 'list'; tag: Tag; values: { id: string; name: string }[] } // the values used, sorted by name
	| { kind: 'range'; tag: Tag; min: number; max: number } // numeric values
	| { kind: 'text'; tag: Tag } // other text values: contains
	| { kind: 'present'; tag: Tag }; // a tag without value

export interface Tagged {
	tags: TagIn[];
}

const DAY_MS = 86_400_000;
const NUMBER = /^-?[0-9]+$/;

/** The day of a date in the browser's timezone, as a number of days (the slider's value). */
export function dayOf(iso: string): number {
	const d = new Date(Date.parse(iso));
	return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

/** A day (dayOf) as a date in that language. */
export const formatDay = (day: number, lang: string) =>
	new Date(day * DAY_MS).toLocaleDateString(lang, { timeZone: 'UTC' });

export function bounds(numbers: number[]): Range | null {
	return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
}

/** null when the range covers the whole of `full` (it then keeps every item, even those without a value). */
export function narrowed(range: Range | null, full: Range | null): Range | null {
	if (!range || !full || (range[0] <= full[0] && range[1] >= full[1])) return null;
	return range;
}

export const within = (n: number | null | undefined, range: Range) =>
	n !== null && n !== undefined && n >= range[0] && n <= range[1];

/** Display names sorted, null (unknown or deleted) last. */
export const sortNames = (names: (string | null)[]) =>
	[...new Set(names)].sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b)));

const valuesOf = (items: Tagged[], tag: string) =>
	items.flatMap((item) => item.tags.filter((t) => t.id === tag).map((t) => t.value ?? ''));

function tagOption(tag: Tag, used: string[]): TagOption {
	if (tag.format === 'list') {
		return { kind: 'list', tag, values: (tag.values ?? []).filter((v) => used.includes(v.id)) };
	}
	if (!tag.format) return { kind: 'present', tag };
	const numeric = tag.input_mode === 'numeric' || tag.min != null || tag.max != null;
	if (numeric && used.every((v) => NUMBER.test(v))) {
		const [min, max] = bounds(used.map(Number)) as Range; // used: never empty
		return { kind: 'range', tag, min, max };
	}
	return { kind: 'text', tag };
}

/** One option per tag the items use, in /api/tags's order (by name); the others left out. */
export function tagOptions(items: Tagged[], tags: Tag[]): TagOption[] {
	return tags.flatMap((tag) => {
		const used = valuesOf(items, tag.id);
		return used.length ? [tagOption(tag, used)] : [];
	});
}

/** The tag criteria that still apply to these options: full ranges, values or tags no longer offered dropped. */
export function effectiveTags(chosen: Record<string, TagFilter>, options: TagOption[]): Record<string, TagFilter> {
	const tags: Record<string, TagFilter> = {};
	for (const option of options) {
		const f = chosen[option.tag.id];
		if (!f) continue;
		if (option.kind === 'list' && 'values' in f) {
			const values = f.values.filter((id) => option.values.some((v) => v.id === id));
			if (values.length) tags[option.tag.id] = { values };
		} else if (option.kind === 'range' && 'range' in f) {
			const range = narrowed(f.range, [option.min, option.max]);
			if (range) tags[option.tag.id] = { range };
		} else if (option.kind === 'text' && 'text' in f) {
			if (f.text.trim()) tags[option.tag.id] = { text: f.text.trim() };
		} else if (option.kind === 'present' && 'present' in f && f.present) {
			tags[option.tag.id] = { present: true };
		}
	}
	return tags;
}

function tagMatches(item: Tagged, tag: string, f: TagFilter): boolean {
	const values = item.tags.filter((t) => t.id === tag).map((t) => t.value ?? '');
	if ('values' in f) return values.some((v) => f.values.includes(v));
	if ('range' in f) return values.some((v) => NUMBER.test(v) && within(Number(v), f.range));
	if ('text' in f) return values.some((v) => v.toLowerCase().includes(f.text.toLowerCase()));
	return values.length > 0;
}

/** Whether an item passes every effective tag criterion. */
export const tagsMatch = (item: Tagged, tags: Record<string, TagFilter>) =>
	Object.entries(tags).every(([tag, f]) => tagMatches(item, tag, f));

// --- kept on this device ---

export const isRange = (r: unknown): r is Range =>
	Array.isArray(r) && r.length === 2 && r.every((n) => typeof n === 'number' && Number.isFinite(n)) && r[0] <= r[1];

function isTagFilter(f: unknown): f is TagFilter {
	if (typeof f !== 'object' || f === null) return false;
	const o = f as Record<string, unknown>;
	return (
		(Array.isArray(o.values) && o.values.every((v) => typeof v === 'string')) ||
		isRange(o.range) ||
		typeof o.text === 'string' ||
		typeof o.present === 'boolean'
	);
}

/** Stored tag criteria, each checked: what is not understood is dropped. */
export function parseTags(raw: unknown): Record<string, TagFilter> {
	const tags: Record<string, TagFilter> = {};
	if (typeof raw === 'object' && raw !== null) {
		for (const [id, f] of Object.entries(raw)) if (isTagFilter(f)) tags[id] = f;
	}
	return tags;
}

/** A stored list of names (null: unknown or deleted). */
export const parseNames = (raw: unknown): (string | null)[] =>
	Array.isArray(raw) ? raw.filter((n) => n === null || typeof n === 'string') : [];

/** A stored list of strings. */
export const parseStrings = (raw: unknown): string[] =>
	Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];

export function load<T>(key: string, parse: (raw: unknown) => T): T {
	try {
		return parse(JSON.parse(localStorage.getItem(key) ?? 'null'));
	} catch {
		return parse(null); // storage blocked, or not JSON: the default
	}
}

export function save(key: string, value: unknown): void {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// storage blocked (private mode, site data disabled): kept for this visit only
	}
}
