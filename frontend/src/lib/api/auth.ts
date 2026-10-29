// Logging in and out, and who is logged in.
import { api, ApiError } from './client';
import type { Credentials, User } from './types';

export const login = (credentials: Credentials) => api<User>('/api/auth/login', credentials);
export const logout = () => api<void>('/api/auth/logout', {});

/** The logged-in user, or null. */
export async function currentUser(): Promise<User | null> {
	try {
		return await api<User>('/api/auth/me');
	} catch (e) {
		if (e instanceof ApiError && e.status === 401) return null;
		throw e;
	}
}
