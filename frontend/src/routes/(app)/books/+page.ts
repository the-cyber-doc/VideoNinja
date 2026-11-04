// Books: the 'book_mgmt' access, checked before anything shows (the menu hides the entry
// too; the API refuses every call without it, whatever the page does).
import { redirect } from '@sveltejs/kit';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { user } = await parent();
	if (!user?.access.includes('book_mgmt')) redirect(307, url('/'));
};
