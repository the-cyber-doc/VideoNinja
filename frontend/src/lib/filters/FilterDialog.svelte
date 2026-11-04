<script lang="ts">
	// A filter pane over the page (a modal dialog at the right; the whole width on a phone):
	// its title, how many items are shown, the criteria (children: fieldsets), Reset and
	// Done. Every change applies at once (the page filters live). Shared by the Videos and
	// Books panes.
	import type { Snippet } from 'svelte';
	import IconButton from '../IconButton.svelte';
	import { t } from '../i18n.svelte';

	let {
		open = $bindable(),
		shown,
		onreset,
		children
	}: { open: boolean; shown: string; onreset: () => void; children: Snippet } = $props();

	let dialog = $state<HTMLDialogElement>();
	$effect(() => {
		if (open && !dialog?.open) dialog?.showModal();
		else if (!open && dialog?.open) dialog.close();
	});

	const id = $props.id();
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{id}-title"
	onclose={() => (open = false)}
	onclick={(e) => e.target === dialog && dialog.close()}
>
	<header>
		<h2 id="{id}-title">{t('filter.title')}</h2>
		<IconButton label={t('filter.close')} icon="cross" onclick={() => dialog?.close()} />
	</header>
	<p class="hint" role="status">{shown}</p>

	{@render children()}

	<footer>
		<button type="button" class="secondary" onclick={onreset}>{t('filter.reset')}</button>
		<button type="button" onclick={() => dialog?.close()}>{t('filter.done')}</button>
	</footer>
</dialog>

<style>
	dialog {
		width: min(24rem, 100vw);
		max-width: 100vw;
		height: 100dvh;
		max-height: 100dvh;
		margin: 0 0 0 auto;
		padding: var(--space-4);
		display: none;
		color: var(--text);
		background: var(--surface);
		border: none;
		border-left: 1px solid var(--border);
		box-shadow: var(--shadow-menu);
	}
	dialog[open] {
		display: grid;
		align-content: start;
		gap: var(--space-4);
		overflow-y: auto;
	}
	dialog::backdrop {
		background: var(--scrim);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
	}
	/* The criteria (the panes' own markup and the shared components'). */
	dialog :global(fieldset) {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: none;
		min-width: 0;
	}
	dialog :global(legend) {
		padding: 0;
		margin-bottom: var(--space-2);
		font-size: var(--text-label);
		font-weight: 600;
	}
	dialog :global(.choices) {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-4);
	}
	dialog :global(.check) {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		color: var(--text);
		cursor: pointer;
	}
	footer {
		display: flex;
		justify-content: space-between;
		gap: var(--space-2);
		padding-top: var(--space-2);
		border-top: 1px solid var(--border);
	}
	@media (max-width: 30rem) {
		dialog {
			width: 100vw;
			border-left: none;
		}
	}
</style>
