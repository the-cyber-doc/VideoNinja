<script lang="ts">
	// User management: the list (this page's data, +page.ts: access checked there) and
	// its actions (users.svelte.ts). Markup only, and the confirmations.
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import type { UserRow } from '#lib/api/types.js';
	import { i18n, t } from '#lib/i18n.svelte.js';
	import IconButton from '#lib/IconButton.svelte';
	import Icon from '#lib/Icon.svelte';
	import { session } from '#lib/session.svelte.js';
	import { rules } from '#lib/validation.js';
	import type { PageProps } from './$types';
	import { UserAdmin } from './users.svelte';

	let { data }: PageProps = $props();
	const admin = new UserAdmin();
	let username = $state('');
	let role = $state('user');

	const create = async (e: SubmitEvent) => {
		e.preventDefault();
		if (await admin.create(username, role)) username = '';
	};

	const reset = (user: UserRow) => {
		if (user.status === 'registered' && !confirm(t('users.reset_confirm', { username: user.username }))) return;
		admin.reset(user);
	};

	const deactivate = (user: UserRow) => {
		if (confirm(t('users.deactivate_confirm', { username: user.username }))) admin.deactivate(user);
	};

	const changeRole = async (user: UserRow, select: HTMLSelectElement) => {
		if (!(await admin.changeRole(user, select.value))) select.value = user.role; // refused: as it was
	};

	const remove = (user: UserRow) => {
		if (confirm(t('users.delete_confirm', { username: user.username }))) admin.remove(user);
	};

	const STATUS = {
		registered: { icon: 'check', label: 'users.status.registered', class: 'ok' },
		invited: { icon: null, label: 'users.status.invited', class: '' },
		expired: { icon: 'cross', label: 'users.status.expired', class: 'bad' },
		deactivated: { icon: 'user-off', label: 'users.status.deactivated', class: 'off' }
	} as const;
</script>

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
					{#each data.roles as r (r.id)}
						<option value={r.id}>{r.name}</option>
					{/each}
				</select>
			</label>
			<button disabled={admin.busy}>{t('common.create')}</button>
		</form>
		{#if admin.link}
			<div class="link" role="status">
				<p>
					{t('users.invite_link_for')} <strong>{admin.link.username}</strong>{t('users.valid_until', {
						expires: new Date(admin.link.expires_at).toLocaleString(i18n.lang)
					})}
					{admin.link.copied ? t('users.copied') : t('users.copy_it')}
				</p>
				<input
					aria-label={t('users.invite_link')}
					value={admin.link.url}
					readonly
					onfocus={(e) => e.currentTarget.select()}
				/>
			</div>
		{/if}
		<ErrorMessage error={admin.error ?? data.error} />
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
				{#each data.users as user (user.id)}
					{@const status = STATUS[user.status]}
					<tr>
						<td class="status {status.class}" title={t(status.label)}>
							{#if status.icon}<Icon name={status.icon} />{/if}
							<span class="visually-hidden">{t(status.label)}</span>
						</td>
						<td>{user.username}</td>
						<td>{user.name ?? ''}</td>
						<td>
							{#if user.username === session.user?.username}
								<!-- One's own role: never changed here (the server refuses it). -->
								{data.roles.find((r) => r.id === user.role)?.name ?? user.role}
							{:else}
								<select
									class="role"
									aria-label={t('users.role_of', { username: user.username })}
									value={user.role}
									onchange={(e) => changeRole(user, e.currentTarget)}
									disabled={admin.busy}
								>
									{#each data.roles as r (r.id)}
										<option value={r.id}>{r.name}</option>
									{/each}
								</select>
							{/if}
						</td>
						<td class="actions">
							{#if user.username !== session.user?.username}
								{#if user.status === 'invited'}
									<IconButton
										label={t('users.copy_invite')}
										icon="copy"
										onclick={() => admin.copyInvite(user)}
										disabled={admin.busy}
									/>
								{:else}
									<IconButton
										label={t(user.status === 'deactivated' ? 'users.reactivate' : 'users.reset')}
										icon="refresh"
										onclick={() => reset(user)}
										disabled={admin.busy}
									/>
								{/if}
								{#if user.status !== 'deactivated'}
									<IconButton
										label={t('users.deactivate')}
										icon="user-off"
										onclick={() => deactivate(user)}
										disabled={admin.busy}
									/>
								{/if}
								<IconButton label={t('users.delete')} icon="trash" onclick={() => remove(user)} disabled={admin.busy} />
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</section>
</main>

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
	td.status.off {
		color: var(--muted);
	}
	select.role {
		width: 100%;
		min-width: 9rem;
	}
	td.actions {
		text-align: right;
		white-space: nowrap;
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
