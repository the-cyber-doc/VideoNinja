// Comments: read by every logged-in user; written with the "comment" access, each
// user changing only their own, except moderators (the server checks all of it).
import { api } from './client';
import type { Comment, CommentIn } from './types';

const path = (technique: string) => `/api/techniques/${encodeURIComponent(technique)}/comments`;

/** Last modified first (sorted by the server). */
export const listComments = (technique: string) => api<Comment[]>(path(technique));
export const addComment = (technique: string, body: CommentIn) => api<Comment>(path(technique), body);
export const editComment = (id: number, body: CommentIn) => api<Comment>(`/api/comments/${id}`, body, 'PATCH');
export const deleteComment = (id: number) => api<void>(`/api/comments/${id}`, undefined, 'DELETE');

/** Where a list of comments comes from and goes to (a technique's, an annotation's). */
export interface CommentSource {
	list: () => Promise<Comment[]>;
	add: (body: CommentIn) => Promise<unknown>;
	edit: (id: number, body: CommentIn) => Promise<unknown>;
	remove: (id: number) => Promise<unknown>;
}

export const techniqueComments = (technique: string): CommentSource => ({
	list: () => listComments(technique),
	add: (body) => addComment(technique, body),
	edit: editComment,
	remove: deleteComment
});
