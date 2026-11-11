<script lang="ts">
	// Options: what the application offers to choose from, in collapsible sections.
	// First, the tags (their actions: tags.svelte.ts; one form per tag: TagForm), then the
	// catalogue entries users proposed (proposals.svelte.ts; one form each: ProposalForm).
	import ErrorMessage from '#lib/ErrorMessage.svelte';
	import { t } from '#lib/i18n.svelte.js';
	import Section from '#lib/Section.svelte';
	import TagForm from '#lib/options/TagForm.svelte';
	import ProposalForm from '#lib/options/ProposalForm.svelte';
	import { loadCatalog, type Catalog } from '#lib/catalog.svelte.js';
	import type { MessageKey } from '#lib/i18n.svelte.js';
	import type { PageProps } from './$types';
	import { TagOptions } from './tags.svelte';
	import { ProposalOptions } from './proposals.svelte';

	let { data }: PageProps = $props();
	// The drafts start from the page's data once (a reload would lose an edit in progress).
	const options = $derived(new TagOptions(data.tags));
	let opened = $state<number | null>(null);
	const proposals = $derived(new ProposalOptions(data.proposals));
	// The catalogue: parents and merge targets (kanji and romaji are the same in every language).
	let catalog = $state<Catalog | null>(null);
	$effect(() => {
		loadCatalog().then(
			(c) => (catalog = c),
			() => {}
		);
	});

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

	<Section
		title={t('options.proposals.title')}
		count={proposals.entries.length ? String(proposals.entries.length) : ''}
		hint={t('options.proposals.hint')}
		open={data.proposals.length > 0}
	>
		<div class="body">
			{#if proposals.done}
				<p class="ok" role="status">
					{t(`options.proposals.done.${proposals.done.what}` as MessageKey, { id: proposals.done.key.split(':')[1] })}
				</p>
			{/if}
			{#each proposals.drafts as draft (draft.key)}
				<ProposalForm {draft} actions={proposals} {catalog} />
			{:else}
				<p class="hint">{t('options.proposals.none')}</p>
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
	.hint,
	.ok {
		margin: 0;
	}
	.ok {
		color: var(--ok);
	}
</style>
