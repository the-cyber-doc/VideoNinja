// The catalogue file (a static snapshot, not in the API's schema: its type is
// catalog.svelte.ts's, which follows server/app/domain/catalog.py).
import type { Catalog } from '../catalog.svelte';
import { api } from './client';

export const getCatalog = () => api<Catalog>('/api/catalog');
