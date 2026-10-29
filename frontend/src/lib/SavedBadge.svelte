<script lang="ts">
	// On a thumbnail, bottom right: a phone if the clip or video at `path` is saved
	// on this device (plays offline), a cloud if not downloaded yet.
	import Icon from './Icon.svelte';
	import { t } from './i18n.svelte';
	import { isSaved } from './offline.svelte';

	let { path }: { path: string } = $props();
	const saved = $derived(isSaved(path));
	const label = $derived(saved ? t('media.saved') : t('media.not_saved'));
</script>

<span class="badge" class:saved role="img" aria-label={label} title={label}>
	<Icon name={saved ? 'phone' : 'cloud'} size={14} />
</span>

<style>
	.badge {
		display: grid;
		place-items: center;
		padding: var(--space-1);
		color: var(--on-media);
		background: var(--scrim);
		border-radius: var(--radius-xs);
		line-height: 0;
	}
</style>
