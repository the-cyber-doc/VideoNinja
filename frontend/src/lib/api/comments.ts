// Comments: read by every logged-in user; written with the "comment" access, each
// user changing only their own (the server checks both).
import { api } from './client';
import type { Comment, CommentIn } from './types';

const path = (technique: string) => `/api/techniques/${encodeURIComponent(technique)}/comments`;

/** Last modified first (sorted by the server). */
export const listComments = (technique: string) => api<Comment[]>(path(technique));
export const addComment = (technique: string, body: CommentIn) => api<Comment>(path(technique), body);
export const editComment = (id: number, body: CommentIn) => api<Comment>(`/api/comments/${id}`, body, 'PATCH');
export const deleteComment = (id: number) => api<void>(`/api/comments/${id}`, undefined, 'DELETE');
