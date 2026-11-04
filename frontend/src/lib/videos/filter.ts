// The Videos page's filter and sort: what the pane offers (taken from the videos
// themselves), which videos a filter keeps, their order, and the choice kept on this
// device. Pure functions but load/save (localStorage). Only the video's own tags (not
// its segments').
import type { Tag, VideoRow } from '../api/types';
import {
	bounds,
	dayOf,
	effectiveTags,
	isRange,
	load,
	narrowed,
	parseNames,
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

export { dayOf, formatDay, type Range, type TagFilter, type TagOption } from '../filters/common';

export type SortKey = 'uploaded_at' | 'duration';
export type SortDir = 'asc' | 'desc';
export interface Sort {
	key: SortKey;
	dir: SortDir;
}
export const SORT_KEYS: readonly SortKey[] = ['uploaded_at', 'duration'];

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

export interface FilterOptions {
	duration: Range | null; // null: no video has a duration
	uploadedAt: Range | null; // null: no video
	uploaders: (string | null)[]; // sorted by name, unknown last
	tags: TagOption[]; // in /api/tags's order (by name)
}

const seconds = (v: Pick<VideoRow, 'duration_s'>) => (v.duration_s == null ? null : Math.floor(v.duration_s));

/** What the pane offers: the bounds and values found among these videos. Tags no video uses are left out. */
export function filterOptions(videos: VideoRow[], tags: Tag[]): FilterOptions {
	return {
		duration: bounds(videos.map(seconds).filter((s) => s !== null)),
		uploadedAt: bounds(videos.map((v) => dayOf(v.uploaded_at))),
		uploaders: sortNames(videos.map((v) => v.uploaded_by)),
		tags: tagOptions(videos, tags)
	};
}

/** The criteria that still apply to these options: full ranges, values or tags no longer offered dropped. */
export function effective(filter: VideoFilter, options: FilterOptions): VideoFilter {
	return {
		sort: filter.sort,
		duration: narrowed(filter.duration, options.duration),
		uploadedAt: narrowed(filter.uploadedAt, options.uploadedAt),
		uploadedBy: filter.uploadedBy.filter((name) => options.uploaders.includes(name)),
		tags: effectiveTags(filter.tags, options.tags)
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

/** Whether a video passes an EFFECTIVE filter: every criterion (AND), any of the values chosen in one (OR). */
export function matches(video: VideoRow, filter: VideoFilter): boolean {
	return (
		(!filter.duration || within(seconds(video), filter.duration)) &&
		(!filter.uploadedAt || within(dayOf(video.uploaded_at), filter.uploadedAt)) &&
		(!filter.uploadedBy.length || filter.uploadedBy.includes(video.uploaded_by)) &&
		tagsMatch(video, filter.tags)
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
	filter.uploadedBy = parseNames(o.uploadedBy);
	filter.tags = parseTags(o.tags);
	return filter;
}

export const loadFilter = (): VideoFilter => load(STORAGE_KEY, parseFilter);
export const saveFilter = (filter: VideoFilter): void => save(STORAGE_KEY, filter);
