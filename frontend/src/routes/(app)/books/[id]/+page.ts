// One book: the 'book_mgmt' access, checked before anything shows; then the book, its
// annotations and the tags (named in the user's language: the reference's form).
import { error, redirect } from '@sveltejs/kit';
import { getBook, listAnnotations } from '#lib/api/books.js';
import { listTags } from '#lib/api/tags.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, params, depends }) => {
	depends('app:lang');
	const { user } = await parent();
	if (!user?.access.includes('book_mgmt')) redirect(307, url('/'));
	const id = Number(params.id);
	if (!Number.isInteger(id) || id < 1) error(404);
	try {
		const book = await getBook(id);
		const [annotations, tags] = await Promise.all([
			book.status === 'published' ? listAnnotations(id) : Promise.resolve([]),
			listTags()
		]);
		return { book, annotations, tags, error: null as unknown };
	} catch (e) {
		return { book: null, annotations: [], tags: [], error: e };
	}
};
