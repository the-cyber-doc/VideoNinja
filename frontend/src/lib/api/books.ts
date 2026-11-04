// Books (the "book_mgmt" access). The PDF and its first page go to tusd
// (../upload/upload.ts, kinds "book" and "image"); the app queues them.
import { api } from './client';
import type { Answer, BookIn, BookRow } from './types';

/** True if a book (published, waiting or failed) is this file. */
export const bookExists = async (sha256: string) =>
	(await api<Answer<'/api/books/exists', 'get'>>(`/api/books/exists?sha256=${sha256}`)).exists;
export const submitBook = (body: BookIn) => api<Answer<'/api/books', 'post'>>('/api/books', body);
export const listBooks = () => api<BookRow[]>('/api/books');
export const deleteBook = (id: number) => api<void>(`/api/books/${id}`, undefined, 'DELETE');
