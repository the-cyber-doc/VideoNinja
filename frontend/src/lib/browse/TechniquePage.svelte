<script lang="ts">
	// A technique: description, thumbnails of its video segments, comments.
	import Breadcrumbs from '../Breadcrumbs.svelte';
	import { catalogCrumbs, segmentsOf, type CatalogPath } from '../catalog.svelte';
	import { t } from '../i18n.svelte';
	import Comments from '../techniques/Comments.svelte';
	import SegmentThumbnails from '../techniques/SegmentThumbnails.svelte';
	import CatalogView from './CatalogView.svelte';

	let { path }: { path: CatalogPath } = $props();
</script>

<CatalogView {path}>
	{#snippet children(c, { technique })}
		{#if technique}
			<Breadcrumbs items={catalogCrumbs(c, path)} />
			<article>
				<h1><span lang="ja">{technique.kanji}</span> {technique.romaji}</h1>
				{#if technique.description}
					<p class="description">{technique.description}</p>
				{/if}
				<section>
					<h2>{t('technique.videos')}</h2>
					<SegmentThumbnails segments={segmentsOf(c, technique.id)} title={technique.romaji} />
				</section>
				<section>
					<h2>{t('technique.comments')}</h2>
					<Comments technique={technique.id} />
				</section>
			</article>
		{/if}
	{/snippet}
</CatalogView>

<style>
	article {
		max-width: 52rem;
		margin: 0 auto;
	}
	h1 {
		text-align: center;
	}
	h2 {
		font-size: var(--text-lg);
		margin: 0 0 var(--space-3);
	}
	.description {
		white-space: pre-line;
	}
	section {
		margin-top: var(--space-6);
	}
</style>
