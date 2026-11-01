// The Videos page's filter and sort: what the pane offers (taken from the videos
// themselves), which videos a filter keeps, their order, and the choice kept on this
// device. Pure functions but load/save (localStorage). Only the video's own tags (not
// its segments').
import type { Tag, VideoRow } from '../api/types';

export type SortKey = 'uploaded_at' | 'duration';
export type SortDir = 'asc' | 'desc';
export interface Sort {
	key: SortKey;
	dir: SortDir;
}
export const SORT_KEYS: readonly SortKey[] = ['uploaded_at', 'duration'];

/** Both ends included. */
export type Range = [number, number];

/** One tag's criterion, by the kind of input the pane shows for it. */
export type TagFilter = { values: string[] } | { range: Range } | { text: string } | { present: boolean };

export interface VideoFilter {
	sort: Sort;
	duration: Range | null; // whole seconds; null: any
	uploadedAt: Range | null; // days (dayOf); null: any
	uploadedBy: (string | null)[]; // display names, null = unknown or deleted; empty: anyone
	tags: Record<string, TagFilter>;
}

export const DEFAULT_SORT: Sort = { key: 'uploaded_at', dir: 'desc' };
export const emptyFilter = (): VideoFilter => ({
	sort: { ...DEFAULT_SORT },
	duration: null,
	uploadedAt: null,
	uploadedBy: [],
	tags: {}
});

/** What the pane offers for a tag the videos use. */
export type TagOption =
	| { kind: 'list'; tag: Tag; values: { id: string; name: string }[] } // the values used, sorted by name
	| { kind: 'range'; tag: Tag; min: number; max: number } // numeric values
	| { kind: 'text'; tag: Tag } // other text values: contains
	| { kind: 'present'; tag: Tag }; // a tag without value

