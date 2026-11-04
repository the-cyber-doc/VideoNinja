// Books (the "book_mgmt" access). The PDF and its first page go to tusd
// (../upload/upload.ts, kinds "book" and "image"); the app queues them.
import { api } from './client';
import type { CommentSource } from './comments';
import type {
	Answer,
	BookAnnotation,
	BookAnnotationChange,
	BookAnnotationIn,
	BookComment,
	CommentIn,
	BookEdit,
	BookIn,
	BookRow,
	TechniqueNote
} from './types';

/** True if a book (published, waiting or failed) is this file. */
export const bookExists = async (sha256: string) =>
	(await api<Answer<'/api/books/exists', 'get'>>(`/api/books/exists?sha256=${sha256}`)).exists;
export const submitBook = (body: BookIn) => api<Answer<'/api/books', 'post'>>('/api/books', body);
export const listBooks = () => api<BookRow[]>('/api/books');
export const deleteBook = (id: number) => api<void>(`/api/books/${id}`, undefined, 'DELETE');
export const getBook = (id: number) => api<BookRow>(`/api/books/${id}`);
export const editBook = (id: number, body: BookEdit) => api<BookRow>(`/api/books/${id}`, body, 'PUT');
/** A new first-page picture (a finished tus upload, kind "image"); the server publishes it. */
export const replaceThumbnail = (id: number, upload: string) =>
	api<void>(`/api/books/${id}/thumbnail`, { upload }, 'PUT');

// Comments on annotations: a thread each (oldest first); every thread of a book (the download).
export const listAnnotationComments = (id: number) => api<BookComment[]>(`/api/book-annotations/${id}/comments`);
export const listBookComments = (bookId: number) => api<BookComment[]>(`/api/books/${bookId}/comments`);
export const addAnnotationComment = (id: number, body: CommentIn) =>
	api<BookComment>(`/api/book-annotations/${id}/comments`, body);
export const editBookComment = (id: number, body: CommentIn) =>
	api<BookComment>(`/api/book-comments/${id}`, body, 'PATCH');
export const deleteBookComment = (id: number) => api<void>(`/api/book-comments/${id}`, undefined, 'DELETE');

/** An annotation's thread, for $lib/techniques/Comments. */
export const annotationComments = (id: number): CommentSource => ({
	list: () => listAnnotationComments(id),
	add: (body) => addAnnotationComment(id, body),
	edit: editBookComment,
	remove: deleteBookComment
});

/** What the books say about a technique (every logged-in user; its page). */
export const techniqueNotes = (technique: string) =>
	api<TechniqueNote[]>(`/api/techniques/${encodeURIComponent(technique)}/book-notes`);

// Annotations (the viewer).
export const listAnnotations = (bookId: number) => api<BookAnnotation[]>(`/api/books/${bookId}/annotations`);
export const createAnnotation = (bookId: number, body: BookAnnotationIn) =>
	api<BookAnnotation>(`/api/books/${bookId}/annotations`, body);
export const changeAnnotation = (id: number, body: BookAnnotationChange) =>
	api<BookAnnotation>(`/api/book-annotations/${id}`, body, 'PATCH');
export const deleteAnnotation = (id: number) => api<void>(`/api/book-annotations/${id}`, undefined, 'DELETE');
/** A region's crop (a finished tus upload, kind "image"); the server publishes it. */
export const attachImage = (id: number, upload: string) =>
	api<void>(`/api/book-annotations/${id}/image`, { upload }, 'PUT');
