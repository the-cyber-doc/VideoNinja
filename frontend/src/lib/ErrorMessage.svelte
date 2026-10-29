<script lang="ts">
	// An error for the user: its message (already translated: an ApiError's, or a t()
	// string), announced by screen readers (role alert; `role={null}` for a note that
	// stays on screen, e.g. while editing). A server failure (5xx) also shows its
	// request ID, which the server's and nginx's logs carry: the user can quote it.
	// Nothing is shown when `error` is empty.
	import { ApiError } from './api/client';
	import { t } from './i18n.svelte';

	let {
		error,
		role = 'alert',
		centered = false
	}: { error: unknown; role?: 'alert' | 'status' | null; centered?: boolean } = $props();

	const message = $derived(error instanceof Error ? error.message : error ? String(error) : '');
	const reference = $derived(error instanceof ApiError && error.status >= 500 ? error.requestId : null);
</script>

{#if message}
	<p class="error" class:centered role={role ?? undefined}>
		{message}
		{#if reference}<span class="reference">{t('common.reference', { id: reference })}</span>{/if}
	</p>
{/if}

<style>
	.reference {
		display: block;
		font-size: var(--text-xs);
		font-family: ui-monospace, monospace;
		color: var(--muted);
		user-select: all; /* one click selects it, to copy */
	}
</style>
