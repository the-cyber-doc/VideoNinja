import { api } from './client';
import type { Tag, TagDefinition, TagDefinitionIn } from './types';

/** Every tag, sorted by name in the request's language, with its rule and values. */
export const listTags = () => api<Tag[]>('/api/tags');

// The Options page (the "options" access; the server checks it on every call).
/** Every tag as the Options page edits it: every language's names, usage counts. */
export const listTagDefinitions = () => api<TagDefinition[]>('/api/admin/tags');
export const createTag = (body: TagDefinitionIn) => api<TagDefinition>('/api/admin/tags', body);
/** The whole tag, saved under `id` (a new body.id renames it everywhere). */
export const saveTag = (id: string, body: TagDefinitionIn) =>
	api<TagDefinition>(`/api/admin/tags/${encodeURIComponent(id)}`, body, 'PUT');
/** Only a tag no video or segment uses. */
export const deleteTag = (id: string) => api<void>(`/api/admin/tags/${encodeURIComponent(id)}`, undefined, 'DELETE');
