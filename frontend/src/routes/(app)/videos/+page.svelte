<script lang="ts">
	// Every published video, in four collapsible sections by how far its annotation
	// is. Open, a section's thumbnails scroll inside it. A thumbnail opens the
	// annotation panel (/videos/<id>). Needs the "video_mgmt" access.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { url } from '#lib/base.js';
	import { t, type MessageKey } from '#lib/i18n.svelte.js';
	import { hasAccess } from '#lib/session.svelte.js';
	import Icon from '#lib/Icon.svelte';
	import { formatTime } from '#lib/time.js';
	import { offline, removeVideos, savedVideos } from '#lib/offline.svelte.js';
	import SavedBadge from '#lib/SavedBadge.svelte';
	import type { VideoRow } from '#lib/api/types.js';
	import { listVideos } from '#lib/api/videos.js';
	import { videoThumbnailUrl, videoUrl } from '#lib/media.js';
	import { SECTIONS, videoSection } from '#lib/videos/annotations.js';

	const allowed = $derived(hasAccess('video_mgmt'));
	let videos = $state<VideoRow[] | null>(null);
	let error = $state('');
	let failed = $state<Record<number, boolean>>({});
	const saved = page.url.searchParams.has('saved'); // back from the panel

	$effect(() => {
		if (!allowed) {
			goto(url('/'), { replace: true });
			return;
		}
		listVideos().then((list) => (videos = list), (e) => (error = e.message));
	});

	const groups = $derived(
		SECTIONS.map((section) => ({ section, videos: (videos ?? []).filter((v) => videoSection(v) === section) }))
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
			{#if offline.available}
				{@const label = stored ? t('videos.remove_saved', { n: stored }) : t('videos.none_saved')}
				<button type="button" class="icon remove" title={label} aria-label={label} disabled={!stored} onclick={removeSaved}>
					<Icon name="phone" size={22} />
				</button>
			{/if}
		</header>
		{#if saved}<p class="ok" role="status">{t('videos.saved')}</p>{/if}
		{#if removed}<p class="ok" role="status">{t('videos.removed')}</p>{/if}
		{#if error}<p class="error" role="alert">{error}</p>{/if}

		{#if videos === null && !error}
			<p class="hint centered">{t('common.loading')}</p>
		{:else if videos && !videos.length}
			<p class="hint centered">{t('videos.none')}</p>
		{:else if videos}
			{#each groups as group (group.section)}
				<details class="section" open={group.section === firstOpen}>
					<summary>
						<span class="name">{t(`videos.section.${group.section}` as MessageKey)}</span>
						<span class="count">{t('videos.count', { n: group.videos.length })}</span>
						<!-- Pointing right: collapsed; down: expanded (the open state is the details element's). -->
						<span class="arrow"><Icon name="chevron-down" size={20} /></span>
						<span class="hint">{t(`videos.section.${group.section}.hint` as MessageKey)}</span>
					</summary>
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
				</details>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.page {
		max-width: 72rem;
		margin: 0 auto;
		display: grid;
		gap: 0.75rem;
	}
	/* The title centred, the remove button at the right of the same line. */
	header {
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		align-items: center;
		margin-bottom: 0.25rem;
	}
	h1 {
		grid-column: 2;
		text-align: center;
		margin: 0;
	}
	.remove {
		grid-column: 3;
		justify-self: end;
		display: grid;
		place-items: center;
		width: 2.4rem;
		height: 2.4rem;
		padding: 0;
		border-radius: 50%;
		color: var(--text);
		background: var(--bg);
		border: 1px solid var(--border);
	}
	.remove:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.ok {
		color: var(--ok);
		margin: 0;
		text-align: center;
	}
	.section {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}
	summary {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.75rem;
		padding: 0.75rem 1rem;
		cursor: pointer;
		list-style: none; /* the arrow replaces the browser's marker */
	}
	summary::-webkit-details-marker {
		display: none; /* Safari */
	}
	.arrow {
		align-self: center;
		margin-left: auto;
		line-height: 0;
		color: var(--muted);
		transition: transform 0.15s;
	}
	.section:not([open]) .arrow {
		transform: rotate(-90deg);
	}
	@media (prefers-reduced-motion: reduce) {
		.arrow {
			transition: none;
		}
	}
	.name {
		font-weight: 700;
		font-size: 1.05rem;
	}
	.count {
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	summary .hint {
		flex-basis: 100%;
		margin: 0;
		font-size: 0.85rem;
	}
	/* Open: most of the screen, its own scroll bar. */
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.75rem;
		max-height: calc(100dvh - 12rem);
		overflow-y: auto;
		margin: 0;
		padding: 0 1rem 1rem;
		list-style: none;
	}
	.empty {
		margin: 0;
		padding: 0 1rem 1rem;
	}
	a {
		display: grid;
		gap: 0.3rem;
		color: var(--text);
		text-decoration: none;
		font-size: 0.85rem;
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
		border-radius: 6px;
	}
	a:hover img,
	a:focus-visible img {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	/* Bottom right: the duration, then whether the video is on this device. */
	.corner {
		position: absolute;
		right: 0.35rem;
		bottom: 0.35rem;
		display: flex;
		align-items: center;
		gap: 0.25rem;
	}
	.duration {
		padding: 0.05rem 0.35rem;
		font-size: 0.75rem;
		font-variant-numeric: tabular-nums;
		color: #fff;
		background: rgb(0 0 0 / 0.75);
		border-radius: 4px;
	}
	.file {
		overflow-wrap: anywhere;
		color: var(--muted);
	}
</style>
