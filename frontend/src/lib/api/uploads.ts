// Uploads (the "upload" access). The file itself goes to tusd (../upload/upload.ts);
// the app gets its metadata, queues it and reports the encoding's progress.
import { api } from './client';
import type { Answer, Submit, UploadLimits, UploadStatus } from './types';

/** What the server accepts (the page refuses other files before hashing them). */
export const uploadLimits = () => api<UploadLimits>('/api/uploads/limits');
/** False when the server cannot receive uploads now (its tusd is not running). */
export const uploadsAvailable = async () =>
	(await api<Answer<'/api/uploads/available', 'get'>>('/api/uploads/available')).available;
/** True if a video (published, waiting or failed) has this original. */
export const videoExists = async (sha256: string) =>
	(await api<Answer<'/api/videos/exists', 'get'>>(`/api/videos/exists?original_sha256=${sha256}`)).exists;
export const submit = (tusId: string, body: Submit) =>
	api<Answer<'/api/uploads/{tus_id}/submit', 'post'>>(`/api/uploads/${encodeURIComponent(tusId)}/submit`, body);
export const myUploads = () => api<UploadStatus[]>('/api/uploads/mine');
export const retry = (id: number) => api<void>(`/api/videos/${id}/retry`, {});
export const remove = (id: number) => api<void>(`/api/videos/${id}`, undefined, 'DELETE');
