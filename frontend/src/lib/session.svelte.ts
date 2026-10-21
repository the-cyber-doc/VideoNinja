import type { User } from './api';

/** The logged-in user, loaded by the (app) layout and shared by its pages. */
export const session = $state<{ user: User | null }>({ user: null });

export const hasAccess = (access: string) => session.user?.access.includes(access) ?? false;
