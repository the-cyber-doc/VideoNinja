// Registration from an invitation link (/register#<token>).
import { api } from './client';
import type { Answer, RegisterComplete } from './types';

export const verifyInvite = (token: string) =>
	api<Answer<'/api/register/verify', 'post'>>('/api/register/verify', { token });
export const newTotp = (token: string) => api<Answer<'/api/register/totp', 'post'>>('/api/register/totp', { token });
export const complete = (body: RegisterComplete) => api<void>('/api/register/complete', body);
