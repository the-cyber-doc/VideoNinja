// The search's full text (the server's FTS5): book pages, book annotations, comments.
import { api } from './client';
import type { SearchHits } from './types';

export const searchText = (q: string) => api<SearchHits>(`/api/search?q=${encodeURIComponent(q)}`);
