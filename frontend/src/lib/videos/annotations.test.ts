import { describe, expect, it } from 'vitest';
import type { Catalog } from '../catalog.svelte';
import type { AnnotationsOut } from '../api/types';
import { toAnnotation, toAnnotations, videoSection } from './annotations';

const catalog = {
	schools: [],
	categories: [],
	weapons: [],
	sections: [{ id: 'gyokko.taijutsu.jo_ryaku', kanji: '上略之巻', romaji: 'Jo Ryaku no Maki', ryu: 'gyokko', category: 'taijutsu' }],
	techniques: [{ id: 'gyokko.taijutsu.jo_ryaku.koku', kanji: '虚空', romaji: 'Koku', section: 'gyokko.taijutsu.jo_ryaku' }],
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
	const saved: AnnotationsOut = {
		all_segments_done: false,
		original_filename: 'kata.mov',
		uploaded_by: 'Hana',
		tags: [{ id: 'note', value: null as unknown as string }, { id: 'place', value: 'dojo' }],
		segments: [{ id: 4, begin_s: 12, end_s: 27, technique: 'gyokko.taijutsu.jo_ryaku.koku', performer: 'hatsumi', tags: [], created_by: 'Hana' }]
	};

	it('the path from the catalogue, the ID and author kept, empty values dropped', () => {
		expect(toAnnotation(saved, catalog)).toEqual({
			mode: null,
			allSegmentsDone: false,
			tags: [{ id: 'note' }, { id: 'place', value: 'dojo' }],
			segments: [
				{ key: 1, id: 4, createdBy: 'Hana', begin: 12, end: 27, school: 'gyokko', category: 'taijutsu', weapon: '', section: 'gyokko.taijutsu.jo_ryaku', technique: 'gyokko.taijutsu.jo_ryaku.koku', performer: 'hatsumi', tags: [] }
			]
		});
	});

	it('no segment: "define later" or "no technique"', () => {
		expect(toAnnotation({ ...saved, segments: [] }, catalog).mode).toBe('later');
		expect(toAnnotation({ ...saved, segments: [], all_segments_done: true }, catalog).mode).toBe('none');
	});

	it('back to the server: IDs kept, new segments without one, whole seconds, no author', () => {
		const annotation = toAnnotation(saved, catalog);
		annotation.segments.push({ ...annotation.segments[0], key: 2, id: undefined, createdBy: undefined, begin: 30.4, end: 40.2 });
		annotation.allSegmentsDone = true;
		expect(toAnnotations(annotation)).toEqual({
			all_segments_done: true,
			tags: [{ id: 'note' }, { id: 'place', value: 'dojo' }],
			segments: [
				{ id: 4, begin_s: 12, end_s: 27, technique: 'gyokko.taijutsu.jo_ryaku.koku', performer: 'hatsumi', tags: [] },
				{ begin_s: 30, end_s: 41, technique: 'gyokko.taijutsu.jo_ryaku.koku', performer: 'hatsumi', tags: [] }
			]
		});
	});

	it('"define later" is never complete; "no technique" always', () => {
		expect(toAnnotations({ ...toAnnotation(saved, catalog), mode: 'later', allSegmentsDone: true }).all_segments_done).toBe(false);
		expect(toAnnotations({ mode: 'none', allSegmentsDone: false, segments: [], tags: [] }).all_segments_done).toBe(true);
	});
});
