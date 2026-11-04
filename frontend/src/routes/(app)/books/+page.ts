// Books: the 'book_mgmt' access, checked before anything shows (the menu hides the entry
// too; the API refuses every call without it, whatever the page does); then every book,
// and the tags (the filter names them).
import { redirect } from '@sveltejs/kit';
import { listBooks } from '#lib/api/books.js';
import { listTags } from '#lib/api/tags.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, depends }) => {
	depends('app:books', 'app:lang'); // after a delete; tag names translated (the filter's)
	const { user } = await parent();
	if (!user?.access.includes('book_mgmt')) redirect(307, url('/'));
	const [books, tags] = await Promise.allSettled([listBooks(), listTags()]);
	const failed = [books, tags].find((r) => r.status === 'rejected');
	return {
		books: books.status === 'fulfilled' ? books.value : [],
		tags: tags.status === 'fulfilled' ? tags.value : [],
		error: failed ? (failed as PromiseRejectedResult).reason : (null as unknown)
	};
};
