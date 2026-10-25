<script lang="ts">
	// For a branch of the catalogue (its segments): a phone if every clip is saved on
	// this device, a cloud if one is missing, a progress ring while downloading.
	// Click: the cloud downloads them all, the phone removes them, the ring stops.
	// Nothing without segments, or without a service worker to keep them.
	import type { Segment } from './catalog.svelte';
	import { t } from './i18n.svelte';
	import Icon from './Icon.svelte';
	import { clipUrl } from './media';
	import { cancel, download, isQueued, isSaved, offline, remove } from './offline.svelte';

	let { segments }: { segments: Segment[] } = $props();
	/** Above this many missing clips, ask first: they take space. */
	const CONFIRM_ABOVE = 20;

	const paths = $derived(segments.map(clipUrl));
	const done = $derived(paths.filter(isSaved).length);
	const busy = $derived(paths.some(isQueued));
	const all = $derived(done === paths.length);
	const label = $derived(
		busy
			? t('offline.progress', { done, total: paths.length })
			: all
				? t('offline.remove', { n: paths.length })
				: t('offline.download', { n: paths.length })
	);
	// The ring's arc: the part already saved.
	const RADIUS = 9;
	const arc = $derived(2 * Math.PI * RADIUS * (paths.length ? done / paths.length : 0));

	function toggle(event: MouseEvent) {
		event.preventDefault(); // inside a card: never follow its link
		event.stopPropagation();
		if (busy) cancel(paths);
		else if (all) remove(paths);
		else {
			const missing = paths.length - done;
			if (missing > CONFIRM_ABOVE && !confirm(t('offline.confirm', { n: missing }))) return;
			download(paths);
		}
	}
</script>

{#if offline.available && paths.length}
	<button
		type="button"
		class="offline"
		class:saved={all && !busy}
		class:busy
		title={label}
		aria-label={label}
		onclick={toggle}
	>
		{#if busy}
			<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
				<circle cx="12" cy="12" r={RADIUS} fill="none" stroke="currentColor" stroke-opacity="0.35" stroke-width="3" />
				<circle
					cx="12"
					cy="12"
					r={RADIUS}
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-dasharray="{arc} 100"
					transform="rotate(-90 12 12)"
				/>
			</svg>
			<span class="count">{done}/{paths.length}</span>
		{:else}
			<Icon name={all ? 'phone' : 'cloud'} size={16} />
		{/if}
	</button>
{/if}

<style>
	.offline {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		min-width: 1.9rem;
		min-height: 1.9rem;
		padding: 0.25rem 0.35rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		line-height: 1;
		color: #fff;
		background: rgb(0 0 0 / 0.6);
		border: 0;
		border-radius: 6px;
		cursor: pointer;
	}
	.offline:hover,
	.offline:focus-visible {
		background: rgb(0 0 0 / 0.8);
	}
	.offline:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
</style>
