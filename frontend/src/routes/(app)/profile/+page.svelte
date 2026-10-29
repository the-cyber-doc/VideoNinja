<script lang="ts">
	import * as profile from '#lib/api/profile.js';
	import type { TotpEnrollment } from '#lib/api/types.js';
	import { t } from '#lib/i18n.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { onTotpInput, rules } from '#lib/validation.js';

	// The (app) layout only renders this page once the user is loaded.
	const user = $derived(session.user!);

	/** busy / error / success message of one section. */
	function status() {
		return { busy: false, error: '', done: '' };
	}

	async function run(s: ReturnType<typeof status>, action: () => Promise<string>) {
		s.busy = true;
		s.error = s.done = '';
		try {
			s.done = await action();
		} catch (e) {
			s.error = (e as Error).message;
		} finally {
			s.busy = false;
		}
	}

	// Display name
	let name = $state(session.user?.name ?? '');
	const nameStatus = $state(status());

	const saveName = (e: SubmitEvent) => {
		e.preventDefault();
		run(nameStatus, async () => {
			session.user = await profile.setName(name);
			name = session.user.name ?? '';
			return t('profile.name_saved');
		});
	};

	// Password
	let currentPassword = $state('');
	let newPassword = $state('');
	let newPassword2 = $state('');
	const passwordStatus = $state(status());

	const savePassword = (e: SubmitEvent) => {
		e.preventDefault();
		if (newPassword !== newPassword2) {
			passwordStatus.done = '';
			passwordStatus.error = t('profile.new_passwords_mismatch');
			return;
		}
		run(passwordStatus, async () => {
			await profile.setPassword({ current_password: currentPassword, new_password: newPassword });
			currentPassword = newPassword = newPassword2 = '';
			return t('profile.password_changed');
		});
	};

	// Authenticator (TOTP)
	let totp = $state<TotpEnrollment | null>(null);
	let totpCode = $state('');
	let totpPassword = $state('');
	const totpStatus = $state(status());

	const startTotp = () =>
		run(totpStatus, async () => {
			totp = await profile.newTotp();
			return '';
		});

	const cancelTotp = () => {
		totp = null;
		totpCode = totpPassword = '';
		totpStatus.error = '';
	};

	const confirmTotp = (e: SubmitEvent) => {
		e.preventDefault();
		run(totpStatus, async () => {
			await profile.confirmTotp({
				current_password: totpPassword,
				totp_secret: totp!.secret,
				totp_code: totpCode
			});
			cancelTotp();
			return t('profile.totp_replaced');
		});
	};
</script>

{#if user}
	<main class="card">
		<h1>{t('profile.title')}</h1>
		<p class="hint">
			{t('common.username_label')} <strong>{user.username}</strong> ({user.role_name})
		</p>

		<section aria-labelledby="h-name">
			<h2 id="h-name">{t('profile.name_section')}</h2>
			<form onsubmit={saveName}>
				<label>
					{t('profile.name_optional')}
					<input bind:value={name} autocomplete="name" maxlength={rules.display_name.max_length} />
				</label>
				{#if nameStatus.error}<p class="error" role="alert">{nameStatus.error}</p>{/if}
				{#if nameStatus.done}<p class="ok" role="status">{nameStatus.done}</p>{/if}
				<button disabled={nameStatus.busy}>{t('profile.save_name')}</button>
			</form>
		</section>

		<section aria-labelledby="h-password">
			<h2 id="h-password">{t('profile.password_section')}</h2>
			<form onsubmit={savePassword}>
				<!-- Lets password managers attach the new password to the right account. -->
				<input type="text" value={user.username} autocomplete="username" hidden readonly />
				<label>
					{t('common.current_password')}
					<input
						type="password"
						bind:value={currentPassword}
						autocomplete="current-password"
						maxlength={rules.password.max_length}
						required
					/>
				</label>
				<label>
					{t('profile.new_password_min', { min: rules.password.min_length })}
					<input
						type="password"
						bind:value={newPassword}
						autocomplete="new-password"
						minlength={rules.password.min_length}
						maxlength={rules.password.max_length}
						required
					/>
				</label>
				<label>
					{t('profile.confirm_new_password')}
					<input
						type="password"
						bind:value={newPassword2}
						autocomplete="new-password"
						maxlength={rules.password.max_length}
						required
					/>
				</label>
				{#if passwordStatus.error}<p class="error" role="alert">{passwordStatus.error}</p>{/if}
				{#if passwordStatus.done}<p class="ok" role="status">{passwordStatus.done}</p>{/if}
				<button disabled={passwordStatus.busy}>{t('profile.change_password')}</button>
			</form>
		</section>

		<section aria-labelledby="h-totp">
			<h2 id="h-totp">{t('profile.totp_section')}</h2>
			{#if !totp}
				<p class="hint">{t('profile.totp_hint')}</p>
				{#if totpStatus.error}<p class="error" role="alert">{totpStatus.error}</p>{/if}
				{#if totpStatus.done}<p class="ok" role="status">{totpStatus.done}</p>{/if}
				<button class="secondary" onclick={startTotp} disabled={totpStatus.busy}>
					{t('profile.totp_start')}
				</button>
			{:else}
				<form onsubmit={confirmTotp}>
					<p class="hint">{t('profile.totp_scan')}</p>
					<img class="qr" src={totp.qr} alt={t('common.qr_alt')} width="200" height="200" />
					<p class="hint">{t('common.manual_key')} <code class="secret">{totp.secret}</code></p>
					<label>
						{t('profile.totp_new_code')}
						<input
							value={totpCode}
							oninput={(e) => (totpCode = onTotpInput(e))}
							inputmode="numeric"
							autocomplete="one-time-code"
							minlength={rules.totp_code.min_length}
							pattern={rules.totp_code.pattern}
							placeholder="123456"
							required
						/>
					</label>
					<label>
						{t('common.current_password')}
						<input
							type="password"
							bind:value={totpPassword}
							autocomplete="current-password"
							maxlength={rules.password.max_length}
							required
						/>
					</label>
					{#if totpStatus.error}<p class="error" role="alert">{totpStatus.error}</p>{/if}
					<div class="row">
						<button type="button" class="secondary" onclick={cancelTotp} disabled={totpStatus.busy}>
							{t('common.cancel')}
						</button>
						<button disabled={totpStatus.busy}>{t('common.confirm')}</button>
					</div>
				</form>
			{/if}
		</section>
	</main>
{/if}

<style>
	section {
		display: grid;
		gap: 0.75rem;
		padding-top: 1.25rem;
		margin-top: 1.25rem;
		border-top: 1px solid var(--border);
	}
	h2 {
		font-size: 1.1rem;
		margin: 0;
	}
	.ok {
		color: var(--ok);
		margin: 0;
	}
	.qr {
		justify-self: center;
		background: #fff;
		border-radius: 6px;
	}
	.secret {
		word-break: break-all;
	}
	.row {
		display: flex;
		gap: 0.5rem;
		justify-content: space-between;
	}
</style>
