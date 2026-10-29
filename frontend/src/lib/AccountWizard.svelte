<script lang="ts">
	// Account creation wizard, shared by /setup (first start) and /register (an
	// invitation): its steps and state are the Wizard's (wizard.svelte.ts); here, the
	// forms and the navigation to the login page.
	import ErrorMessage from './ErrorMessage.svelte';
	import { goto } from '$app/navigation';
	import { url } from '#lib/base.js';
	import { t } from '#lib/i18n.svelte.js';
	import { onTotpInput, rules } from '#lib/validation.js';
	import { INIT_TASKS, Wizard } from './wizard.svelte';

	/** Invitation token: registration mode. Without it: first-start setup. */
	let { invite }: { invite?: string } = $props();
	// The mode is fixed for the page's lifetime.
	// svelte-ignore state_referenced_locally
	const w = new Wizard(invite);
	const usernameHint = $derived(
		t('common.username_hint', { min: rules.username.min_length, max: rules.username.max_length })
	);
	const toLogin = () => goto(url('/login'), { replace: true });

	$effect(() => {
		w.start().then((next) => {
			if (next === 'login') toLogin(); // set up already
		});
	});

	const submit = (action: () => Promise<unknown>) => (e: SubmitEvent) => {
		e.preventDefault();
		action();
	};
</script>

<main class="card">
	<h1>{w.setup ? t('wizard.setup_title') : t('wizard.register_title')}</h1>

	<ol class="stepper" aria-label={t('wizard.progress')}>
		{#each w.labels as label, i (label)}
			<li class:active={i === w.position} class:done={i < w.position}>
				<span class="dot">{i < w.position ? '✓' : i + 1}</span>
				<span class="label">{t(label)}</span>
			</li>
		{/each}
	</ol>
	<div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax={w.labels.length} aria-valuenow={w.position}>
		<div style:width="{(w.position / w.labels.length) * 100}%"></div>
	</div>

	{#if w.step === 'token' && w.setup}
		<form onsubmit={submit(w.submitToken)}>
			<p class="hint">
				{t('wizard.token_hint')}
				<code>docker logs videoninja</code>.
			</p>
			<label>
				{t('wizard.step.setup_token')}
				<input
					bind:value={w.token}
					autocomplete="off"
					autocapitalize="none"
					maxlength={rules.setup_token.max_length}
					required
				/>
			</label>
			<ErrorMessage error={w.error} />
			<button disabled={w.busy}>{t('common.continue')}</button>
		</form>
	{:else if w.step === 'token'}
		{#if w.error}
			<ErrorMessage error={w.error} />
			<p class="hint">{t('wizard.ask_new_invite')}</p>
		{:else}
			<p class="hint">{t('wizard.checking_invite')}</p>
		{/if}
	{:else if w.step === 'account'}
		<form onsubmit={submit(w.submitAccount)}>
			{#if w.setup}
				<label>
					{t('common.username')}
					<input
						bind:value={w.username}
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
				<p>{t('common.username_label')} <strong>{w.username}</strong></p>
				<!-- Lets password managers store the password under the right username. -->
				<input type="text" value={w.username} autocomplete="username" hidden readonly />
			{/if}
			<label>
				{t('common.display_name_optional')}
				<input bind:value={w.name} autocomplete="name" maxlength={rules.display_name.max_length} />
			</label>
			<label>
				{t('common.password_min', { min: rules.password.min_length })}
				<input
					type="password"
					bind:value={w.password}
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
					bind:value={w.password2}
					autocomplete="new-password"
					maxlength={rules.password.max_length}
					required
				/>
			</label>
			<ErrorMessage error={w.error} />
			<button disabled={w.busy}>{t('common.continue')}</button>
		</form>
	{:else if w.step === 'authenticator' && w.totp}
		<form onsubmit={submit(w.submitTotp)}>
			<p class="hint">{t('wizard.scan_hint')}</p>
			<img class="qr" src={w.totp.qr} alt={t('common.qr_alt')} width="200" height="200" />
			<p class="hint">{t('common.manual_key')} <code class="secret">{w.totp.secret}</code></p>
			<label>
				{t('common.totp_code')}
				<input
					value={w.totpCode}
					oninput={(e) => (w.totpCode = onTotpInput(e))}
					inputmode="numeric"
					autocomplete="one-time-code"
					minlength={rules.totp_code.min_length}
					pattern={rules.totp_code.pattern}
					placeholder="123456"
					required
				/>
			</label>
			<ErrorMessage error={w.error} />
			<div class="row">
				<button type="button" class="secondary" onclick={w.back} disabled={w.busy}>
					{t('common.back')}
				</button>
				<button disabled={w.busy}>{t('common.create')}</button>
			</div>
		</form>
	{:else if w.step === 'done'}
		{#if w.setup}
			<ul class="tasks">
				{#each INIT_TASKS as task (task)}
					{@const done = w.completed.includes(task)}
					{@const current = w.currentTask === task}
					<li class:done class:current>
						<span class="mark">{done ? '✓' : current ? '…' : '·'}</span>{t(`wizard.task.${task}`)}
					</li>
				{/each}
			</ul>
		{/if}
		<ErrorMessage error={w.error} />
		{#if w.finished}
			<p>
				{w.setup ? t('wizard.setup_ready') : t('wizard.register_ready')}
			</p>
			<button onclick={toLogin}>
				{t('wizard.go_to_login')}
			</button>
		{/if}
	{/if}
</main>

<style>
	.stepper {
		display: flex;
		gap: var(--space-2);
		padding: 0;
		margin: 0 0 var(--space-2);
		list-style: none;
	}
	.stepper li {
		flex: 1;
		display: grid;
		justify-items: center;
		gap: var(--space-1);
		font-size: var(--text-xs);
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
		margin-bottom: var(--space-5);
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
		background: var(--qr-bg);
		border-radius: var(--radius-sm);
	}
	.secret {
		word-break: break-all;
	}
	.row {
		display: flex;
		gap: var(--space-2);
		justify-content: space-between;
	}
	.tasks {
		list-style: none;
		padding: 0;
		margin: 0 0 var(--space-4);
		display: grid;
		gap: var(--space-2);
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
