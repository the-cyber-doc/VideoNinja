// Test local codecs: the 'upload' access, checked before anything shows (as the upload page).
import { redirect } from '@sveltejs/kit';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	const { user } = await parent();
	if (!user?.access.includes('upload')) redirect(307, url('/'));
};
