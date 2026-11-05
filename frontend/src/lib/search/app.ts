// The app's searcher (one for every search box): the app's catalogue, videos, books and
// the server's full text.
import { listBooks } from '../api/books';
import { searchText } from '../api/search';
import { listVideos } from '../api/videos';
import { loadCatalogIn } from '../catalog.svelte';
import { hasAccess, session } from '../session.svelte';
import { Searcher } from './searcher.svelte';

export const searcher = new Searcher({
	catalog: loadCatalogIn,
	videos: listVideos,
	books: listBooks,
	remote: searchText,
	can: hasAccess,
	user: () => session.user?.username,
	now: () => Date.now()
});
