// Rules of the upload page, kept out of the components (unit-tested).
import { BUKI } from '../catalog.svelte';
import type { Submit, UploadLimits } from '../api/types';
import type { Annotation, Draft, DraftSegment, Mode } from './draft.svelte';

/** "Define later": not done, read-only. "No technique segment": done, read-only. Else: the user's choice. */
export function allSegmentsDone(mode: Mode, checked: boolean): boolean {
	if (mode === 'later') return false;
	if (mode === 'none') return true;
	return checked;
}

export const checkboxLocked = (mode: Mode) => mode !== null;

export type SegmentField = 'times' | 'school' | 'category' | 'weapon' | 'section' | 'technique' | 'performer';

/** What is missing or wrong in a segment (empty = complete). */
export function segmentProblems(segment: DraftSegment, duration: number): SegmentField[] {
	const problems: SegmentField[] = [];
	const { begin_s, end_s } = wholeSeconds(segment);
	if (segment.begin < 0 || segment.end <= segment.begin || end_s > Math.ceil(duration) || end_s <= begin_s) {
		problems.push('times');
	}
	if (!segment.school) problems.push('school');
	if (!segment.category) problems.push('category');
	if (segment.category === BUKI && !segment.weapon) problems.push('weapon');
	if (!segment.section) problems.push('section');
	if (!segment.technique) problems.push('technique');
	if (!segment.performer) problems.push('performer');
	return problems;
}

/** The schema keeps whole seconds: begin rounded down, end up (the segment never shrinks). */
export function wholeSeconds(segment: Pick<DraftSegment, 'begin' | 'end'>) {
	return { begin_s: Math.floor(segment.begin), end_s: Math.ceil(segment.end) };
}

/**
 * Proceed is possible when every segment is complete and, without any segment,
 * a mode says why. A video the browser cannot play can only be sent with a mode.
 */
export function canProceed(draft: Annotation, duration: number, playable: boolean): boolean {
	if (draft.mode === 'none') return draft.segments.length === 0;
	if (!playable) return draft.mode === 'later' && draft.segments.length === 0;
	if (draft.segments.some((s) => segmentProblems(s, duration).length)) return false;
	return draft.segments.length > 0 || draft.mode === 'later';
}

export function submitBody(draft: Draft): Submit {
	return {
		original_filename: draft.originalFilename,
		all_segments_done: allSegmentsDone(draft.mode, draft.allSegmentsDone),
		segments: draft.segments.map((s) => ({
			...wholeSeconds(s),
			technique: s.technique,
			performer: s.performer,
			tags: s.tags
		})),
		tags: draft.tags
	};
}

/** Why this file cannot be uploaded, or '' if it can. */
export function refusal(file: { name: string; size: number }, limits: UploadLimits | null): 'type' | 'size' | '' {
	if (!limits) return ''; // not known (yet): the server checks anyway
	const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
	if (!limits.extensions.includes(extension)) return 'type';
	return file.size > limits.max_bytes ? 'size' : '';
}
