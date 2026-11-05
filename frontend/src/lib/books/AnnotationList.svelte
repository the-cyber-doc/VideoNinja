<script lang="ts">
	// The book's annotations beside the viewer, by page: what each one marks (its quote, or
	// its crop for a region), its technique, its note, who made it. Clicking one shows it in
	// the viewer; the selected one opens its fields: the technique (../TechniquePicker),
	// the note, the colour, delete (each user changes their own, a moderator any), and its
	// comments (a thread, $lib/techniques/Comments).
	import type { BookAnnotation } from '../api/types';
	import { emptyPlace, placeOf, type Catalog } from '../catalog.svelte';
	import IconButton from '../IconButton.svelte';
	import { i18n, t, type MessageKey } from '../i18n.svelte';
	import { annotationImageUrl } from '../media';
	import { hasAccess } from '../session.svelte';
	import TechniquePicker from '../TechniquePicker.svelte';
	import { annotationComments } from '../api/books';
	import Comments from '../techniques/Comments.svelte';
	import TechniqueLink from '../techniques/TechniqueLink.svelte';
	import { rules } from '../validation';
	import { uidOf, type BookAnnotations } from './annotations.svelte';
	import { ANNOTATION_COLORS } from './colors';
	import { looksGarbled } from './quality';
	import type { ViewerControls } from './ViewerPages.svelte';

	let {
		annotations,
		controls,
		catalog
	}: { annotations: BookAnnotations; controls: ViewerControls | null; catalog: Catalog | null } = $props();

	const rows = $derived([...annotations.rows].sort((a, b) => a.page - b.page || a.id - b.id));
	const moderator = $derived(hasAccess('moderator'));
	const editable = (row: BookAnnotation) => row.mine || moderator;
	const techniqueName = (id: string | null) => {
		const technique = id ? catalog?.techniques.find((x) => x.id === id) : undefined;
		return technique ? technique.romaji : null;
	};
	const day = (iso: string) => new Intl.DateTimeFormat(i18n.lang, { dateStyle: 'medium' }).format(new Date(iso));

	// The selected annotation's fields, as edited (saved by their buttons, the picker at once).
	let note = $state('');
	let place = $state(emptyPlace());
	let shownId = 0;
	$effect(() => {
		const row = annotations.selected;
		if (!row || row.id === shownId) return;
		shownId = row.id;
		note = row.note ?? '';
		place = catalog ? placeOf(catalog, row.technique) : emptyPlace();
	});

	// The fields as edited, and what differs from the saved annotation (both optional: an
	// annotation needs neither a technique nor a note).
	const changes = (row: BookAnnotation) => {
		const technique = place.technique || null;
		const text = note.trim() || null;
		return {
			...(technique !== row.technique && { technique }),
			...(text !== row.note && { note: text })
		};
	};
	function save(row: BookAnnotation) {
		const changed = changes(row);
		if (Object.keys(changed).length) void annotations.edit(row, changed);
	}
	// A highlight whose text is being chosen again (its ends moved): its ID while waiting.
	let reselecting = $state<number | null>(null);
	async function reselect(row: BookAnnotation) {
		if (!controls) return;
		reselecting = row.id;
		await controls.reselect(row);
		if (reselecting === row.id) reselecting = null;
	}
	function remove(row: BookAnnotation) {
		if (confirm(t('books.annotations.delete_confirm'))) controls?.remove(row);
	}
</script>

