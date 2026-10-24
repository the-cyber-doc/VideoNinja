<script lang="ts">
	// "A new version of the app is available" with Reload. Never reloads by itself:
	// an annotation may be in progress.
	import { t } from './i18n.svelte';
	import { onAppUpdated } from './pwa';

	let updated = $state(false);

	$effect(() => onAppUpdated(() => (updated = true)));
</script>

{#if updated}
	<div class="update" role="status">
		<span>{t('app.update_available')}</span>
		<button type="button" onclick={() => location.reload()}>{t('app.reload')}</button>
	</div>
{/if}

<style>
	.update {
		position: fixed;
		inset: auto 1rem 1rem;
		z-index: 100;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: 0.5rem 1rem;
		max-width: 32rem;
		margin: 0 auto;
		padding: 0.75rem 1rem;
		background: var(--surface);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		box-shadow: 0 0.25rem 1rem rgb(0 0 0 / 0.2);
	}
</style>
