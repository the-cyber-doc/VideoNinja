<script lang="ts">
	// Account creation wizard, shared by two pages:
	// - /setup (first start): setup token from the server logs, creates the admin
	//   and the database;
	// - /register (invitation): the invitation token from the link, the username
	//   chosen by the admin.
	import { goto } from '$app/navigation';
	import { errorFromBody } from '#lib/api/client.js';
	import * as register from '#lib/api/register.js';
	import * as setupApi from '#lib/api/setup.js';
	import { url } from '#lib/base.js';
	import { t, type MessageKey } from '#lib/i18n.svelte.js';
	import { onTotpInput, rules } from '#lib/validation.js';

	/** Invitation token: registration mode. Without it: first-start setup. */
	let { invite }: { invite?: string } = $props();
	// The mode is fixed for the page's lifetime.
	// svelte-ignore state_referenced_locally
	const setup = invite === undefined;

	const STEPS: MessageKey[] = setup
		? ['wizard.step.setup_token', 'wizard.step.admin', 'wizard.step.authenticator', 'wizard.step.init']
		: ['wizard.step.invitation', 'wizard.step.account', 'wizard.step.authenticator', 'wizard.step.done'];
	// The setup steps reported by the server, in order.
	const INIT_TASKS = ['schema', 'data', 'admin', 'done'] as const;

	let step = $state(0);
	let error = $state('');
	let busy = $state(false);

	let token = $state('');
	let username = $state(setup ? 'admin' : '');
	let name = $state('');
	let password = $state('');
	let password2 = $state('');
	let totp = $state<{ secret: string; qr: string } | null>(null);
	let totpCode = $state('');
	let completed = $state<string[]>([]);
	let registered = $state(false);
	let finished = $derived(setup ? completed.includes('done') : registered);
	const usernameHint = $derived(
		t('common.username_hint', { min: rules.username.min_length, max: rules.username.max_length })
	);

	$effect(() => {
		if (setup) {
			setupApi.isInitialized().then((ok) => {
				if (ok) goto(url('/login'), { replace: true });
			});
		} else {
			// The invitation is checked at once: the user sees who it is for, or why it fails.
			run(async () => {
				username = (await register.verifyInvite(invite)).username;
				step = 1;
			});
		}
	});

	/** Run an action with busy/error handling. */
	async function run(action: () => Promise<void>) {
		busy = true;
		error = '';
		try {
			await action();
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busy = false;
		}
	}

	const submitToken = (e: SubmitEvent) => {
		e.preventDefault();
		run(async () => {
			await setupApi.verifyToken(token.trim());
			step = 1;
		});
	};

	const submitAccount = (e: SubmitEvent) => {
		e.preventDefault();
		if (password !== password2) {
			error = t('common.passwords_mismatch');
			return;
		}
		run(async () => {
			totp = setup
				? await setupApi.newTotp(token.trim(), username)
				: await register.newTotp(invite);
			step = 2;
		});
	};

	const submitTotp = (e: SubmitEvent) => {
		e.preventDefault();
		run(async () => {
			const credentials = { name, password, totp_secret: totp!.secret, totp_code: totpCode };
			if (!setup) {
				await register.complete({ token: invite, ...credentials });
				password = password2 = '';
				registered = true;
				step = 3;
				return;
			}
			// Validation errors (e.g. a wrong code) throw here, before anything is created.
			// A failure after the answer started (status 200 sent): {error: {code, detail, params}}.
			const events = setupApi.complete({
				token: token.trim(),
				username,
				...credentials
			});
			const first = await events.next();
			step = 3;
			for (let r = first; !r.done; r = await events.next()) {
				if (r.value.error) throw errorFromBody(0, r.value.error);
				if (r.value.step) completed = [...completed, r.value.step];
			}
			password = password2 = '';
			if (!finished) throw new Error(t('wizard.setup_unexpected_end'));
		});
	};
</script>

