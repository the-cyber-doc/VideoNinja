<script lang="ts">
	import { session } from '#lib/session.svelte.js';
</script>

{#if session.user}
	<main class="card">
		<h1>Video Ninja</h1>
		<p>
			Logged in as <strong>{session.user.name ?? session.user.username}</strong> ({session.user
				.role}).
		</p>
	</main>
{/if}
