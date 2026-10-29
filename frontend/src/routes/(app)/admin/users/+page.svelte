<script lang="ts">
	// User management: needs the 'user_mgmt' access. Hidden from the menu otherwise,
	// and the API refuses every call (403) whatever the page does.
	import { goto } from '$app/navigation';
	import { url } from '#lib/base.js';
	import type { Invite, Role, UserRow } from '#lib/api/types.js';
	import { createUser, getInvite, listRoles, listUsers, resetUser } from '#lib/api/users.js';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import Icon from '#lib/Icon.svelte';
	import { hasAccess, session } from '#lib/session.svelte.js';
	import { rules } from '#lib/validation.js';

	const allowed = $derived(hasAccess('user_mgmt'));
	let users = $state<UserRow[]>([]);
	let roles = $state<Role[]>([]);
	let error = $state('');

	let username = $state('');
	let role = $state('user');
	let busy = $state(false);

	/** Last invitation link handed out, shown so it can be copied by hand too. */
	let link = $state<{ username: string; url: string; expires_at: string; copied: boolean } | null>(
		null
	);

	$effect(() => {
		if (!allowed) {
			goto(url('/'), { replace: true });
			return;
		}
		void i18n.lang; // reload on language change: role names are translated by the server
		load();
	});

	async function load() {
		try {
			[users, roles] = await Promise.all([
				listUsers(),
				listRoles()
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
		const href = `${location.origin}${url('/register')}#${invite.token}`;
		let copied = false;
		try {
			await navigator.clipboard.writeText(href);
			copied = true;
		} catch {
			// No clipboard access: the link stays visible to copy by hand.
		}
		link = { username: user, url: href, expires_at: invite.expires_at, copied };
	}

	const create = (e: SubmitEvent) => {
		e.preventDefault();
		action(async () => {
			const invite = await createUser({ username, role });
			await showLink(username, invite);
			username = '';
			await load();
		});
	};

	const copyInvite = (user: UserRow) =>
		action(async () => showLink(user.username, await getInvite(user.id)));

	const reset = (user: UserRow) => {
		if (user.status === 'registered' && !confirm(t('users.reset_confirm', { username: user.username })))
			return;
		action(async () => {
			await showLink(user.username, await resetUser(user.id));
			await load();
		});
	};

	const STATUS = {
		registered: { icon: 'check', label: 'users.status.registered', class: 'ok' },
		invited: { icon: null, label: 'users.status.invited', class: '' },
		expired: { icon: 'cross', label: 'users.status.expired', class: 'bad' }
	} as const;
</script>

{#if allowed}
	<main class="page">
		<h1>{t('menu.user_mgmt')}</h1>

		<section aria-labelledby="h-new">
			<h2 id="h-new">{t('users.new_user')}</h2>
			<form class="inline" onsubmit={create}>
				<label>
					{t('common.username')}
					<input
						bind:value={username}
						autocomplete="off"
						autocapitalize="none"
						minlength={rules.username.min_length}
						maxlength={rules.username.max_length}
						pattern={rules.username.pattern}
						title={t('common.username_hint', {
							min: rules.username.min_length,
							max: rules.username.max_length
						})}
						required
					/>
				</label>
				<label>
					{t('users.role')}
					<select bind:value={role} required>
						{#each roles as r (r.id)}
							<option value={r.id}>{r.name}</option>
						{/each}
					</select>
				</label>
				<button disabled={busy}>{t('common.create')}</button>
			</form>
			{#if link}
				<div class="link" role="status">
					<p>
						{t('users.invite_link_for')} <strong>{link.username}</strong>{t('users.valid_until', {
							expires: new Date(link.expires_at).toLocaleString(i18n.lang)
						})}
						{link.copied ? t('users.copied') : t('users.copy_it')}
					</p>
					<input
						aria-label={t('users.invite_link')}
						value={link.url}
						readonly
						onfocus={(e) => e.currentTarget.select()}
					/>
				</div>
			{/if}
			{#if error}<p class="error" role="alert">{error}</p>{/if}
		</section>

		<section aria-labelledby="h-users">
			<h2 id="h-users">{t('users.users')}</h2>
			<table>
				<thead>
					<tr>
						<th><span class="visually-hidden">{t('users.status')}</span></th>
						<th>{t('common.username')}</th>
						<th>{t('users.name')}</th>
						<th>{t('users.role')}</th>
						<th><span class="visually-hidden">{t('users.actions')}</span></th>
					</tr>
				</thead>
				<tbody>
					{#each users as user (user.id)}
						{@const status = STATUS[user.status]}
						<tr>
							<td class="status {status.class}" title={t(status.label)}>
								{#if status.icon}<Icon name={status.icon} />{/if}
								<span class="visually-hidden">{t(status.label)}</span>
							</td>
							<td>{user.username}</td>
							<td>{user.name ?? ''}</td>
							<td>{roles.find((r) => r.id === user.role)?.name ?? user.role}</td>
							<td class="actions">
								{#if user.status === 'invited'}
									<button
										class="icon"
										title={t('users.copy_invite')}
										aria-label={t('users.copy_invite')}
										onclick={() => copyInvite(user)}
										disabled={busy}
									>
										<Icon name="copy" />
									</button>
								{:else if user.username !== session.user?.username}
									<button
										class="icon"
										title={t('users.reset')}
										aria-label={t('users.reset')}
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
		margin-top: var(--space-2);
	}
	h2 {
		font-size: var(--text-lg);
		margin: 0 0 var(--space-3);
	}
	section {
		margin-bottom: var(--space-7);
		padding: var(--space-5);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	form.inline {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: end;
	}
	form.inline label {
		flex: 1 1 12rem;
	}
	.link {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-4);
	}
	.link p {
		margin: 0;
		font-size: var(--text-label);
	}
	.link input {
		width: 100%;
		font-family: ui-monospace, monospace;
		font-size: var(--text-sm);
	}
	.error {
		margin-top: var(--space-3);
	}
	table {
		width: 100%;
		border-collapse: collapse;
	}
	th,
	td {
		padding: var(--space-2) var(--space-2);
		text-align: left;
		border-bottom: 1px solid var(--border);
	}
	th {
		font-size: var(--text-sm);
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
