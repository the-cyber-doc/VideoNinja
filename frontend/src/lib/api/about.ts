import { api } from './client';
import type { About } from './types';

/** The running database's version, and the latest this release ships. */
export const getAbout = () => api<About>('/api/about');
