// The catalogue file (a static snapshot, not in the API's schema: its type is
// catalog.svelte.ts's, which follows server/app/domain/catalog.py).
import type { Catalog } from '../catalog.svelte';
import type { Lang } from '../i18n.svelte';
import { api } from './client';

/** In this language (default: the page's). */
export const getCatalog = (lang?: Lang) => api<Catalog>('/api/catalog', undefined, undefined, lang);
