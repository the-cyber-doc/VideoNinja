import { api } from './client';
import type { Performer } from './types';

export const listPerformers = () => api<Performer[]>('/api/performers');
export const addPerformer = (name: string) => api<Performer>('/api/performers', { name });