export interface FilterOptions {
	duration: Range | null; // null: no video has a duration
	uploadedAt: Range | null; // null: no video
	uploaders: (string | null)[]; // sorted by name, unknown last
	tags: TagOption[]; // in /api/tags's order (by name)
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

const seconds = (v: Pick<VideoRow, 'duration_s'>) => (v.duration_s == null ? null : Math.floor(v.duration_s));

function bounds(numbers: number[]): Range | null {
	return numbers.length ? [Math.min(...numbers), Math.max(...numbers)] : null;
}

const valuesOf = (videos: VideoRow[], tag: string) =>
	videos.flatMap((v) => v.tags.filter((t) => t.id === tag).map((t) => t.value ?? ''));

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

/** What the pane offers: the bounds and values found among these videos. Tags no video uses are left out. */
export function filterOptions(videos: VideoRow[], tags: Tag[]): FilterOptions {
	const names = [...new Set(videos.map((v) => v.uploaded_by))];
	return {
		duration: bounds(videos.map(seconds).filter((s) => s !== null)),
		uploadedAt: bounds(videos.map((v) => dayOf(v.uploaded_at))),
		uploaders: names.sort((a, b) => (a === null ? 1 : b === null ? -1 : a.localeCompare(b))),
		tags: tags.flatMap((tag) => {
			const used = valuesOf(videos, tag.id);
			return used.length ? [tagOption(tag, used)] : []; // one entry per video using it
		})
	};
}

/** null when the range covers the whole of `full` (it then keeps every video, even those without a value). */
function narrowed(range: Range | null, full: Range | null): Range | null {
	if (!range || !full || (range[0] <= full[0] && range[1] >= full[1])) return null;
	return range;
}

/** The criteria that still apply to these options: full ranges, values or tags no longer offered dropped. */
export function effective(filter: VideoFilter, options: FilterOptions): VideoFilter {
	const tags: Record<string, TagFilter> = {};
	for (const option of options.tags) {
		const f = filter.tags[option.tag.id];
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
	return {
		sort: filter.sort,
		duration: narrowed(filter.duration, options.duration),
		uploadedAt: narrowed(filter.uploadedAt, options.uploadedAt),
		uploadedBy: filter.uploadedBy.filter((name) => options.uploaders.includes(name)),
		tags
	};
}

/** The number of criteria of an effective filter, and 1 more for an order other than the default. */
export function activeCount(filter: VideoFilter): number {
	const sorted = filter.sort.key !== DEFAULT_SORT.key || filter.sort.dir !== DEFAULT_SORT.dir;
	return (
		Number(sorted) +
		Number(filter.duration !== null) +
		Number(filter.uploadedAt !== null) +
		Number(filter.uploadedBy.length > 0) +
		Object.keys(filter.tags).length
	);
}

const within = (n: number | null, range: Range) => n !== null && n >= range[0] && n <= range[1];

function tagMatches(video: VideoRow, tag: string, f: TagFilter): boolean {
	const values = video.tags.filter((t) => t.id === tag).map((t) => t.value ?? '');
	if ('values' in f) return values.some((v) => f.values.includes(v));
	if ('range' in f) return values.some((v) => NUMBER.test(v) && within(Number(v), f.range));
	if ('text' in f) return values.some((v) => v.toLowerCase().includes(f.text.toLowerCase()));
	return values.length > 0;
}

/** Whether a video passes an EFFECTIVE filter: every criterion (AND), any of the values chosen in one (OR). */
export function matches(video: VideoRow, filter: VideoFilter): boolean {
	return (
		(!filter.duration || within(seconds(video), filter.duration)) &&
		(!filter.uploadedAt || within(dayOf(video.uploaded_at), filter.uploadedAt)) &&
		(!filter.uploadedBy.length || filter.uploadedBy.includes(video.uploaded_by)) &&
		Object.entries(filter.tags).every(([tag, f]) => tagMatches(video, tag, f))
	);
}

/**
 * A copy in that order; videos without a duration last either way. Same upload time (to the
 * second): by ID, the upload order, in the same direction. Same duration: the server's order.
 */
export function sortVideos(videos: VideoRow[], sort: Sort): VideoRow[] {
	const sign = sort.dir === 'asc' ? 1 : -1;
	return [...videos].sort((a, b) => {
		if (sort.key === 'uploaded_at') {
			return (Date.parse(a.uploaded_at) - Date.parse(b.uploaded_at) || a.id - b.id) * sign;
		}
		const [x, y] = [a.duration_s, b.duration_s];
		if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
		return (x - y) * sign; // a stable sort: equal durations stay in order
	});
}

// Kept on this device (the page is left for a video's annotation, then back).
const STORAGE_KEY = 'videos.filter';

const isRange = (r: unknown): r is Range =>
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

/** A stored filter, checked part by part: what is not understood is the default. */
export function parseFilter(raw: unknown): VideoFilter {
	const filter = emptyFilter();
	if (typeof raw !== 'object' || raw === null) return filter;
	const o = raw as Record<string, unknown>;
	const sort = o.sort as Partial<Sort> | undefined;
	if (sort && SORT_KEYS.includes(sort.key as SortKey) && (sort.dir === 'asc' || sort.dir === 'desc')) {
		filter.sort = { key: sort.key as SortKey, dir: sort.dir };
	}
	if (isRange(o.duration)) filter.duration = o.duration;
	if (isRange(o.uploadedAt)) filter.uploadedAt = o.uploadedAt;
	if (Array.isArray(o.uploadedBy)) {
		filter.uploadedBy = o.uploadedBy.filter((n) => n === null || typeof n === 'string');
	}
	if (typeof o.tags === 'object' && o.tags !== null) {
		for (const [id, f] of Object.entries(o.tags)) if (isTagFilter(f)) filter.tags[id] = f;
	}
	return filter;
}

export function loadFilter(): VideoFilter {
	try {
		return parseFilter(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
	} catch {
		return emptyFilter(); // storage blocked, or not JSON
	}
}

export function saveFilter(filter: VideoFilter): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(filter));
	} catch {
		// storage blocked (private mode, site data disabled): kept for this visit only
	}
}
