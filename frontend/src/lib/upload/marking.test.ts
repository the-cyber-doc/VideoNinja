import { describe, expect, it } from 'vitest';
import type { Annotation } from './draft.svelte';
import { addSegment, beginHere, endHere, keyAction, moveSegment, nextKey } from './marking';

const annotation = (): Annotation => ({ mode: null, allSegmentsDone: false, segments: [], tags: [] });
const none = { selected: null, marker: null };
const keys = { ctrlKey: false, metaKey: false, altKey: false };

describe('marking segments', () => {
	it("a new segment takes the previous one's place in the catalogue and performer, not its technique", () => {
		const a = annotation();
		addSegment(a, 0, 2);
		Object.assign(a.segments[0], {
			school: 'gyokko',
			category: 'taijutsu',
			section: 's',
			technique: 'koku',
			performer: 'hatsumi'
		});
		const key = addSegment(a, 3, 5);
		expect(key).toBe(2);
		expect(a.segments[1]).toMatchObject({
			begin: 3,
			end: 5,
			school: 'gyokko',
			category: 'taijutsu',
			section: 's',
			technique: '',
			performer: 'hatsumi'
		});
	});

	it('keys are never reused, even after a deletion', () => {
		const a = annotation();
		addSegment(a, 0, 1);
		addSegment(a, 1, 2);
		a.segments.splice(0, 1);
		expect(nextKey(a)).toBe(3);
	});

	it('I then O: a segment from the marker to the time, selected', () => {
		const a = annotation();
		let m = beginHere(a, none, 4);
		expect(m).toEqual({ selected: null, marker: 4 });
		m = endHere(a, m, 9);
		expect(m).toEqual({ selected: 1, marker: null });
		expect(a.segments.map((s) => [s.begin, s.end])).toEqual([[4, 9]]);
	});

	it('O before the marker creates nothing', () => {
		const a = annotation();
		const m = endHere(a, { selected: null, marker: 4 }, 3);
		expect(m).toEqual({ selected: null, marker: 4 });
		expect(a.segments).toEqual([]);
	});

	it("I and O move the selected segment's edges, never past each other", () => {
		const a = annotation();
		const selected = addSegment(a, 2, 6);
		const m = { selected, marker: null };
		beginHere(a, m, 3);
		endHere(a, m, 8);
		expect([a.segments[0].begin, a.segments[0].end]).toEqual([3, 8]);
		// I after its end: not a begin of this segment, a marker for a new one.
		expect(beginHere(a, m, 9)).toEqual({ selected, marker: 9 });
		expect(a.segments[0].begin).toBe(3);
		endHere(a, m, 1); // O before its begin: nothing
		expect(a.segments[0].end).toBe(8);
	});

	it('dragged edges stay inside the video', () => {
		const a = annotation();
		const key = addSegment(a, 2, 6);
		moveSegment(a, key, -1, 99, 30);
		expect([a.segments[0].begin, a.segments[0].end]).toEqual([0, 30]);
	});
});

describe('keys', () => {
	it.each([
		[' ', 'toggle'],
		['ArrowLeft', 'back'],
		['ArrowRight', 'forward'],
		['i', 'begin'],
		['I', 'begin'],
		['o', 'end'],
		['Escape', 'clear'],
		['x', null]
	])('%j → %s', (key, action) => expect(keyAction(key, keys, false)).toBe(action));

	it('never while typing in a control, nor with a modifier (a browser shortcut)', () => {
		expect(keyAction('i', keys, true)).toBeNull();
		expect(keyAction(' ', keys, true)).toBeNull();
		expect(keyAction('o', { ...keys, ctrlKey: true }, false)).toBeNull();
		expect(keyAction('ArrowLeft', { ...keys, altKey: true }, false)).toBeNull();
	});
});
