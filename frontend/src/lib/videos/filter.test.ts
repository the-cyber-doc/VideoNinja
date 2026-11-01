import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tag, VideoRow } from '../api/types';
import {
	activeCount,
	dayOf,
	effective,
	emptyFilter,
	filterOptions,
	formatDay,
	loadFilter,
	matches,
	parseFilter,
	saveFilter,
	sortVideos,
	type VideoFilter
} from './filter';

const video = (id: number, over: Partial<VideoRow> = {}): VideoRow => ({
	id,
	original_filename: `v${id}.mp4`,
	uploaded_at: '2027-01-15T09:00:00+00:00',
	duration_s: 60.5,
	all_segments_done: false,
	segment_count: 0,
	uploaded_by: 'Hana',
	tags: [],
	...over
});

const TAGS: Tag[] = [
	{ id: 'archive', name: 'Archive', input_mode: 'text' }, // no value
	{
		id: 'location',
		name: 'Location',
		format: 'list',
		input_mode: 'text',
		values: [
			{ id: 'dojo', name: 'Dojo' },
			{ id: 'noda', name: 'Noda' },
			{ id: 'park', name: 'Park' }
		]
	},
	{ id: 'note', name: 'Note', format: 'free', input_mode: 'text' },
	{ id: 'unused', name: 'Unused', format: 'free', input_mode: 'text' },
	{ id: 'year', name: 'Year', format: 'regexp', pattern: '[12][0-9]{3}', input_mode: 'numeric' },
	{ id: 'level', name: 'Level', format: 'free', input_mode: 'text', min: 1, max: 9 },
	{ id: 'code', name: 'Code', format: 'free', input_mode: 'numeric' } // a value not a number: text
];

const VIDEOS = [
	video(1, {
		duration_s: 30.9,
		uploaded_at: '2027-01-10T12:00:00+00:00',
		tags: [
			{ id: 'location', value: 'noda' },
			{ id: 'year', value: '2019' },
			{ id: 'note', value: 'Ura Gyaku' },
			{ id: 'archive', value: null as unknown as string },
			{ id: 'level', value: '3' },
			{ id: 'code', value: 'x1' }
		]
	}),
	video(2, {
		duration_s: null,
		uploaded_by: null,
		tags: [
			{ id: 'location', value: 'dojo' },
			{ id: 'year', value: '2024' }
		]
	}),
	video(3, { duration_s: 125, uploaded_by: 'Akira', uploaded_at: '2027-01-20T12:00:00+00:00' })
];

const options = filterOptions(VIDEOS, TAGS);
const keep = (f: Partial<VideoFilter>) => {
	const e = effective({ ...emptyFilter(), ...f }, options);
	return VIDEOS.filter((v) => matches(v, e)).map((v) => v.id);
};

describe('options', () => {
	it('bounds, uploaders and the tags used, from the videos', () => {
		expect(options.duration).toEqual([30, 125]);
		expect(options.uploadedAt).toEqual([dayOf(VIDEOS[0].uploaded_at), dayOf(VIDEOS[2].uploaded_at)]);
		expect(options.uploaders).toEqual(['Akira', 'Hana', null]);
		expect(options.tags.map((o) => [o.tag.id, o.kind])).toEqual([
			['archive', 'present'],
			['location', 'list'],
			['note', 'text'],
			['year', 'range'],
			['level', 'range'],
			['code', 'text']
		]);
		expect(options.tags[1]).toMatchObject({ values: [{ id: 'dojo' }, { id: 'noda' }] }); // park: unused
		expect(options.tags[3]).toMatchObject({ min: 2019, max: 2024 });
	});

	it('no video: nothing to offer', () => {
		expect(filterOptions([], TAGS)).toEqual({ duration: null, uploadedAt: null, uploaders: [], tags: [] });
		const [only] = filterOptions(
			[video(1, { tags: [{ id: 'location', value: 'x' }] })],
			[{ ...TAGS[1], values: undefined }]
		).tags;
		expect(only).toMatchObject({ kind: 'list', values: [] });
	});

	it('days in the browser timezone, shown as dates', () => {
		expect(dayOf('2027-01-15T09:00:00+00:00') - dayOf('2027-01-14T09:00:00+00:00')).toBe(1);
		expect(formatDay(dayOf('2027-01-15T12:00:00Z'), 'en-GB')).toBe('15/01/2027');
	});
});

