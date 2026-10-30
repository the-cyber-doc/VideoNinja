// The pages' data loads: who is logged in (or the setup, the login first), the
// accesses checked before anything shows, and failures returned for the page to show.
import { isRedirect } from '@sveltejs/kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '#lib/api/client.js';
import { session } from '#lib/session.svelte.js';

const api = vi.hoisted(() => ({
	isInitialized: vi.fn(),
	currentUser: vi.fn(),
	listUsers: vi.fn(),
	listRoles: vi.fn(),
	listPerformers: vi.fn(),
	listTags: vi.fn(),
	uploadLimits: vi.fn(),
	uploadsAvailable: vi.fn()
}));
vi.mock('#lib/api/setup.js', () => ({ isInitialized: api.isInitialized }));
vi.mock('#lib/api/auth.js', () => ({ currentUser: api.currentUser }));
vi.mock('#lib/api/users.js', () => ({ listUsers: api.listUsers, listRoles: api.listRoles }));
vi.mock('#lib/api/performers.js', () => ({ listPerformers: api.listPerformers }));
vi.mock('#lib/api/tags.js', () => ({ listTags: api.listTags }));
vi.mock('#lib/api/uploads.js', () => ({ uploadLimits: api.uploadLimits, uploadsAvailable: api.uploadsAvailable }));

const { load: layout } = await import('./+layout');
const { load: usersPage } = await import('./admin/users/+page');
const { load: uploadPage } = await import('./upload/+page');
const root = await import('../+layout');

const user = (...access: string[]) => ({ id: 1, username: 'admin', access });
/** What SvelteKit passes a page's load: the layout's data, and the dependencies it records. */
const event = (data: unknown) => {
	const depends = vi.fn();
	return { parent: async () => data, depends, event: { parent: async () => data, depends } as never };
};
const redirectOf = async (promise: Promise<unknown>) => {
	const e = await promise.catch((e) => e);
	return isRedirect(e) ? e.location : e;
};

afterEach(() => {
	vi.resetAllMocks();
	session.user = null;
});

describe('(app) layout', () => {
	it('the user, shared with the pages', async () => {
		api.isInitialized.mockResolvedValue(true);
		api.currentUser.mockResolvedValue(user());
		expect(await layout({} as never)).toEqual({ user: user(), error: null });
		expect(session.user).toEqual(user());
	});

	it('not set up: the setup; not logged in: the login', async () => {
		api.isInitialized.mockResolvedValue(false);
		expect(await redirectOf(layout({} as never) as Promise<unknown>)).toBe('/setup');
		api.isInitialized.mockResolvedValue(true);
		api.currentUser.mockResolvedValue(null);
		expect(await redirectOf(layout({} as never) as Promise<unknown>)).toBe('/login');
	});

	it('the server unreachable: returned, shown by the layout', async () => {
		const offline = new ApiError(0, 'network');
		api.isInitialized.mockRejectedValue(offline);
		expect(await layout({} as never)).toEqual({ user: null, error: offline });
	});
});

describe('user management', () => {
	it('its access first; reloaded on a language change or a change of the list', async () => {
		api.listUsers.mockResolvedValue([{ id: 1 }]);
		api.listRoles.mockResolvedValue([{ id: 'admin' }]);
		const { event: e, depends } = event({ user: user('user_mgmt') });
		expect(await usersPage(e)).toEqual({ users: [{ id: 1 }], roles: [{ id: 'admin' }], error: null });
		expect(depends).toHaveBeenCalledWith('app:lang', 'app:users');
		expect(await redirectOf(usersPage(event({ user: user() }).event) as Promise<unknown>)).toBe('/');
		expect(await redirectOf(usersPage(event({ user: null }).event) as Promise<unknown>)).toBe('/');
	});

	it('a failed load: empty lists and the error', async () => {
		const failed = new ApiError(500, 'internal');
		api.listUsers.mockRejectedValue(failed);
		api.listRoles.mockResolvedValue([]);
		expect(await usersPage(event({ user: user('user_mgmt') }).event)).toEqual({ users: [], roles: [], error: failed });
	});
});

describe('upload page', () => {
	it('its access first; what the annotation needs and what the server takes', async () => {
		api.listPerformers.mockResolvedValue([{ id: 'p' }]);
		api.listTags.mockResolvedValue([{ id: 't' }]);
		api.uploadLimits.mockResolvedValue({ max_bytes: 1, extensions: ['mp4'] });
		api.uploadsAvailable.mockResolvedValue(false);
		expect(await uploadPage(event({ user: user('upload') }).event)).toEqual({
			performers: [{ id: 'p' }],
			tags: [{ id: 't' }],
			limits: { max_bytes: 1, extensions: ['mp4'] },
			available: false,
			error: null
		});
		expect(await redirectOf(uploadPage(event({ user: user() }).event) as Promise<unknown>)).toBe('/');
	});

	it('what failed is replaced by a default; the lists’ error shown', async () => {
		const failed = new ApiError(0, 'network');
		for (const fn of [api.listPerformers, api.uploadLimits, api.uploadsAvailable]) fn.mockRejectedValue(failed);
		api.listTags.mockResolvedValue([]);
		expect(await uploadPage(event({ user: user('upload') }).event)).toEqual({
			performers: [],
			tags: [],
			limits: null,
			available: true,
			error: failed
		});
	});
});

describe('root layout', () => {
	it('a single-page app: no server rendering', () => expect(root.ssr).toBe(false));
});
