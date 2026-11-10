// Books (the "book_mgmt" access). The PDF and its first page go to tusd
// (../upload/upload.ts, kinds "book" and "image"); the app queues them.
import { api } from './client';
import type {
	Answer,
	BookAnnotation,
	BookAnnotationChange,
	BookAnnotationIn,
	BookEdit,
	BookIn,
	BookRow,
	BookText,
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
export const putBookText = (id: number, body: BookText) => api<void>(`/api/books/${id}/text`, body, 'PUT');
export const replaceThumbnail = (id: number, upload: string) =>
	api<void>(`/api/books/${id}/thumbnail`, { upload }, 'PUT');

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
