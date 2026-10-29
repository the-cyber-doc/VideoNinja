// The logged-in application's data: the user, known before any of its pages loads
// (their load functions read it with `await parent()`, e.g. to check an access).
// Not set up yet: the setup wizard; not logged in: the login page. A failure (the
// server unreachable…) is returned, not thrown: the layout shows it.
import { isRedirect, redirect } from '@sveltejs/kit';
import * as auth from '#lib/api/auth.js';
import { isInitialized } from '#lib/api/setup.js';
import { url } from '#lib/base.js';
import { session } from '#lib/session.svelte.js';
import type { LayoutLoad } from './$types';

export const load: LayoutLoad = async () => {
	try {
		if (!(await isInitialized())) redirect(307, url('/setup'));
		const user = await auth.currentUser();
		if (!user) redirect(307, url('/login'));
		session.user = user;
		return { user, error: null as unknown };
	} catch (e) {
		if (isRedirect(e)) throw e;
		return { user: null, error: e };
	}
};
