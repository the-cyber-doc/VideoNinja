// URLs of a segment's media. Only the segment's ID: the server finds the video
// and the times itself.
import type { Segment } from './catalog.svelte';
import { url } from './base';

/** The clip: only this part of the video, cut by the server. */
export const clipUrl = (segment: Segment) => url(`/media/segment/${segment.id}`);

export const thumbnailUrl = (segment: Segment) => url(`/media/segment/${segment.id}/thumbnail`);

export const segmentDuration = (segment: Segment) => segment.end_s - segment.begin_s;

// Whole videos (the Videos page: the "video_mgmt" access).
export const videoUrl = (id: number) => url(`/media/video/${id}`);
export const videoThumbnailUrl = (id: number) => url(`/media/video/${id}/thumbnail`);

// Books (the "book_mgmt" access): the PDF (a download) and its first page.
export const bookUrl = (id: number) => url(`/media/book/${id}`);
export const bookThumbnailUrl = (id: number) => url(`/media/book/${id}/thumbnail`);
