<script lang="ts">
	import { t } from '#lib/i18n.svelte.js';
	import { session } from '#lib/session.svelte.js';
</script>

{#if session.user}
	<main class="card">
		<h1>Video Ninja</h1>
		<p>
			{t('home.logged_in_as')} <strong>{session.user.name ?? session.user.username}</strong> ({session
				.user.role_name}).
		</p>
	</main>
{/if}
