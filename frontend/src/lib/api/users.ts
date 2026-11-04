// User management (the "user_mgmt" access; the server checks it on every call).
import { api } from './client';
import type { Invite, NewUser, Role, RoleChange, UserRow } from './types';

export const listUsers = () => api<UserRow[]>('/api/admin/users');
export const listRoles = () => api<Role[]>('/api/admin/roles');
/** A user without credentials, and their invitation. */
export const createUser = (body: NewUser) => api<Invite>('/api/admin/users', body);
/** The current invitation again (to copy its link). */
export const getInvite = (id: number) => api<Invite>(`/api/admin/users/${id}/invite`);
/** A new invitation; the password, authenticator and sessions are removed. */
export const resetUser = (id: number) => api<Invite>(`/api/admin/users/${id}/reset`, {});
/** Another role (never one's own); its accesses apply at the user's next request. */
export const setRole = (id: number, body: RoleChange) => api<void>(`/api/admin/users/${id}/role`, body, 'PUT');
/** Password, authenticator, sessions and invitation removed; a reset reactivates. */
export const deactivateUser = (id: number) => api<void>(`/api/admin/users/${id}/deactivate`, {});
/** The user deleted; their comments, segments and videos kept under "a deleted user". */
export const deleteUser = (id: number) => api<void>(`/api/admin/users/${id}`, undefined, 'DELETE');
