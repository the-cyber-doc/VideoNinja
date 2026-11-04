// Books: the 'book_mgmt' access, checked before anything shows (the menu hides the entry
// too; the API refuses every call without it, whatever the page does); then every book.
import { redirect } from '@sveltejs/kit';
import { listBooks } from '#lib/api/books.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, depends }) => {
	depends('app:books'); // after a delete
	const { user } = await parent();
	if (!user?.access.includes('book_mgmt')) redirect(307, url('/'));
	try {
		return { books: await listBooks(), error: null as unknown };
	} catch (e) {
		return { books: [], error: e };
	}
};
