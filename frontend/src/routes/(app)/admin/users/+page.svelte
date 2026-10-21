<script lang="ts">
	// User management: needs the 'user_mgmt' access. Hidden from the menu otherwise,
	// and the API refuses every call (403) whatever the page does.
	import { goto } from '$app/navigation';
	import { api } from '#lib/api.js';
	import Icon from '#lib/Icon.svelte';
	import { hasAccess, session } from '#lib/session.svelte.js';
	import { rules } from '#lib/validation.js';

	interface UserRow {
		id: number;
		username: string;
		name: string | null;
		role: string;
		status: 'registered' | 'invited' | 'expired';
	}
	interface Invite {
		token: string;
		expires_s: number;
	}

	const allowed = $derived(hasAccess('user_mgmt'));
	let users = $state<UserRow[]>([]);
	let roles = $state<{ id: string; name: string }[]>([]);
	let error = $state('');

	let username = $state('');
	let role = $state('user');
	let busy = $state(false);

	/** Last invitation link handed out, shown so it can be copied by hand too. */
	let link = $state<{ username: string; url: string; expires: string; copied: boolean } | null>(
		null
	);

	$effect(() => {
		if (!allowed) {
			goto('/', { replaceState: true });
			return;
		}
		load();
	});

	async function load() {
		try {
			[users, roles] = await Promise.all([
				api<UserRow[]>('/api/admin/users'),
				api<{ id: string; name: string }[]>('/api/admin/roles')
			]);
		} catch (e) {
			error = (e as Error).message;
		}
	}

	async function action(fn: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await fn();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	/** Show the invitation link and try to copy it to the clipboard. */
	async function showLink(user: string, invite: Invite) {
		const url = `${location.origin}/register#${invite.token}`;
		const expires = new Date(invite.expires_s * 1000).toLocaleString();
		let copied = false;
		try {
			await navigator.clipboard.writeText(url);
			copied = true;
		} catch {
			// No clipboard access: the link stays visible to copy by hand.
		}
		link = { username: user, url, expires, copied };
	}

	const create = (e: SubmitEvent) => {
		e.preventDefault();
		action(async () => {
			const invite = await api<Invite>('/api/admin/users', { username, role });
			await showLink(username, invite);
			username = '';
			await load();
		});
	};

	const copyInvite = (user: UserRow) =>
		action(async () => showLink(user.username, await api<Invite>(`/api/admin/users/${user.id}/invite`)));

	const reset = (user: UserRow) => {
		if (
			user.status === 'registered' &&
			!confirm(
				`Reset the account of ${user.username}? Their password and authenticator are removed, ` +
					'they are logged out, and they need a new invitation link to log in again.'
			)
		)
			return;
		action(async () => {
			await showLink(user.username, await api<Invite>(`/api/admin/users/${user.id}/reset`, {}));
			await load();
		});
	};

	const STATUS = {
		registered: { icon: 'check', label: 'Registered', class: 'ok' },
		invited: { icon: null, label: 'Invitation pending', class: '' },
		expired: { icon: 'cross', label: 'Invitation expired', class: 'bad' }
	} as const;
</script>

{#if allowed}
	<main class="page">
		<h1>User Management</h1>

		<section aria-labelledby="h-new">
			<h2 id="h-new">New user</h2>
			<form class="inline" onsubmit={create}>
				<label>
					Username
					<input
						bind:value={username}
						autocomplete="off"
						autocapitalize="none"
						minlength={rules.username.min_length}
						maxlength={rules.username.max_length}
						pattern={rules.username.pattern}
						title="{rules.username.min_length} to {rules.username
							.max_length} characters: lowercase letters, digits, . _ -"
						required
					/>
				</label>
				<label>
					Role
					<select bind:value={role} required>
						{#each roles as r (r.id)}
							<option value={r.id}>{r.name}</option>
						{/each}
					</select>
				</label>
				<button disabled={busy}>Create</button>
			</form>
			{#if link}
				<div class="link" role="status">
					<p>
						Invitation link for <strong>{link.username}</strong>, valid until {link.expires}.
						{link.copied ? 'Copied to the clipboard.' : 'Copy it and send it to the user.'}
					</p>
					<input
						aria-label="Invitation link"
						value={link.url}
						readonly
						onfocus={(e) => e.currentTarget.select()}
					/>
				</div>
			{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</section>

		<section aria-labelledby="h-users">
			<h2 id="h-users">Users</h2>
			<table>
				<thead>
					<tr>
						<th><span class="visually-hidden">Status</span></th>
						<th>Username</th>
						<th>Name</th>
						<th>Role</th>
						<th><span class="visually-hidden">Actions</span></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						{@const status = STATUS[user.status]}
						<tr>
							<td class="status {status.class}" title={status.label}>
								{#if status.icon}<Icon name={status.icon} />{/if}
								<span class="visually-hidden">{status.label}</span>
							</td>
							<td>{user.username}</td>
							<td>{user.name ?? ''}</td>
							<td>{roles.find((r) => r.id === user.role)?.name ?? user.role}</td>
							<td class="actions">
								{#if user.status === 'invited'}
									<button
										class="icon"
										title="Copy invite link"
										aria-label="Copy invite link"
										onclick={() => copyInvite(user)}
										disabled={busy}
									>
										<Icon name="copy" />
									</button>
								{:else if user.username !== session.user?.username}
									<button
										class="icon"
										title="Reset account"
										aria-label="Reset account"
										onclick={() => reset(user)}
										disabled={busy}
									>
										<Icon name="refresh" />
									</button>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</section>
	</main>
{/if}

<style>
	.page {
		max-width: 52rem;
		margin: 0 auto;
	}
	h1 {
		margin-top: 0.5rem;
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	section {
		margin-bottom: 2rem;
		padding: 1.25rem;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	form.inline {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		align-items: end;
	}
	form.inline label {
		flex: 1 1 12rem;
	}
	select {
		font: inherit;
		padding: 0.55rem 0.7rem;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: 6px;
	}
	.link {
		display: grid;
		gap: 0.4rem;
		margin-top: 1rem;
	}
	.link p {
		margin: 0;
		font-size: 0.9rem;
	}
	.link input {
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: 0.85rem;
	}
	.error {
		margin-top: 0.75rem;
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: 0.45rem 0.5rem;
		text-align: left;
		border-bottom: 1px solid var(--border);
	}
	th {
		font-size: 0.85rem;
		color: var(--muted);
		font-weight: 600;
	}
	td.status {
		width: 2.5rem;
	}
	td.status.ok {
		color: var(--ok);
	}
	td.status.bad {
		color: var(--error);
	}
	td.actions {
		width: 3rem;
		text-align: right;
	}
	button.icon {
		display: inline-grid;
		place-items: center;
		width: 2.2rem;
		height: 2.2rem;
		padding: 0;
		color: var(--text);
		background: transparent;
		border: 1px solid var(--border);
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (max-width: 40rem) {
		/* Name and role columns give way on phones. */
		th:nth-child(3),
		td:nth-child(3) {
			display: none;
		}
	}
</style>
