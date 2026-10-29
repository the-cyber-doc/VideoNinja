// User management (the "user_mgmt" access; the server checks it on every call).
import { api } from './client';
import type { Invite, NewUser, Role, UserRow } from './types';

export const listUsers = () => api<UserRow[]>('/api/admin/users');
export const listRoles = () => api<Role[]>('/api/admin/roles');
/** A user without credentials, and their invitation. */
export const createUser = (body: NewUser) => api<Invite>('/api/admin/users', body);
/** The current invitation again (to copy its link). */
export const getInvite = (id: number) => api<Invite>(`/api/admin/users/${id}/invite`);
/** A new invitation; the password, authenticator and sessions are removed. */
export const resetUser = (id: number) => api<Invite>(`/api/admin/users/${id}/reset`, {});
