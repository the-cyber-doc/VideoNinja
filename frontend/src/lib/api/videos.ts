// Video management (the "video_mgmt" access): the published videos and their
// annotation as the server keeps it (../videos/annotations.ts converts it).
import { api } from './client';
import type { Annotations, AnnotationsOut, VideoRow } from './types';

export const listVideos = () => api<VideoRow[]>('/api/videos');
export const getAnnotations = (id: number) => api<AnnotationsOut>(`/api/videos/${id}/annotations`);
export const saveAnnotations = (id: number, body: Annotations) =>
	api<AnnotationsOut>(`/api/videos/${id}/annotations`, body, 'PUT');
