import { api } from './client';
import type { Tag } from './types';

/** Every tag, sorted by name in the request's language, with its values. */
export const listTags = () => api<Tag[]>('/api/tags');
