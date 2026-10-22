<script lang="ts">
	// The thumbnails of a technique's video segments, with their position in the video.
	// Served by /media/segment/<id>/thumbnail (session + access checked by the app).
	import type { Segment } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import { formatTime } from '../time';

	let { segments }: { segments: Segment[] } = $props();
	let failed = $state<Record<number, boolean>>({});
</script>

{#if segments.length}
	<ul>
		{#each segments as segment (segment.id)}
			{@const label = t('technique.segment', {
				begin: formatTime(segment.begin_s),
				end: formatTime(segment.end_s)
			})}
			<li data-id={segment.id}>
				{#if failed[segment.id]}
					<div class="placeholder" role="img" aria-label={label}></div>
				{:else}
					<img
						src="/media/segment/{segment.id}/thumbnail"
						alt={label}
						loading="lazy"
						onerror={() => (failed[segment.id] = true)}
					/>
				{/if}
				<span>{formatTime(segment.begin_s)}–{formatTime(segment.end_s)}</span>
			</li>
		{/each}
	</ul>
{:else}
	<p class="hint">{t('technique.no_videos')}</p>
{/if}

<style>
	ul {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
		gap: 0.75rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: 0.25rem;
		font-size: 0.85rem;
		color: var(--muted);
		text-align: center;
	}
	img,
	.placeholder {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: var(--border);
		border-radius: 6px;
	}
</style>
