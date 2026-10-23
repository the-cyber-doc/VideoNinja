import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog.svelte';
import { toAnnotation, toAnnotations, videoSection, type Annotations } from './annotations';

const catalog = {
	schools: [],
	levels: [],
	techniques: [{ id: 'gyokko.koku', kanji: '虚空', romaji: 'Koku', ryu: 'gyokko', level: 'shoden' }],
	segments: []
} as Catalog;

describe('sections', () => {
	it.each([
		[3, false, 'in_progress'],
		[0, false, 'to_annotate'],
		[3, true, 'complete'],
		[0, true, 'no_technique']
	] as const)('%i segments, done %s: %s', (segment_count, all_segments_done, section) =>
		expect(videoSection({ segment_count, all_segments_done })).toBe(section)
	);
});

describe('annotations <-> the panel', () => {
	const saved: Annotations = {
		all_segments_done: false,
		tags: [{ id: 'note', value: null as unknown as string }, { id: 'place', value: 'dojo' }],
		segments: [{ id: 4, begin_s: 12, end_s: 27, technique: 'gyokko.koku', performer: 'hatsumi', tags: [] }]
	};

	it('school and level from the catalogue, the ID kept, empty values dropped', () => {
		expect(toAnnotation(saved, catalog)).toEqual({
			mode: null,
			allSegmentsDone: false,
			tags: [{ id: 'note' }, { id: 'place', value: 'dojo' }],
			segments: [
				{ key: 1, id: 4, begin: 12, end: 27, school: 'gyokko', level: 'shoden', technique: 'gyokko.koku', performer: 'hatsumi', tags: [] }
			]
		});
	});

	it('no segment: "define later" or "no technique"', () => {
		expect(toAnnotation({ ...saved, segments: [] }, catalog).mode).toBe('later');
		expect(toAnnotation({ ...saved, segments: [], all_segments_done: true }, catalog).mode).toBe('none');
	});

	it('back to the server: IDs kept, new segments without one, whole seconds', () => {
		const annotation = toAnnotation(saved, catalog);
		annotation.segments.push({ ...annotation.segments[0], key: 2, id: undefined, begin: 30.4, end: 40.2 });
		annotation.allSegmentsDone = true;
		expect(toAnnotations(annotation)).toEqual({
			all_segments_done: true,
			tags: [{ id: 'note' }, { id: 'place', value: 'dojo' }],
			segments: [
				{ id: 4, begin_s: 12, end_s: 27, technique: 'gyokko.koku', performer: 'hatsumi', tags: [] },
				{ begin_s: 30, end_s: 41, technique: 'gyokko.koku', performer: 'hatsumi', tags: [] }
			]
		});
	});

	it('"define later" is never complete; "no technique" always', () => {
		expect(toAnnotations({ ...toAnnotation(saved, catalog), mode: 'later', allSegmentsDone: true }).all_segments_done).toBe(false);
		expect(toAnnotations({ mode: 'none', allSegmentsDone: false, segments: [], tags: [] }).all_segments_done).toBe(true);
	});
});
