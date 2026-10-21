<script lang="ts">
	import { api, type User } from '#lib/api.js';
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
			session.user = await api<User>('/api/profile/name', { name });
			name = session.user.name ?? '';
			return 'Name saved.';
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
			passwordStatus.error = 'The new passwords do not match.';
			return;
		}
		run(passwordStatus, async () => {
			await api('/api/profile/password', {
				current_password: currentPassword,
				new_password: newPassword
			});
			currentPassword = newPassword = newPassword2 = '';
			return 'Password changed. Your other sessions were logged out.';
		});
	};

	// Authenticator (TOTP)
	let totp = $state<{ secret: string; qr: string } | null>(null);
	let totpCode = $state('');
	let totpPassword = $state('');
	const totpStatus = $state(status());

	const startTotp = () =>
		run(totpStatus, async () => {
			totp = await api('/api/profile/totp', {});
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
			await api('/api/profile/totp/confirm', {
				current_password: totpPassword,
				totp_secret: totp!.secret,
				totp_code: totpCode
			});
			cancelTotp();
			return 'Authenticator replaced. Your other sessions were logged out.';
		});
	};
</script>

{#if user}
	<main class="card">
		<h1>Profile</h1>
		<p class="hint">Username: <strong>{user.username}</strong> ({user.role})</p>

		<section aria-labelledby="h-name">
			<h2 id="h-name">Display name</h2>
			<form onsubmit={saveName}>
				<label>
					Name (optional)
					<input bind:value={name} autocomplete="name" maxlength={rules.display_name.max_length} />
				</label>
				{#if nameStatus.error}<p class="error" role="alert">{nameStatus.error}</p>{/if}
				{#if nameStatus.done}<p class="ok" role="status">{nameStatus.done}</p>{/if}
				<button disabled={nameStatus.busy}>Save name</button>
			</form>
		</section>

		<section aria-labelledby="h-password">
			<h2 id="h-password">Password</h2>
			<form onsubmit={savePassword}>
				<!-- Lets password managers attach the new password to the right account. -->
				<input type="text" value={user.username} autocomplete="username" hidden readonly />
				<label>
					Current password
					<input
						type="password"
						bind:value={currentPassword}
						autocomplete="current-password"
						maxlength={rules.password.max_length}
						required
					/>
				</label>
				<label>
					New password (at least {rules.password.min_length} characters)
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
					Confirm new password
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
				<button disabled={passwordStatus.busy}>Change password</button>
			</form>
		</section>

		<section aria-labelledby="h-totp">
			<h2 id="h-totp">Authenticator</h2>
			{#if !totp}
				<p class="hint">
					Replace the authenticator app (new phone, lost device). The current one keeps working
					until the new one is confirmed.
				</p>
				{#if totpStatus.error}<p class="error" role="alert">{totpStatus.error}</p>{/if}
				{#if totpStatus.done}<p class="ok" role="status">{totpStatus.done}</p>{/if}
				<button class="secondary" onclick={startTotp} disabled={totpStatus.busy}>
					Set up a new authenticator
				</button>
			{:else}
				<form onsubmit={confirmTotp}>
					<p class="hint">
						Scan this QR code with the new authenticator app, then enter the 6-digit code it shows.
					</p>
					<img class="qr" src={totp.qr} alt="TOTP QR code" width="200" height="200" />
					<p class="hint">Or enter this key manually: <code class="secret">{totp.secret}</code></p>
					<label>
						Code from the new app
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
						Current password
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
							Cancel
						</button>
						<button disabled={totpStatus.busy}>Confirm</button>
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
