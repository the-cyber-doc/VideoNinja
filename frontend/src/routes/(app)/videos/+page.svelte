<script lang="ts">
	// Every published video, in four collapsible sections by how far its annotation
	// is. Open, a section's thumbnails scroll inside it. A thumbnail opens the
	// annotation panel (/videos/<id>). Needs the "video_mgmt" access. The filter button
	// opens a pane that filters and sorts them (inside each section), kept on this device.
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { url } from '#lib/base.js';
	import { t, type MessageKey } from '#lib/i18n.svelte.js';
	import { hasAccess } from '#lib/session.svelte.js';
	import IconButton from '#lib/IconButton.svelte';
	import SearchBox from '#lib/search/SearchBox.svelte';
	import Section from '#lib/Section.svelte';
	import { formatTime } from '#lib/time.js';
	import { offline, removeVideos, savedVideos } from '#lib/offline.svelte.js';
	import SavedBadge from '#lib/SavedBadge.svelte';
	import type { Tag, VideoRow } from '#lib/api/types.js';
	import { listTags } from '#lib/api/tags.js';
	import { listVideos } from '#lib/api/videos.js';
	import FilterPane from '#lib/videos/FilterPane.svelte';
	import {
		activeCount,
		effective,
		filterOptions,
		loadFilter,
		matches,
		saveFilter,
		sortVideos
	} from '#lib/videos/filter.js';
	import { videoThumbnailUrl, videoUrl } from '#lib/media.js';
	import { SECTIONS, videoSection } from '#lib/videos/annotations.js';

	const allowed = $derived(hasAccess('video_mgmt'));
	let videos = $state<VideoRow[] | null>(null);
	let tags = $state<Tag[]>([]); // for the filter: names, kinds and list values
	let error = $state<unknown>(null);
	let failed = $state<Record<number, boolean>>({});
	const saved = page.url.searchParams.has('saved'); // back from the panel

	$effect(() => {
		if (!allowed) {
			goto(url('/'), { replace: true });
			return;
		}
		listVideos().then(
			(list) => (videos = list),
			(e) => (error = e)
		);
		listTags().then(
			(list) => (tags = list),
			(e) => (error = e)
		);
	});

	// The filter as chosen (kept as is, even what no video offers now), and what applies of it.
	let filter = $state(loadFilter());
	let paneOpen = $state(false);
	$effect(() => saveFilter($state.snapshot(filter)));
	const options = $derived(filterOptions(videos ?? [], tags));
	const applied = $derived(effective(filter, options));
	const active = $derived(activeCount(applied));
	const kept = $derived(
		sortVideos(
			(videos ?? []).filter((v) => matches(v, applied)),
			applied.sort
		)
	);

	const groups = $derived(
		SECTIONS.map((section) => ({ section, videos: kept.filter((v) => videoSection(v) === section) }))
	);
	// The first section with videos starts open.
	const firstOpen = $derived(groups.find((g) => g.videos.length)?.section);
	const duration = (v: VideoRow) => (v.duration_s == null ? '' : formatTime(Math.floor(v.duration_s)));

	// Whole videos saved while annotating (hundreds of MB each): removed at once,
	// their badges back to the cloud. Opening one saves it again.
	const stored = $derived(savedVideos().length);
	let removed = $state(false);
	async function removeSaved() {
		await removeVideos();
		removed = true;
	}
</script>

