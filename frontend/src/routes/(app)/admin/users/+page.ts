// User management: the 'user_mgmt' access, checked before anything shows (the menu
// hides the entry too; the API refuses every call without it, whatever the page does).
import { redirect } from '@sveltejs/kit';
import { listRoles, listUsers } from '#lib/api/users.js';
import { url } from '#lib/base.js';
import type { PageLoad } from './$types';

export const load: PageLoad = async ({ parent, depends }) => {
	// Loaded again on a language change (the server translates the role names) and
	// after a change of the list (invalidate('app:users')).
	depends('app:lang', 'app:users');
	const { user } = await parent();
	if (!user?.access.includes('user_mgmt')) redirect(307, url('/'));
	try {
		const [users, roles] = await Promise.all([listUsers(), listRoles()]);
		return { users, roles, error: null as unknown };
	} catch (e) {
		return { users: [], roles: [], error: e };
	}
};
