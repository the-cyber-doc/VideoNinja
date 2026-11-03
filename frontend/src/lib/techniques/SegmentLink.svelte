<script lang="ts">
	// Over a segment's thumbnail (bottom left): a link to the Videos page of its video,
	// opened on that segment. Only for video managers (the page needs "video_mgmt").
	import { url } from '../base';
	import type { Segment } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import Icon from '../Icon.svelte';
	import { hasAccess } from '../session.svelte';
	import { segmentHref } from '../videos/annotations';

	let { segment }: { segment: Segment } = $props();
</script>

{#if hasAccess('video_mgmt')}
	<a
		class="media-button"
		href={url(segmentHref(segment))}
		title={t('technique.open_video')}
		aria-label={t('technique.open_video')}
	>
		<Icon name="link" size={16} />
	</a>
{/if}
