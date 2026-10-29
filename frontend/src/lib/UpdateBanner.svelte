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
		inset: auto var(--space-4) var(--space-4);
		z-index: 100;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: center;
		gap: var(--space-2) var(--space-4);
		max-width: 32rem;
		margin: 0 auto;
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		box-shadow: var(--shadow-banner);
	}
</style>
