// The app's searcher: wired to the app's catalogue, videos, books, accesses and user.
import { describe, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
	catalog: vi.fn(),
	videos: vi.fn(),
	books: vi.fn(),
	session: { user: { username: 'aiko', access: ['video_mgmt'] } as { username: string; access: string[] } | null }
}));
vi.mock('../catalog.svelte', () => ({ loadCatalogIn: app.catalog }));
vi.mock('../api/videos', () => ({ listVideos: app.videos }));
vi.mock('../api/books', () => ({ listBooks: app.books }));
vi.mock('../session.svelte', () => ({
	session: app.session,
	hasAccess: (access: string) => app.session.user?.access.includes(access) ?? false
}));

describe('searcher', () => {
	it('loads the catalogue of every language, and what the user may open', async () => {
		const { searcher } = await import('./app');
		app.catalog.mockResolvedValue({
			schools: [],
			categories: [],
			weapons: [],
			sections: [],
			techniques: [],
			segments: []
		});
		app.videos.mockResolvedValue([]);
		await searcher.refresh();
		expect(app.catalog.mock.calls).toEqual([['en'], ['fr']]);
		expect(app.videos).toHaveBeenCalledOnce();
		expect(app.books).not.toHaveBeenCalled(); // no book_mgmt
		app.session.user = null;
		await searcher.refresh(); // logged out: starts afresh, nothing but the catalogue
		expect(app.videos).toHaveBeenCalledOnce();
	});
});
