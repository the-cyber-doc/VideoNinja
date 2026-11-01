// Options: the 'options' access, checked before anything shows (the menu hides the
// entry too; the API refuses every call without it, whatever the page does).
import { redirect } from '@sveltejs/kit';
import { listTagDefinitions } from '#lib/api/tags.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent }) => {
	// Not loaded again on a language change: every language's names come at once (an
	// edit in progress would be lost).
	const { user } = await parent();
	if (!user?.access.includes('options')) redirect(307, url('/'));
	try {
		return { tags: await listTagDefinitions(), error: null as unknown };
	} catch (e) {
		return { tags: [], error: e };
	}
};
