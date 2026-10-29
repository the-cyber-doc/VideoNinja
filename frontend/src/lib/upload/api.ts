// Upload API (app side). The file itself goes to tusd (upload.ts); the app only
// gets metadata and reports the queue status. Needs the "upload" access.
import { api } from '../api';

export interface Performer {
	id: string;
	name: string;
}

/** A tag kind: one of `values` (sorted by name) if given, else text: any, or a year
 * from `min` to `max` (format 'year'). Names are in the request's language. */
export interface Tag {
	id: string;
	name: string;
	values?: { id: string; name: string }[];
	format?: 'year';
	min?: number;
	max?: number;
}

/** A tag put on a video or segment: `value` is a fixed value's ID, or the free text as typed. */
export interface TagValue {
	id: string;
	value?: string;
}

export interface SubmitSegment {
	begin_s: number;
	end_s: number;
	technique: string;
	performer: string;
	tags: TagValue[];
}

export interface Submit {
	original_filename: string;
	all_segments_done: boolean;
	segments: SubmitSegment[];
	tags: TagValue[];
}

export interface UploadStatus {
	id: number;
	original_filename: string;
	status: 'queued' | 'encoding' | 'published' | 'failed';
	progress: number;
	error: string | null;
	/** ISO 8601 with the UTC offset (the author's timezone): "2026-10-23T12:13:38+02:00". */
	uploaded_at: string;
	/** 1 = next to be encoded. */
	queue_position: number | null;
}

/** False when the server cannot receive uploads now (its tusd is not running). */
/** What the server accepts (the page refuses other files before hashing them). */
export interface UploadLimits {
	max_bytes: number;
	/** Lower case, without the dot. */
	extensions: string[];
}

export const uploadLimits = () => api<UploadLimits>('/api/uploads/limits');

/** Why this file cannot be uploaded, or '' if it can. */
export function refusal(file: { name: string; size: number }, limits: UploadLimits | null): 'type' | 'size' | '' {
	if (!limits) return ''; // not known (yet): the server checks anyway
	const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
	if (!limits.extensions.includes(extension)) return 'type';
	return file.size > limits.max_bytes ? 'size' : '';
}

export const uploadsAvailable = async () =>
	(await api<{ available: boolean }>('/api/uploads/available')).available;

export const videoExists = async (sha256: string) =>
	(await api<{ exists: boolean }>(`/api/videos/exists?original_sha256=${sha256}`)).exists;

export const performers = () => api<Performer[]>('/api/performers');
export const addPerformer = (name: string) => api<Performer>('/api/performers', { name });
export const tags = () => api<Tag[]>('/api/tags');

export const submit = (tusId: string, body: Submit) =>
	api<{ id: number }>(`/api/uploads/${encodeURIComponent(tusId)}/submit`, body);

export const myUploads = () => api<UploadStatus[]>('/api/uploads/mine');
export const retry = (id: number) => api<void>(`/api/videos/${id}/retry`, {});

export const remove = (id: number) => api<void>(`/api/videos/${id}`, undefined, 'DELETE');
