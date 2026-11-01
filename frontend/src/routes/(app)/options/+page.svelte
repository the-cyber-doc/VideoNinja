<script lang="ts">
	// Options: what the application offers to choose from, in collapsible sections.
	// First, the tags (their actions: tags.svelte.ts; one form per tag: TagForm).
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { t } from '#lib/i18n.svelte.js';
	import Section from '#lib/Section.svelte';
	import TagForm from '#lib/options/TagForm.svelte';
	import type { PageProps } from './$types';
	import { TagOptions } from './tags.svelte';

	let { data }: PageProps = $props();
	// The drafts start from the page's data once (a reload would lose an edit in progress).
	const options = $derived(new TagOptions(data.tags));
	let opened = $state<number | null>(null);

	function add() {
		opened = options.add().key;
	}
</script>

<main class="page">
	<h1>{t('options.title')}</h1>
	<ErrorMessage error={data.error} />

	<Section title={t('options.tags.title')} hint={t('options.tags.hint')} open>
		<div class="body">
			<button type="button" class="add" onclick={add} disabled={options.busy}>{t('options.tags.add')}</button>
			{#each options.drafts as draft (draft.key)}
				<TagForm {draft} actions={options} open={draft.key === opened} />
			{:else}
				<p class="hint">{t('options.tags.none')}</p>
			{/each}
		</div>
	</Section>
</main>

<style>
	.page {
		max-width: 60rem;
		margin: 0 auto;
		display: grid;
		gap: var(--space-3);
	}
	h1 {
		margin: var(--space-2) 0 0;
	}
	.body {
		display: grid;
		gap: var(--space-2);
		padding: 0 var(--space-4) var(--space-4);
	}
	.add {
		justify-self: start;
	}
	.hint {
		margin: 0;
	}
</style>
