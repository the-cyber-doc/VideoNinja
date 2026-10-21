<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, isInitialized, ndjson } from '#lib/api.js';
	import { onTotpInput, rules } from '#lib/validation.js';

	const STEPS = ['Setup token', 'Admin account', 'Authenticator', 'Initialization'];
	const INIT_TASKS = [
		{ id: 'schema', label: 'Create the database structure' },
		{ id: 'data', label: 'Load the initial data' },
		{ id: 'admin', label: 'Create the admin user' },
		{ id: 'done', label: 'Finish' }
	];

	let step = $state(0);
	let error = $state('');
	let busy = $state(false);

	let token = $state('');
	let username = $state('admin');
	let name = $state('');
	let password = $state('');
	let password2 = $state('');
	let totp = $state<{ secret: string; qr: string } | null>(null);
	let totpCode = $state('');
	let completed = $state<string[]>([]);
	let finished = $derived(completed.includes('done'));
	const usernameHint = `${rules.username.min_length} to ${rules.username.max_length} characters: lowercase letters, digits, . _ -`;

	$effect(() => {
		isInitialized().then((ok) => {
			if (ok) goto('/login', { replaceState: true });
		});
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
			await api('/api/setup/verify', { token: token.trim() });
			step = 1;
		});
	};

	const submitAccount = (e: SubmitEvent) => {
		e.preventDefault();
		if (password !== password2) {
			error = 'The passwords do not match.';
			return;
		}
		run(async () => {
			totp = await api('/api/setup/totp', { token: token.trim(), username });
			step = 2;
		});
	};

	const submitTotp = (e: SubmitEvent) => {
		e.preventDefault();
		run(async () => {
			const body = {
				token: token.trim(),
				username,
				name,
				password,
				totp_secret: totp!.secret,
				totp_code: totpCode
			};
			// Validation errors (e.g. a wrong code) throw here, before anything is created.
			const events = ndjson<{ step?: string; error?: string }>('/api/setup/complete', body);
			const first = await events.next();
			step = 3;
			for (let r = first; !r.done; r = await events.next()) {
				if (r.value.error) throw new Error(r.value.error);
				if (r.value.step) completed = [...completed, r.value.step];
			}
			password = password2 = '';
			if (!finished) throw new Error('Setup ended unexpectedly, see the server logs.');
		});
	};
</script>

<main class="card">
	<h1>Set up Video Ninja</h1>

	<ol class="stepper" aria-label="Setup progress">
		{#each STEPS as label, i (label)}
			<li class:active={i === step} class:done={i < step || finished}>
				<span class="dot">{i < step || finished ? '✓' : i + 1}</span>
				<span class="label">{label}</span>
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

	{#if step === 0}
		<form onsubmit={submitToken}>
			<p class="hint">
				For security, setup needs the one-time token printed in the server logs, e.g.
				<code>docker logs videoninja</code>.
			</p>
			<label>
				Setup token
				<input
					bind:value={token}
					autocomplete="off"
					autocapitalize="none"
					maxlength={rules.setup_token.max_length}
					required
				/>
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button disabled={busy}>Continue</button>
		</form>
	{:else if step === 1}
		<form onsubmit={submitAccount}>
			<label>
				Username
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
			<label>
				Display name (optional)
				<input bind:value={name} autocomplete="name" maxlength={rules.display_name.max_length} />
			</label>
			<label>
				Password (at least {rules.password.min_length} characters)
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
				Confirm password
				<input
					type="password"
					bind:value={password2}
					autocomplete="new-password"
					maxlength={rules.password.max_length}
					required
				/>
			</label>
			{#if error}<p class="error" role="alert">{error}</p>{/if}
			<button disabled={busy}>Continue</button>
		</form>
	{:else if step === 2 && totp}
		<form onsubmit={submitTotp}>
			<p class="hint">
				Scan this QR code with an authenticator app (Aegis, Google Authenticator, 1Password…),
				then enter the 6-digit code it shows.
			</p>
			<img class="qr" src={totp.qr} alt="TOTP QR code" width="200" height="200" />
			<p class="hint">Or enter this key manually: <code class="secret">{totp.secret}</code></p>
			<label>
				Authenticator code
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
				<button type="button" class="secondary" onclick={() => (step = 1)} disabled={busy}>Back</button>
				<button disabled={busy}>Create</button>
			</div>
		</form>
	{:else if step === 3}
		<ul class="tasks">
			{#each INIT_TASKS as task (task.id)}
				{@const done = completed.includes(task.id)}
				{@const current = !done && busy && INIT_TASKS.findIndex((t) => !completed.includes(t.id)) === INIT_TASKS.indexOf(task)}
				<li class:done class:current>
					<span class="mark">{done ? '✓' : current ? '…' : '·'}</span>{task.label}
				</li>
			{/each}
		</ul>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		{#if finished}
			<p>Video Ninja is ready. Log in with your new admin account.</p>
			<button onclick={() => goto('/login', { replaceState: true })}>Go to login</button>
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