{#if allowed}
	<div class="page">
		<header>
			<h1>{t('videos.title')}</h1>
			<div class="actions">
				<SearchBox />
				<IconButton
					label={active ? t('filter.active', { n: active }) : t('filter.open')}
					icon="filter"
					iconSize={22}
					size="lg"
					round
					class="filter{active ? ' active' : ''}"
					aria-haspopup="dialog"
					disabled={!videos?.length}
					onclick={() => (paneOpen = true)}
				/>
				{#if offline.available}
					{@const label = stored ? t('videos.remove_saved', { n: stored }) : t('videos.none_saved')}
					<IconButton
						{label}
						icon="phone"
						iconSize={22}
						size="lg"
						round
						class="remove"
						disabled={!stored}
						onclick={removeSaved}
					/>
				{/if}
			</div>
		</header>
		{#if saved}<p class="ok" role="status">{t('videos.saved')}</p>{/if}
		{#if removed}<p class="ok" role="status">{t('videos.removed')}</p>{/if}
		<ErrorMessage {error} />

		{#if videos === null && !error}
			<p class="hint centered">{t('common.loading')}</p>
		{:else if videos && !videos.length}
			<p class="hint centered">{t('videos.none')}</p>
		{:else if videos}
			{#if active}
				<p class="hint centered" role="status">{t('videos.filter.shown', { n: kept.length, total: videos.length })}</p>
			{/if}
			{#if !kept.length}<p class="hint centered">{t('videos.filtered_none')}</p>{/if}
			<FilterPane bind:open={paneOpen} bind:filter {options} shown={kept.length} total={videos.length} />
			{#each groups as group (group.section)}
				<Section
					title={t(`videos.section.${group.section}` as MessageKey)}
					count={t('videos.count', { n: group.videos.length })}
					hint={t(`videos.section.${group.section}.hint` as MessageKey)}
					open={group.section === firstOpen}
				>
					{#if group.videos.length}
						<ul class="grid">
							{#each group.videos as video (video.id)}
								<li>
									<a
										href={url(`/videos/${video.id}`)}
										aria-label={t('videos.open', { name: video.original_filename, duration: duration(video) })}
									>
										<span class="picture">
											{#if failed[video.id]}
												<span class="placeholder"></span>
											{:else}
												<img
													src={videoThumbnailUrl(video.id)}
													alt=""
													loading="lazy"
													onerror={() => (failed[video.id] = true)}
												/>
											{/if}
											<span class="corner">
												{#if video.duration_s != null}<span class="duration">{duration(video)}</span>{/if}
												<SavedBadge path={videoUrl(video.id)} />
											</span>
										</span>
										<span class="file">{video.original_filename}</span>
									</a>
								</li>
							{/each}
						</ul>
					{:else}
						<p class="hint empty">{t('videos.empty_section')}</p>
					{/if}
				</Section>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.page {
		max-width: 72rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-3);
	}
	/* The title centred, the search box and the buttons at the right of the same line. */
	header {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		margin-bottom: var(--space-1);
	}
	h1 {
		grid-column: 2;
		text-align: center;
		margin: 0;
	}
	/* At the right of the same line: the filter button, then "remove saved videos" (IconButtons). */
	.actions {
		grid-column: 3;
		justify-self: end;
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}
	/* Phones: the title, then the search box and the buttons on a line of their own. */
	@media (max-width: 40rem) {
		header {
			grid-template-columns: 1fr;
			gap: var(--space-2);
		}
		h1,
		.actions {
			grid-column: 1;
		}
		.actions {
			justify-self: stretch;
			justify-content: flex-end;
		}
		.actions :global(.search-box) {
			flex: 1;
			width: auto;
		}
	}
	.actions :global(.filter),
	.actions :global(.remove) {
		background: var(--bg);
	}
	/* Something filtered or sorted otherwise: the button says so in the accent colour. */
	.actions :global(.filter.active) {
		color: var(--accent);
		border-color: var(--accent);
	}
	.ok {
		color: var(--ok);
		margin: 0;
		text-align: center;
	}
	/* Open: most of the screen, its own scroll bar. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: var(--space-3);
		max-height: calc(100dvh - 12rem);
		overflow-y: auto;
		margin: 0;
		padding: 0 var(--space-4) var(--space-4);
		list-style: none;
	}
	.empty {
		margin: 0;
		padding: 0 var(--space-4) var(--space-4);
	}
	a {
		display: grid;
		gap: var(--space-1);
		color: var(--text);
		text-decoration: none;
		font-size: var(--text-sm);
	}
	.picture {
		position: relative;
		display: block;
	}
	img,
	.placeholder {
		display: block;
		width: 100%;
		aspect-ratio: 16 / 9;
		object-fit: cover;
		background: var(--border);
		border-radius: var(--radius-sm);
	}
	a:hover img,
	a:focus-visible img {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	/* Bottom right: the duration, then whether the video is on this device. */
	.corner {
		position: absolute;
		right: var(--space-1);
		bottom: var(--space-1);
		display: flex;
		align-items: center;
		gap: var(--space-1);
	}
	.duration {
		padding: var(--space-0) var(--space-1);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
		color: var(--on-media);
		background: var(--scrim);
		border-radius: var(--radius-xs);
	}
	.file {
		overflow-wrap: anywhere;
		color: var(--muted);
	}
</style>