<main class="card">
	<h1>{setup ? t('wizard.setup_title') : t('wizard.register_title')}</h1>

	<ol class="stepper" aria-label={t('wizard.progress')}>
		{#each STEPS as label, i (label)}
			<li class:active={i === step} class:done={i < step || finished}>
				<span class="dot">{i < step || finished ? '✓' : i + 1}</span>
				<span class="label">{t(label)}</span>
			</li>
		{/each}
	</ol>
	<div
		class="bar"
		role="progressbar"
		aria-valuemin="0"
		aria-valuemax={STEPS.length}
		aria-valuenow={finished ? STEPS.length : step}
	>
		<div style:width="{((finished ? STEPS.length : step) / STEPS.length) * 100}%"></div>
	</div>

	{#if step === 0 && setup}
		<form onsubmit={submitToken}>
			<p class="hint">
				{t('wizard.token_hint')}
				<code>docker logs videoninja</code>.
			</p>
			<label>
				{t('wizard.step.setup_token')}
				<input
					bind:value={token}
					autocomplete="off"
					autocapitalize="none"
					maxlength={rules.setup_token.max_length}
					required
				/>
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button disabled={busy}>{t('common.continue')}</button>
		</form>
	{:else if step === 0}
		{#if error}
			<p class="error" role="alert">{error}</p>
			<p class="hint">{t('wizard.ask_new_invite')}</p>
		{:else}
			<p class="hint">{t('wizard.checking_invite')}</p>
		{/if}
	{:else if step === 1}
		<form onsubmit={submitAccount}>
			{#if setup}
				<label>
					{t('common.username')}
					<input
						bind:value={username}
						autocomplete="username"
						autocapitalize="none"
						minlength={rules.username.min_length}
						maxlength={rules.username.max_length}
						pattern={rules.username.pattern}
						title={usernameHint}
						required
					/>
				</label>
			{:else}
				<p>{t('common.username_label')} <strong>{username}</strong></p>
				<!-- Lets password managers store the password under the right username. -->
				<input type="text" value={username} autocomplete="username" hidden readonly />
			{/if}
			<label>
				{t('common.display_name_optional')}
				<input bind:value={name} autocomplete="name" maxlength={rules.display_name.max_length} />
			</label>
			<label>
				{t('common.password_min', { min: rules.password.min_length })}
				<input
					type="password"
					bind:value={password}
					autocomplete="new-password"
					minlength={rules.password.min_length}
					maxlength={rules.password.max_length}
					required
				/>
			</label>
			<label>
				{t('common.confirm_password')}
				<input
					type="password"
					bind:value={password2}
					autocomplete="new-password"
					maxlength={rules.password.max_length}
					required
				/>
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button disabled={busy}>{t('common.continue')}</button>
		</form>
	{:else if step === 2 && totp}
		<form onsubmit={submitTotp}>
			<p class="hint">{t('wizard.scan_hint')}</p>
			<img class="qr" src={totp.qr} alt={t('common.qr_alt')} width="200" height="200" />
			<p class="hint">{t('common.manual_key')} <code class="secret">{totp.secret}</code></p>
			<label>
				{t('common.totp_code')}
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
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<div class="row">
				<button type="button" class="secondary" onclick={() => (step = 1)} disabled={busy}>
					{t('common.back')}
				</button>
				<button disabled={busy}>{t('common.create')}</button>
			</div>
		</form>
	{:else if step === 3}
		{#if setup}
			<ul class="tasks">
				{#each INIT_TASKS as task (task)}
					{@const done = completed.includes(task)}
					{@const current = !done && busy && INIT_TASKS.find((id) => !completed.includes(id)) === task}
					<li class:done class:current>
						<span class="mark">{done ? '✓' : current ? '…' : '·'}</span>{t(`wizard.task.${task}`)}
					</li>
				{/each}
			</ul>
		{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if finished}
			<p>
				{setup ? t('wizard.setup_ready') : t('wizard.register_ready')}
			</p>
			<button onclick={() => goto(url('/login'), { replace: true })}>
				{t('wizard.go_to_login')}
			</button>
		{/if}
	{/if}
</main>

<style>
	.stepper {
		display: flex;
		gap: 0.5rem;
		padding: 0;
		margin: 0 0 0.5rem;
		list-style: none;
	}
	.stepper li {
		flex: 1;
		display: grid;
		justify-items: center;
		gap: 0.2rem;
		font-size: 0.75rem;
		color: var(--muted);
		text-align: center;
	}
	.dot {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 50%;
		border: 1px solid var(--border);
		font-weight: 600;
	}
	.stepper li.active {
		color: var(--text);
	}
	.stepper li.active .dot {
		border-color: var(--accent);
		color: var(--accent);
	}
	.stepper li.done .dot {
		background: var(--ok);
		border-color: var(--ok);
		color: var(--surface);
	}
	.bar {
		height: 4px;
		margin-bottom: 1.25rem;
		background: var(--border);
		border-radius: 2px;
		overflow: hidden;
	}
	.bar div {
		height: 100%;
		background: var(--accent);
		transition: width 0.3s;
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
	.tasks {
		list-style: none;
		padding: 0;
		margin: 0 0 1rem;
		display: grid;
		gap: 0.4rem;
	}
	.tasks li {
		color: var(--muted);
	}
	.tasks li.current {
		color: var(--text);
	}
	.tasks li.done {
		color: var(--text);
	}
	.mark {
		display: inline-block;
		width: 1.5rem;
		font-weight: 700;
	}
	.tasks li.done .mark {
		color: var(--ok);
	}
</style>
