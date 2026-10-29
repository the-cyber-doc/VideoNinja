// Marking segments on the timeline, as rules on the annotation's data: no video, no
// DOM (Editor.svelte wires them to the video and the keys; unit-tested here).
//   I: the selected segment's begin, else the begin marker of a new segment.
//   O: ends the segment started by the marker, else the selected segment's end.
// A new segment starts with the previous one's place in the catalogue (all but the
// technique) and performer: a series of techniques of one school is quick to annotate.
import type { Annotation } from './draft.svelte';

/** Where the marking is: the selected segment (its key) and a begin marker (seconds). */
export interface Marking {
	selected: number | null;
	marker: number | null;
}

export const nextKey = (annotation: Annotation) => Math.max(0, ...annotation.segments.map((s) => s.key)) + 1;

/** A new segment from `begin` to `end`; returns its key. */
export function addSegment(annotation: Annotation, begin: number, end: number): number {
	const last = annotation.segments.at(-1);
	const key = nextKey(annotation);
	annotation.segments.push({
		key,
		begin,
		end,
		school: last?.school ?? '',
		category: last?.category ?? '',
		weapon: last?.weapon ?? '',
		section: last?.section ?? '',
		technique: '',
		performer: last?.performer ?? '',
		tags: []
	});
	return key;
}

/** A segment's edges moved (dragged on the timeline), kept inside the video. */
export function moveSegment(annotation: Annotation, key: number, begin: number, end: number, duration: number) {
	const clamp = (time: number) => Math.min(Math.max(time, 0), duration);
	const segment = annotation.segments.find((s) => s.key === key);
	if (segment) Object.assign(segment, { begin: clamp(begin), end: clamp(end) });
}

/** I at `time`. */
export function beginHere(annotation: Annotation, marking: Marking, time: number): Marking {
	const segment = annotation.segments.find((s) => s.key === marking.selected);
	if (segment && time < segment.end) {
		segment.begin = time;
		return marking;
	}
	return { ...marking, marker: time };
}

/** O at `time`. */
export function endHere(annotation: Annotation, marking: Marking, time: number): Marking {
	if (marking.marker !== null && time > marking.marker) {
		return { selected: addSegment(annotation, marking.marker, time), marker: null };
	}
	const segment = annotation.segments.find((s) => s.key === marking.selected);
	if (segment && time > segment.begin) segment.end = time;
	return marking;
}

export type KeyAction = 'toggle' | 'back' | 'forward' | 'begin' | 'end' | 'clear';

/** The editor's action for a key, or null: none, or the key belongs to a form control
 * (typing in a field, Space on a button) or comes with a modifier (a browser shortcut). */
export function keyAction(
	key: string,
	modifiers: { ctrlKey: boolean; metaKey: boolean; altKey: boolean },
	inControl: boolean
): KeyAction | null {
	if (inControl || modifiers.ctrlKey || modifiers.metaKey || modifiers.altKey) return null;
	const actions: Record<string, KeyAction> = {
		' ': 'toggle',
		ArrowLeft: 'back',
		ArrowRight: 'forward',
		i: 'begin',
		o: 'end',
		Escape: 'clear'
	};
	return actions[key.length === 1 ? key.toLowerCase() : key] ?? null;
}
