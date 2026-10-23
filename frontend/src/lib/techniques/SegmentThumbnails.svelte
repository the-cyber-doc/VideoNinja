<script lang="ts">
	// The thumbnails of a technique's video segments, with their duration. Clicking
	// one plays its clip (SegmentPlayer). Pictures and clips are served by
	// /media/segment/<id>… (session + access checked by the app), and kept by the
	// service worker for offline use.
	import type { Segment } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import { segmentDuration, thumbnailUrl } from '../media';
	import { formatTime } from '../time';
	import SegmentPlayer from './SegmentPlayer.svelte';

	let { segments, title }: { segments: Segment[]; title: string } = $props();
	let failed = $state<Record<number, boolean>>({});
	let playing = $state<Segment | null>(null);
</script>

{#if segments.length}
	<ul>
		{#each segments as segment (segment.id)}
			{@const duration = formatTime(segmentDuration(segment))}
			<li data-id={segment.id}>
				<button type="button" aria-label={t('technique.play', { duration })} onclick={() => (playing = segment)}>
					{#if failed[segment.id]}
						<div class="placeholder"></div>
					{:else}
						<img src={thumbnailUrl(segment)} alt="" loading="lazy" onerror={() => (failed[segment.id] = true)} />
					{/if}
					<span class="duration">{duration}</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if playing}
		<SegmentPlayer segment={playing} {title} onclose={() => (playing = null)} />
	{/if}
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
	button {
		display: grid;
		gap: 0.25rem;
		width: 100%;
		padding: 0;
		font-size: 0.85rem;
		color: var(--muted);
		text-align: center;
		background: none;
		border: 0;
		cursor: pointer;
	}
	button:hover img,
	button:focus-visible img {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	img,
	.placeholder {
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: var(--border);
		border-radius: 6px;
	}
	.duration {
		font-variant-numeric: tabular-nums;
	}
</style>
