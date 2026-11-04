// Upload a book: the 'book_mgmt' and 'upload' accesses (tusd's hooks check both), checked
// before anything shows; then the tags (named in the user's language) and the largest PDF.
import { redirect } from '@sveltejs/kit';
import { listTags } from '#lib/api/tags.js';
import { uploadLimits } from '#lib/api/uploads.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, depends }) => {
	depends('app:lang'); // tag names translated
	const { user } = await parent();
	if (!user?.access.includes('book_mgmt') || !user.access.includes('upload')) redirect(307, url('/'));
	const [tags, limits] = await Promise.allSettled([listTags(), uploadLimits()]);
	return {
		tags: tags.status === 'fulfilled' ? tags.value : [],
		maxBytes: limits.status === 'fulfilled' ? limits.value.book_max_bytes : null, // not known: the server checks
		error: tags.status === 'rejected' ? tags.reason : (null as unknown)
	};
};