describe('matches', () => {
	it('nothing chosen: every video', () => expect(keep({})).toEqual([1, 2, 3]));

	it('a full range keeps videos without a value, a narrowed one not', () => {
		expect(keep({ duration: [0, 999] })).toEqual([1, 2, 3]);
		expect(keep({ duration: [30, 60] })).toEqual([1]);
		expect(keep({ uploadedAt: [options.uploadedAt![0], options.uploadedAt![0] + 6] })).toEqual([1, 2]);
	});

	it('uploaders: any of those chosen, unknown included', () => {
		expect(keep({ uploadedBy: ['Akira', null] })).toEqual([2, 3]);
		expect(keep({ uploadedBy: ['Gone'] })).toEqual([1, 2, 3]); // no longer offered: dropped
	});

	it('tags by kind, every criterion', () => {
		expect(keep({ tags: { location: { values: ['dojo', 'noda'] } } })).toEqual([1, 2]);
		expect(keep({ tags: { location: { values: ['park'] } } })).toEqual([1, 2, 3]); // not offered
		expect(keep({ tags: { year: { range: [2020, 2030] } } })).toEqual([2]);
		expect(keep({ tags: { year: { range: [2000, 2030] } } })).toEqual([1, 2, 3]); // full
		expect(keep({ tags: { note: { text: ' gyaku ' } } })).toEqual([1]);
		expect(keep({ tags: { note: { text: '  ' } } })).toEqual([1, 2, 3]);
		expect(keep({ tags: { archive: { present: true } } })).toEqual([1]);
		expect(keep({ tags: { archive: { present: false } } })).toEqual([1, 2, 3]);
		expect(keep({ tags: { year: { values: ['2019'] } } })).toEqual([1, 2, 3]); // not this tag's kind
		expect(keep({ tags: { location: { values: ['noda'] }, year: { range: [2020, 2024] } } })).toEqual([]);
		expect(keep({ tags: { level: { range: [1, 2] } } })).toEqual([]);
	});
});

describe('active criteria', () => {
	it('counts each criterion and a sort other than the default', () => {
		expect(activeCount(effective(emptyFilter(), options))).toBe(0);
		const f: VideoFilter = {
			sort: { key: 'duration', dir: 'desc' },
			duration: [30, 60],
			uploadedAt: [0, 1],
			uploadedBy: ['Hana'],
			tags: { archive: { present: true } }
		};
		expect(activeCount(effective(f, options))).toBe(5);
		expect(activeCount({ ...emptyFilter(), sort: { key: 'uploaded_at', dir: 'asc' } })).toBe(1);
	});
});

describe('sort', () => {
	const ids = (key: 'uploaded_at' | 'duration', dir: 'asc' | 'desc') =>
		sortVideos(VIDEOS, { key, dir }).map((v) => v.id);
	it('by upload or duration, unknown durations last; ties: upload order, or as received', () => {
		expect(ids('uploaded_at', 'desc')).toEqual([3, 2, 1]);
		expect(ids('uploaded_at', 'asc')).toEqual([1, 2, 3]);
		expect(ids('duration', 'asc')).toEqual([1, 3, 2]);
		expect(ids('duration', 'desc')).toEqual([3, 1, 2]);
		const tied = [video(1, { duration_s: null }), video(2), video(3, { duration_s: null }), video(4)];
		expect(sortVideos(tied, { key: 'duration', dir: 'asc' }).map((v) => v.id)).toEqual([2, 4, 1, 3]);
		// Uploaded the same second: by ID (the upload order), in the sort's direction.
		const same = [video(5), video(7), video(6)];
		expect(sortVideos(same, { key: 'uploaded_at', dir: 'asc' }).map((v) => v.id)).toEqual([5, 6, 7]);
		expect(sortVideos(same, { key: 'uploaded_at', dir: 'desc' }).map((v) => v.id)).toEqual([7, 6, 5]);
	});
});

describe('kept on this device', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('stored, read back', () => {
		const store = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => store.set(k, v)
		});
		expect(loadFilter()).toEqual(emptyFilter());
		const f: VideoFilter = {
			sort: { key: 'duration', dir: 'asc' },
			duration: [1, 2],
			uploadedAt: [3, 4],
			uploadedBy: ['Hana', null],
			tags: { a: { values: ['x'] }, b: { range: [1, 2] }, c: { text: 'x' }, d: { present: true } }
		};
		saveFilter(f);
		expect(loadFilter()).toEqual(f);
	});

	it('storage blocked or broken: the default, nothing thrown', () => {
		vi.stubGlobal('localStorage', {
			getItem: () => '{not json',
			setItem: () => {
				throw new Error('blocked');
			}
		});
		expect(loadFilter()).toEqual(emptyFilter());
		expect(() => saveFilter(emptyFilter())).not.toThrow();
	});

	it('what is not understood is the default', () => {
		expect(parseFilter(null)).toEqual(emptyFilter());
		expect(parseFilter('x')).toEqual(emptyFilter());
		expect(
			parseFilter({
				sort: { key: 'size', dir: 'asc' },
				duration: [2, 1],
				uploadedAt: [1, 'x'],
				uploadedBy: ['Hana', 3, null],
				tags: { a: { values: [1] }, b: null, c: 'x', d: { range: [Infinity, 2] }, e: { text: 'ok' } }
			})
		).toEqual({ ...emptyFilter(), uploadedBy: ['Hana', null], tags: { e: { text: 'ok' } } });
		expect(parseFilter({ sort: { key: 'duration', dir: 'up' }, tags: null }).sort).toEqual(emptyFilter().sort);
		expect(parseFilter({ uploadedBy: 'Hana', duration: 'x' })).toEqual(emptyFilter());
	});
});
