// The first start: the setup wizard (a one-time token from the server's logs).
import { api, ndjson } from './client';
import type { Answer, SetupComplete } from './types';

export const isInitialized = async () =>
	(await api<Answer<'/api/setup/status', 'get'>>('/api/setup/status')).initialized;
export const verifyToken = (token: string) => api<void>('/api/setup/verify', { token });
export const newTotp = (token: string, username: string) =>
	api<Answer<'/api/setup/totp', 'post'>>('/api/setup/totp', { token, username });

/** One line per step completed ({step}), or {error: ApiError} once the answer has started. */
export const complete = (body: SetupComplete) =>
	ndjson<{ step?: string; error?: unknown }>('/api/setup/complete', body);