<section class="annotations" aria-labelledby="annotations-title">
	<h2 id="annotations-title">{t('books.annotations.title')}</h2>
	<p class="hint">
		{rows.length ? t('books.annotations.count', { n: rows.length }) : t('books.annotations.none')}
		{#if annotations.pending}· <span role="status">{t('books.viewer.saving')}</span>{/if}
	</p>
	<ol>
		{#each rows as row (row.id)}
			{@const selected = annotations.selectedUid === uidOf(row)}
			<li class:selected data-id={row.id}>
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions: a click anywhere
				on the summary selects, as its button does (the keyboard's way); the technique's link sits beside it -->
				<div class="summary" onclick={() => controls?.select(row)}>
					<button type="button" class="link" aria-pressed={selected}>
						<span class="page">{t('books.annotations.page', { n: row.page })}</span>
						{#if row.kind === 'region'}
							{#if row.has_image}
								<img src={annotationImageUrl(row.id)} alt={t('books.annotations.crop')} loading="lazy" />
							{:else}
								<span class="hint">{t('books.annotations.region')}</span>
							{/if}
						{:else}
							<q class:clamped={!selected}>{row.quote ?? t('books.annotations.no_quote')}</q>
							{#if looksGarbled(row.quote)}<span class="garbled">{t('books.annotations.garbled')}</span>{/if}
						{/if}
					</button>
					{#if techniqueName(row.technique)}
						<span class="technique">
							{techniqueName(row.technique)}
							<TechniqueLink {catalog} technique={row.technique} />
						</span>
					{/if}
					{#if row.note && !selected}<span class="note">{row.note}</span>{/if}
					<span class="hint">
						{t('books.annotations.by', {
							name: row.created_by ?? t('common.deleted_user'),
							date: day(row.modified_at)
						})}
					</span>
				</div>
				{#if selected && editable(row)}
					<div class="fields">
						{#if row.kind === 'text'}
							{#if reselecting === row.id}
								<p class="hint" role="status">{t('books.annotations.reselect_hint', { n: row.page })}</p>
								<button type="button" class="secondary" onclick={() => controls?.cancelReselect()}>
									{t('books.annotations.reselect_cancel')}
								</button>
							{:else}
								<button type="button" class="secondary reselect" onclick={() => reselect(row)}>
									{t('books.annotations.reselect')}
								</button>
							{/if}
						{/if}
						{#if catalog}
							<fieldset class="technique-picker">
								<legend>{t('books.annotations.technique')}</legend>
								<TechniquePicker bind:place {catalog} required={false} />
							</fieldset>
						{/if}
						<label>
							{t('books.annotations.note')}
							<textarea bind:value={note} maxlength={rules.annotation_note.max_length}></textarea>
						</label>
						<div class="actions">
							<button
								type="button"
								class="secondary"
								disabled={!Object.keys(changes(row)).length}
								onclick={() => save(row)}
							>
								{t('books.annotations.save')}
							</button>
							<div class="colors" role="group" aria-label={t('books.annotations.color')}>
								{#each ANNOTATION_COLORS as color (color.id)}
									<button
										type="button"
										class="swatch"
										style:--swatch={color.value}
										aria-label={t(`books.annotations.color.${color.id}` as MessageKey)}
										aria-pressed={row.color?.toUpperCase() === color.value}
										onclick={() => controls?.recolor(row, color.value)}
									></button>
								{/each}
							</div>
							<IconButton
								label={t('books.annotations.delete')}
								icon="trash"
								variant="quiet"
								onclick={() => remove(row)}
							/>
						</div>
					</div>
				{/if}
				{#if selected}
					<section class="thread" aria-label={t('books.annotations.comments')}>
						<Comments source={annotationComments(row.id)} empty={t('books.annotations.no_comments')} />
					</section>
				{/if}
			</li>
		{/each}
	</ol>
</section>

<style>
	.annotations {
		display: grid;
		align-content: start;
		gap: var(--space-2);
		min-height: 0;
		overflow-y: auto;
	}
	h2 {
		margin: 0;
		font-size: var(--text-lg);
	}
	ol {
		display: grid;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	li.selected {
		border-color: var(--accent);
	}
	.summary {
		cursor: pointer;
	}
	.summary,
	.link {
		display: grid;
		gap: var(--space-1);
		padding: 0;
		font-weight: normal;
		text-align: left;
		color: var(--text);
		background: none;
		border: none;
	}
	.page {
		font-size: var(--text-xs);
		color: var(--muted);
	}
	/* A preview's height: a quote's 6 lines, a region's picture the same. */
	.annotations {
		--preview-height: calc(6 * 1.5 * var(--text-sm));
	}
	q,
	.note {
		overflow-wrap: anywhere;
		font-size: var(--text-sm);
		line-height: 1.5;
	}
	/* Not selected: cut at the preview's height, ending with "…" (the whole quote once selected). */
	q.clamped {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 6;
		line-clamp: 6;
		overflow: hidden;
	}
	/* A quote the PDF gave unreadable: said, in the error colour (a note, not an alert). */
	.garbled {
		font-size: var(--text-xs);
		color: var(--error);
	}
	.technique {
		font-weight: 600;
		font-size: var(--text-sm);
	}
	img {
		max-width: 100%;
		max-height: var(--preview-height);
		object-fit: contain;
		justify-self: start;
		border-radius: var(--radius-xs);
	}
	.reselect {
		justify-self: start;
	}
	.fields {
		display: grid;
		gap: var(--space-2);
	}
	.fields label,
	.technique-picker :global(label) {
		display: grid;
		gap: var(--space-1);
		font-size: var(--text-sm);
	}
	fieldset {
		display: grid;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		border: none;
		min-width: 0;
	}
	legend {
		padding: 0;
		font-size: var(--text-sm);
		color: var(--muted);
	}
	textarea {
		min-height: 4rem;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
	}
	.thread {
		padding-top: var(--space-2);
		border-top: 1px solid var(--border);
		font-size: var(--text-sm);
	}
	.colors {
		display: flex;
		gap: var(--space-1);
		margin-right: auto;
	}
	.swatch {
		width: var(--space-6);
		height: var(--space-6);
		padding: 0;
		background: var(--swatch);
		border: 1px solid var(--border);
		border-radius: var(--radius-pill);
	}
	.swatch[aria-pressed='true'] {
		outline: 2px solid var(--text);
		outline-offset: 1px;
	}
</style>
