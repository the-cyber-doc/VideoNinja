import { afterEach, describe, expect, it } from 'vitest';
import type { User } from './api/types';
import { displayName, hasAccess, session } from './session.svelte';

const user = (over: Partial<User> = {}) =>
	({ id: 1, username: 'kenji', name: null, role: 'user', access: ['comment'], ...over }) as User;

afterEach(() => (session.user = null));

describe('the logged-in user', () => {
	it('nobody: no access, no name', () => {
		expect([hasAccess('comment'), displayName()]).toEqual([false, '']);
	});

	it('their accesses; their name, else their username', () => {
		session.user = user();
		expect([hasAccess('comment'), hasAccess('user_mgmt'), displayName()]).toEqual([true, false, 'kenji']);
		session.user = user({ name: 'Kenji' });
		expect(displayName()).toBe('Kenji');
	});
});
