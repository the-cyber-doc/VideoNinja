// Video management (the Videos page): the published videos, and their annotation
// as the server keeps it, converted to and from the annotation panel's form.
// Needs the "video_mgmt" access.
import { api } from '../api';
import { url } from '../base';
import { pathOf, sectionId, type Catalog } from '../catalog.svelte';
import type { SubmitSegment, TagValue } from '../upload/api';
import type { Annotation, Mode } from '../upload/draft.svelte';
import { allSegmentsDone, wholeSeconds } from '../upload/rules';

export interface VideoRow {
	id: number;
	original_filename: string;
	uploaded_at: string;
	/** null: published before durations were kept. */
	duration_s: number | null;
	all_segments_done: boolean;
	segment_count: number;
}

/** A segment as the server keeps it: with its ID, once saved. */
export interface SavedSegment extends SubmitSegment {
	id?: number;
}

/** PUT /api/videos/<id>/annotations. */
export interface Annotations {
	all_segments_done: boolean;
	segments: SavedSegment[];
	tags: TagValue[];
}

/** GET (and PUT's answer): also who did what, by display name (null: user unknown). */
export interface AnnotationsOut extends Annotations {
	original_filename: string;
	uploaded_by: string | null;
	segments: (SavedSegment & { created_by: string | null })[];
}

export const listVideos = () => api<VideoRow[]>('/api/videos');
export const getAnnotations = (id: number) => api<AnnotationsOut>(`/api/videos/${id}/annotations`);
export const saveAnnotations = (id: number, body: Annotations) =>
	api<AnnotationsOut>(`/api/videos/${id}/annotations`, body, 'PUT');

export const videoUrl = (id: number) => url(`/media/video/${id}`);
export const videoThumbnailUrl = (id: number) => url(`/media/video/${id}/thumbnail`);

/** The Videos page's sections, in their order: how far the annotation is. */
export const SECTIONS = ['in_progress', 'to_annotate', 'complete', 'no_technique'] as const;
export type Section = (typeof SECTIONS)[number];

export function videoSection(video: Pick<VideoRow, 'all_segments_done' | 'segment_count'>): Section {
	if (video.segment_count) return video.all_segments_done ? 'complete' : 'in_progress';
	return video.all_segments_done ? 'no_technique' : 'to_annotate';
}

/** null values (free text left empty) are no value. */
const tagValues = (tags: TagValue[]) =>
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
				id: s.id,
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
