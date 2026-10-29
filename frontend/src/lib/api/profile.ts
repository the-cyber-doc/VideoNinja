// The logged-in user's own profile: display name, password, authenticator.
import { api } from './client';
import type { PasswordChange, TotpConfirm, TotpEnrollment, User } from './types';

export const setName = (name: string) => api<User>('/api/profile/name', { name });
export const setPassword = (body: PasswordChange) => api<void>('/api/profile/password', body);
export const newTotp = () => api<TotpEnrollment>('/api/profile/totp', {});
export const confirmTotp = (body: TotpConfirm) => api<void>('/api/profile/totp/confirm', body);
