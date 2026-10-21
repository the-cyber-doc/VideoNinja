<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, isInitialized } from '#lib/api.js';

	let username = $state('');
	let password = $state('');
	let totpCode = $state('');
	let error = $state('');
	let busy = $state(false);

	$effect(() => {
		isInitialized().then((ok) => {
			if (!ok) goto('/setup', { replaceState: true });
		});
	});

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		error = '';
		try {
			await api('/api/auth/login', { username, password, totp_code: totpCode });
			goto('/', { replaceState: true });
		} catch (e) {
			error = (e as Error).message;
			totpCode = '';
		} finally {
			busy = false;
		}
	}
</script>

<main class="card">
	<h1>Log in</h1>
	<form onsubmit={submit}>
		<label>
			Username
			<input bind:value={username} autocomplete="username" autocapitalize="none" required />
		</label>
		<label>
			Password
			<input type="password" bind:value={password} autocomplete="current-password" required />
		</label>
		<label>
			Authenticator code
			<input
				bind:value={totpCode}
				inputmode="numeric"
				autocomplete="one-time-code"
				pattern={'\\d{6}'}
				maxlength="6"
				placeholder="123456"
			/>
		</label>
		{#if error}<p class="error" role="alert">{error}</p>{/if}
		<button disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
	</form>
</main>
