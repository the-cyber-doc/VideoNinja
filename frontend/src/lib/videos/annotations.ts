// Video management (the Videos page): the annotation as the server keeps it
// (../api/videos.ts), converted to and from the annotation panel's form, and the
// page's sections.
import { pathOf, sectionId, type Catalog, type Segment } from '../catalog.svelte';
import type { Annotations, AnnotationsOut, TagIn, VideoRow } from '../api/types';
import type { Annotation, Mode } from '../upload/draft.svelte';
import { allSegmentsDone, wholeSeconds } from '../upload/rules';

/** The Videos page's sections, in their order: how far the annotation is. */
export const SECTIONS = ['in_progress', 'to_annotate', 'complete', 'no_technique'] as const;
export type Section = (typeof SECTIONS)[number];

export function videoSection(video: Pick<VideoRow, 'all_segments_done' | 'segment_count'>): Section {
	if (video.segment_count) return video.all_segments_done ? 'complete' : 'in_progress';
	return video.all_segments_done ? 'no_technique' : 'to_annotate';
}

/** null values (free text left empty) are no value. */
const tagValues = (tags: TagIn[]) =>
	tags.map((tag) => (tag.value == null ? { id: tag.id } : { id: tag.id, value: tag.value }));

/** The server's annotation, for the panel: the technique's path from the catalogue,
 * the mode from what was saved (no segment: "no technique" if marked done, else
 * "define later"). */
export function toAnnotation(saved: AnnotationsOut, catalog: Catalog): Annotation {
	const mode: Mode = saved.segments.length ? null : saved.all_segments_done ? 'none' : 'later';
	return {
		mode,
		allSegmentsDone: saved.all_segments_done,
		tags: tagValues(saved.tags),
		segments: saved.segments.map((s, i) => {
			const path = pathOf(catalog, s.technique);
			return {
				key: i + 1,
				id: s.id ?? undefined, // the server sends null for none
				createdBy: s.created_by,
				begin: s.begin_s,
				end: s.end_s,
				school: path?.ryu ?? '',
				category: path?.category ?? '',
				weapon: path?.weapon ?? '',
				section: path ? sectionId(path) : '',
				technique: s.technique,
				performer: s.performer,
				tags: tagValues(s.tags)
			};
		})
	};
}

/** What Proceed saves: segments keep their ID (new ones have none). */
export function toAnnotations(annotation: Annotation): Annotations {
	return {
		all_segments_done: allSegmentsDone(annotation.mode, annotation.allSegmentsDone),
		tags: annotation.tags,
		segments: annotation.segments.map((s) => ({
			...(s.id === undefined ? {} : { id: s.id }),
			...wholeSeconds(s),
			technique: s.technique,
			performer: s.performer,
			tags: s.tags
		}))
	};
}

/** The Videos page of a segment's video, opened on that segment (without the base path). */
export const segmentHref = (segment: Pick<Segment, 'id' | 'video'>) => `/videos/${segment.video}?segment=${segment.id}`;

/** The segment the page opens on (its `segment` parameter, a segment ID): its key in the
 * form and where it begins. null without one, or one this video no longer has. */
export function focusedSegment(annotation: Annotation, param: string | null): { key: number; begin: number } | null {
	if (!param || !/^[0-9]+$/.test(param)) return null;
	const found = annotation.segments.find((s) => s.id === Number(param));
	return found ? { key: found.key, begin: found.begin } : null;
}
