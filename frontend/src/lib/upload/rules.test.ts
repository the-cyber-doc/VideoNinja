import { describe, expect, it } from 'vitest';
import type { Draft, DraftSegment } from './draft.svelte';
import { allSegmentsDone, canProceed, segmentProblems, submitBody, wholeSeconds } from './rules';

const segment = (over: Partial<DraftSegment> = {}): DraftSegment => ({
	key: 1,
	begin: 12.4,
	end: 26.2,
	school: 'gyokko',
	category: 'taijutsu',
	weapon: '',
	section: 'gyokko.taijutsu.jo_ryaku',
	technique: 'gyokko.taijutsu.jo_ryaku.koku',
	performer: 'hatsumi',
	tags: [],
	...over
});
const draft = (over: Partial<Draft> = {}): Draft => ({
	sha256: 'a'.repeat(64),
	originalFilename: 'kata.mov',
	size: 1,
	savedAt: 0,
	mode: null,
	allSegmentsDone: false,
	segments: [],
	tags: [],
	...over
});

describe('all segments done checkbox', () => {
	it('"define later" forces it off', () => expect(allSegmentsDone('later', true)).toBe(false));
	it('"no technique segment" forces it on', () => expect(allSegmentsDone('none', false)).toBe(true));
	it('otherwise the user decides', () => {
		expect(allSegmentsDone(null, true)).toBe(true);
		expect(allSegmentsDone(null, false)).toBe(false);
	});
});

describe('segments', () => {
	it('whole seconds: begin down, end up', () =>
		expect(wholeSeconds({ begin: 12.9, end: 26.1 })).toEqual({ begin_s: 12, end_s: 27 }));
	it('complete segment', () => expect(segmentProblems(segment(), 60)).toEqual([]));
	it('lists what is missing', () =>
		expect(segmentProblems(segment({ school: '', performer: '' }), 60)).toEqual(['school', 'performer']));
	it('a weapon only under Buki', () => {
		const staff = { category: 'buki', section: 'kukishinden.buki.rokushakubo.shoden' };
		expect(segmentProblems(segment({ ...staff, weapon: '' }), 60)).toEqual(['weapon']);
		expect(segmentProblems(segment({ ...staff, weapon: 'rokushakubo' }), 60)).toEqual([]);
		expect(segmentProblems(segment({ category: '', section: '', technique: '' }), 60)).toEqual([
			'category',
			'section',
			'technique'
		]);
	});
	it('times inside the video, end after begin', () => {
		expect(segmentProblems(segment({ end: 12 }), 60)).toEqual(['times']);
		expect(segmentProblems(segment({ end: 70 }), 60)).toEqual(['times']);
	});
});

describe('proceed', () => {
	it('needs a segment or a mode', () => {
		expect(canProceed(draft(), 60, true)).toBe(false);
		expect(canProceed(draft({ segments: [segment()] }), 60, true)).toBe(true);
		expect(canProceed(draft({ mode: 'later' }), 60, true)).toBe(true);
		expect(canProceed(draft({ mode: 'none' }), 60, true)).toBe(true);
	});
	it('every segment must be complete, even when defining the rest later', () =>
		expect(canProceed(draft({ mode: 'later', segments: [segment({ technique: '' })] }), 60, true)).toBe(false));
	it('a video the browser cannot play only goes with a mode', () => {
		expect(canProceed(draft({ segments: [segment()] }), 60, false)).toBe(false);
		expect(canProceed(draft({ mode: 'later' }), 0, false)).toBe(true);
	});
});

describe('submit body', () => {
	it('rounds the times and applies the mode', () => {
		const body = submitBody(draft({ mode: 'later', allSegmentsDone: true, segments: [segment()] }));
		expect(body.all_segments_done).toBe(false);
		expect(body.segments).toEqual([
			{ begin_s: 12, end_s: 27, technique: 'gyokko.taijutsu.jo_ryaku.koku', performer: 'hatsumi', tags: [] }
		]);
	});
});
