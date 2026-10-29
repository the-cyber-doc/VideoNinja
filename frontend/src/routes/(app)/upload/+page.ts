// Upload: the 'upload' access, checked before anything shows; then what the annotation
// needs (performers; tags, named in the user's language) and what the server takes
// (largest file and types; whether it can receive uploads now).
import { redirect } from '@sveltejs/kit';
import { listPerformers } from '#lib/api/performers.js';
import { listTags } from '#lib/api/tags.js';
import { uploadLimits, uploadsAvailable } from '#lib/api/uploads.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, depends }) => {
	depends('app:lang', 'app:performers'); // tag names translated; a performer added
	const { user } = await parent();
	if (!user?.access.includes('upload')) redirect(307, url('/'));
	const [performers, tags, limits, available] = await Promise.allSettled([
		listPerformers(),
		listTags(),
		uploadLimits(),
		uploadsAvailable()
	]);
	const value = <T>(r: PromiseSettledResult<T>, fallback: T) => (r.status === 'fulfilled' ? r.value : fallback);
	const failed = [performers, tags].find((r) => r.status === 'rejected');
	return {
		performers: value(performers, []),
		tags: value(tags, []),
		limits: value(limits, null), // not known: the server checks anyway
		available: value(available, true), // not known: assumed (an upload says otherwise)
		error: failed ? (failed as PromiseRejectedResult).reason : (null as unknown)
	};
};
