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
	listTagDefinitions: vi.fn(),
	uploadLimits: vi.fn(),
	uploadsAvailable: vi.fn(),
	listBooks: vi.fn()
}));
vi.mock('#lib/api/setup.js', () => ({ isInitialized: api.isInitialized }));
vi.mock('#lib/api/auth.js', () => ({ currentUser: api.currentUser }));
vi.mock('#lib/api/users.js', () => ({ listUsers: api.listUsers, listRoles: api.listRoles }));
vi.mock('#lib/api/performers.js', () => ({ listPerformers: api.listPerformers }));
vi.mock('#lib/api/tags.js', () => ({ listTags: api.listTags, listTagDefinitions: api.listTagDefinitions }));
vi.mock('#lib/api/uploads.js', () => ({ uploadLimits: api.uploadLimits, uploadsAvailable: api.uploadsAvailable }));
vi.mock('#lib/api/books.js', () => ({ listBooks: api.listBooks }));

const { load: layout } = await import('./+layout');
const { load: usersPage } = await import('./admin/users/+page');
const { load: uploadPage } = await import('./upload/+page');
const { load: codecsPage } = await import('./upload/codecs/+page');
const { load: booksPage } = await import('./books/+page');
const { load: bookUploadPage } = await import('./upload/book/+page');
const { load: optionsPage } = await import('./options/+page');
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

describe('options page', () => {
	it('the options access first, then every tag definition', async () => {
		api.listTagDefinitions.mockResolvedValue([{ id: 'year' }]);
		expect(await optionsPage(event({ user: user('options') }).event)).toEqual({ tags: [{ id: 'year' }], error: null });
		expect(await redirectOf(optionsPage(event({ user: user('user_mgmt') }).event) as Promise<unknown>)).toBe('/');
		expect(await redirectOf(optionsPage(event({ user: null }).event) as Promise<unknown>)).toBe('/');
	});

	it('a failed load: no tags and the error', async () => {
		const failed = new ApiError(500, 'internal');
		api.listTagDefinitions.mockRejectedValue(failed);
		expect(await optionsPage(event({ user: user('options') }).event)).toEqual({ tags: [], error: failed });
	});
});

describe('upload page', () => {
	it('its access first; what the annotation needs and what the server takes', async () => {
		api.listPerformers.mockResolvedValue([{ id: 'p' }]);
		api.listTags.mockResolvedValue([{ id: 't' }]);
		api.uploadLimits.mockResolvedValue({ max_bytes: 1, extensions: ['mp4'], book_max_bytes: 1 });
		api.uploadsAvailable.mockResolvedValue(false);
		expect(await uploadPage(event({ user: user('upload') }).event)).toEqual({
			performers: [{ id: 'p' }],
			tags: [{ id: 't' }],
			limits: { max_bytes: 1, extensions: ['mp4'], book_max_bytes: 1 },
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

describe('test local codecs page', () => {
	it('the upload access, else home', async () => {
		expect(await codecsPage(event({ user: user('upload') }).event)).toBeUndefined();
		expect(await redirectOf(codecsPage(event({ user: user('comment') }).event) as Promise<unknown>)).toBe('/');
		expect(await redirectOf(codecsPage(event({ user: null }).event) as Promise<unknown>)).toBe('/');
	});
});

describe('books page', () => {
	it('needs the book_mgmt access; the books, or the failure', async () => {
		api.listBooks.mockResolvedValue([{ id: 1 }]);
		const { event: e, depends } = event({ user: user('book_mgmt') });
		expect(await booksPage(e)).toEqual({ books: [{ id: 1 }], error: null });
		expect(depends).toHaveBeenCalledWith('app:books');
		const failure = new ApiError(500, 'internal');
		api.listBooks.mockRejectedValue(failure);
		expect(await booksPage(event({ user: user('book_mgmt') }).event)).toEqual({ books: [], error: failure });
		expect(await redirectOf(booksPage(event({ user: user('video_mgmt') }).event) as Promise<unknown>)).toBe('/');
		expect(await redirectOf(booksPage(event({ user: null }).event) as Promise<unknown>)).toBe('/');
	});
});

describe('book upload page', () => {
	it('needs book_mgmt and upload; the tags and the largest PDF', async () => {
		api.listTags.mockResolvedValue([{ id: 'year' }]);
		api.uploadLimits.mockResolvedValue({ max_bytes: 9, extensions: [], book_max_bytes: 5 });
		const { event: e, depends } = event({ user: user('book_mgmt', 'upload') });
		expect(await bookUploadPage(e)).toEqual({ tags: [{ id: 'year' }], maxBytes: 5, error: null });
		expect(depends).toHaveBeenCalledWith('app:lang');
		const failure = new ApiError(500, 'internal');
		api.listTags.mockRejectedValue(failure);
		api.uploadLimits.mockRejectedValue(failure);
		expect(await bookUploadPage(event({ user: user('book_mgmt', 'upload') }).event)).toEqual({
			tags: [],
			maxBytes: null,
			error: failure
		});
		for (const u of [user('book_mgmt'), user('upload'), null])
			expect(await redirectOf(bookUploadPage(event({ user: u }).event) as Promise<unknown>)).toBe('/');
	});
});

describe('root layout', () => {
	it('a single-page app: no server rendering', () => expect(root.ssr).toBe(false));
});
