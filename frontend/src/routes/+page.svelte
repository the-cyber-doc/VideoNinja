<script lang="ts">
	import { goto } from '$app/navigation';
	import { api, currentUser, isInitialized, type User } from '#lib/api.js';

	let user = $state<User | null>(null);
	let error = $state('');

	$effect(() => {
		(async () => {
			try {
				if (!(await isInitialized())) return goto('/setup', { replaceState: true });
				user = await currentUser();
				if (!user) return goto('/login', { replaceState: true });
			} catch (e) {
				error = (e as Error).message;
			}
		})();
	});

	async function logout() {
		await api('/api/auth/logout', {});
		goto('/login', { replaceState: true });
	}
</script>

{#if user}
	<main class="card">
		<h1>Video Ninja</h1>
		<p>Logged in as <strong>{user.name ?? user.username}</strong> ({user.role}).</p>
		<button class="secondary" onclick={logout}>Log out</button>
	</main>
{:else if error}
	<main class="card"><p class="error">{error}</p></main>
{/if}
