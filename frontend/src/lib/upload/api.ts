// Upload API (app side). The file itself goes to tusd (upload.ts); the app only
// gets metadata and reports the queue status. Needs the "upload" access.
import { api } from '../api';

export interface Performer {
	id: string;
	name: string;
}

/** A tag kind: one of `values` if given, else free text. */
export interface Tag {
	id: string;
	values?: string[];
}

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
	filename: string;
	all_segments_done: boolean;
	segments: SubmitSegment[];
	tags: TagValue[];
}

export interface UploadStatus {
	id: number;
	filename: string;
	status: 'queued' | 'encoding' | 'published' | 'failed';
	progress: number;
	error: string | null;
	uploaded_s: number;
	/** 1 = next to be encoded. */
	queue_position: number | null;
}

/** False when the server cannot receive uploads now (its tusd is not running). */
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

export async function remove(id: number) {
	const res = await fetch(`/api/videos/${id}`, { method: 'DELETE', credentials: 'same-origin' });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
