// Comments API: read by every logged-in user; written with the "comment" access,
// each user changing only their own (the server checks both).
import { api } from '../api';
import type { Lang } from '../i18n.svelte';
import type { Comment } from './CommentCard.svelte';

export interface CommentIn {
	text: string;
	lang: Lang;
}

const path = (technique: string) => `/api/techniques/${encodeURIComponent(technique)}/comments`;

/** Last modified first (sorted by the server). */
export const listComments = (technique: string) => api<Comment[]>(path(technique));
export const addComment = (technique: string, body: CommentIn) => api<Comment>(path(technique), body);
export const editComment = (id: number, body: CommentIn) => api<Comment>(`/api/comments/${id}`, body, 'PATCH');
export const deleteComment = (id: number) => api<void>(`/api/comments/${id}`, undefined, 'DELETE');
