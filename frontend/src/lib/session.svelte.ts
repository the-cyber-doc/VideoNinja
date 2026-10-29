import type { User } from './api/types';

/** The logged-in user, loaded by the (app) layout and shared by its pages. */
export const session = $state<{ user: User | null }>({ user: null });

export const hasAccess = (access: string) => session.user?.access.includes(access) ?? false;

/** The logged-in user's display name: their name, else their username. */
export const displayName = () => (session.user ? (session.user.name ?? session.user.username) : '');
