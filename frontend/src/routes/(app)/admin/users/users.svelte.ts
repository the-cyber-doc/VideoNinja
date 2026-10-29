// User management's actions (create a user, copy an invitation link again, reset an
// account) and their state: busy, the last error, the last link handed out. The list
// itself is the page's data (+page.ts), loaded again after a change.
import { invalidate } from '$app/navigation';
import type { Invite, UserRow } from '#lib/api/types.js';
import { createUser, getInvite, resetUser } from '#lib/api/users.js';
import { url } from '#lib/base.js';

/** An invitation link handed out: shown so it can be copied by hand too. */
export interface InviteLink {
	username: string;
	url: string;
	expires_at: string;
	/** Copied to the clipboard already (else: no clipboard access). */
	copied: boolean;
}

export class UserAdmin {
	busy = $state(false);
	error = $state<unknown>(null);
	link = $state<InviteLink | null>(null);

	/** A new user without credentials; true when created (its link is shown). */
	create = (username: string, role: string) =>
		this.#run(async () => {
			await this.#show(username, await createUser({ username, role }));
			await invalidate('app:users');
		});

	copyInvite = (user: UserRow) => this.#run(async () => this.#show(user.username, await getInvite(user.id)));

	/** The password, authenticator and sessions removed; a new invitation. Confirm first. */
	reset = (user: UserRow) =>
		this.#run(async () => {
			await this.#show(user.username, await resetUser(user.id));
			await invalidate('app:users');
		});

	async #run(action: () => Promise<void>): Promise<boolean> {
		this.busy = true;
		this.error = null;
		try {
			await action();
			return true;
		} catch (e) {
			this.error = e;
			return false;
		} finally {
			this.busy = false;
		}
	}

	/** Show the invitation link and try to copy it to the clipboard. */
	async #show(username: string, invite: Invite) {
		const href = `${location.origin}${url('/register')}#${invite.token}`;
		let copied = false;
		try {
			await navigator.clipboard.writeText(href);
			copied = true;
		} catch {
			// No clipboard access: the link stays visible to copy by hand.
		}
		this.link = { username, url: href, expires_at: invite.expires_at, copied };
	}
}
