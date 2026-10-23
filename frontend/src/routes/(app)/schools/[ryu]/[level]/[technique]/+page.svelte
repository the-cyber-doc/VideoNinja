<script lang="ts">
	// A technique: description, thumbnails of its video segments, comments.
	import Breadcrumbs from '#lib/Breadcrumbs.svelte';
	import {
		catalogCrumbs,
		findLevel,
		findSchool,
		findTechnique,
		loadCatalog,
		segmentsOf
	} from '#lib/catalog.svelte.js';
	import { t } from '#lib/i18n.svelte.js';
	import Comments from '#lib/techniques/Comments.svelte';
	import SegmentThumbnails from '#lib/techniques/SegmentThumbnails.svelte';
	import type { PageProps } from './$types';

	let { params }: PageProps = $props();
	const catalog = $derived(loadCatalog()); // reads i18n.lang
</script>

{#await catalog}
	<p class="hint centered">{t('common.loading')}</p>
{:then c}
	{@const school = findSchool(c, params.ryu)}
	{@const level = findLevel(c, params.level)}
	{@const technique = school && level && findTechnique(c, school.id, level.id, params.technique)}
	{#if school && level && technique}
		<Breadcrumbs items={catalogCrumbs(school, level, technique)} />
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
	{:else}
		<Breadcrumbs items={catalogCrumbs(school, level)} current={false} />
		<p class="error centered">{t('common.not_found')}</p>
	{/if}
{:catch e}
	<p class="error centered">{e.message}</p>
{/await}

<style>
	article {
		max-width: 52rem;
		margin: 0 auto;
	}
	h1 {
		text-align: center;
	}
	h2 {
		font-size: 1.1rem;
		margin: 0 0 0.75rem;
	}
	.description {
		white-space: pre-line;
	}
	section {
		margin-top: 1.5rem;
	}
</style>
