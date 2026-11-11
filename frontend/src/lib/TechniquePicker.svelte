<script lang="ts" generics="P extends Place">
	// A technique, chosen step by step: school › category › weapon (under Buki only) ›
	// section › technique. Each choice narrows the next and resets those after it; a step
	// with a single choice is filled in. "Other…" at every step names an entry the catalogue
	// lacks (romaji, kanji optional); "Add to the catalogue" creates it as a proposal (an admin
	// validates it on the Options page) and chooses it. Rules: ./picker.ts. Shared by the
	// segments' form and the books' annotations. `place` may carry more fields (a segment):
	// only these five change; a step set to Other stays '' there until added.
	import { untrack } from 'svelte';
	import { propose } from './api/proposals';
	import type { CreatedEntry } from './api/types';
	import { addToCatalog, withEntries, type Catalog, type Place } from './catalog.svelte';
	import ErrorMessage from './ErrorMessage.svelte';
	import { t, type MessageKey } from './i18n.svelte';
	import {
		anyOther,
		choices,
		choose,
		emptyNames,
		forced,
		noOthers,
		open,
		OTHER,
		placeAfter,
		proposal,
		STEPS,
		weaponShown,
		type Step
	} from './picker';
	import { rules } from './validation';

	let {
		place = $bindable(),
		catalog,
		invalid = () => false,
		required = true,
		onchange = () => {},
		onproposing = () => {}
	}: {
		place: P;
		catalog: Catalog;
		/** A step shown as missing (the form's own check). */
		invalid?: (step: keyof Place) => boolean;
		required?: boolean;
		/** After any choice (the technique, or a step that reset it). */
		onchange?: () => void;
		/** Told whether a step is set to Other and not added yet (the form waits meanwhile). */
		onproposing?: (proposing: boolean) => void;
	} = $props();

	const id = $props.id();
	let others = $state(noOthers());
	let names = $state(emptyNames());
	let adding = $state(false);
	let error = $state<unknown>(null);
	// Entries this picker just created: shown at once, before the page's catalogue has them.
	let created = $state<CreatedEntry[]>([]);
	const shown = $derived(
		created.length
			? withEntries(
					catalog,
					created.filter((c) => !has(catalog, c.id))
				)
			: catalog
	);
	const has = (c: Catalog, id: string) =>
		[c.schools, c.categories, c.weapons, c.sections, c.techniques].some((list) => list.some((x) => x.id === id));
	const lists = $derived(choices(shown, place, others));
	const options = $derived({
		school: shown.schools,
		category: lists.categories,
		weapon: lists.weapons,
		section: lists.sections,
		technique: lists.techniques
	});
	const body = $derived(proposal(place, others, names));

	// Another place given (another annotation or segment): its own choices, no Other.
	let current = place;
	$effect.pre(() => {
		if (place === current) return;
		current = place;
		untrack(() => {
			others = noOthers();
			names = emptyNames();
			error = null;
		});
	});
	$effect(() => onproposing(anyOther(others)));

	const LABELS: Record<Step, MessageKey> = {
		school: 'upload.segment.school',
		category: 'upload.segment.category',
		weapon: 'upload.segment.weapon',
		section: 'upload.segment.section',
		technique: 'upload.segment.technique'
	};

	function changed(step: Step, value: string) {
		const next = choose(shown, place, others, step, value);
		for (const s of STEPS) place[s] = next.place[s] as P[typeof s];
		others = next.others;
		for (const s of STEPS.slice(STEPS.indexOf(step))) if (!others[s]) names[s] = { kanji: '', romaji: '' };
		error = null;
		onchange();
	}

	async function add() {
		if (!body) return;
		adding = true;
		error = null;
		try {
			const out = await propose(body);
			created = [...created, ...out.created];
			await addToCatalog(out.created);
			const next = placeAfter(place, out.created, out.technique);
			for (const s of STEPS) place[s] = next[s] as P[typeof s];
			others = noOthers();
			names = emptyNames();
			onchange();
		} catch (e) {
			error = e;
		} finally {
			adding = false;
		}
	}
</script>

{#each STEPS as step (step)}
	{#if step !== 'weapon' || weaponShown(place, others)}
		{@const isForced = forced(others, step)}
		<label class:invalid={invalid(step)}>
			{t(LABELS[step])}
			<select
				value={others[step] ? OTHER : place[step]}
				onchange={(e) => changed(step, e.currentTarget.value)}
				disabled={!open(place, others, step) || isForced}
				{required}
			>
				<option value="">{t('upload.segment.choose')}</option>
				{#each options[step] as entry (entry.id)}
					<option value={entry.id}>{entry.romaji}</option>
				{/each}
				<option value={OTHER}>{t('picker.other')}</option>
			</select>
		</label>
		{#if others[step]}
			<!-- Unnamed: its name would hold the step's (forms and tests find the select by it); the
			     caption describes its fields instead. -->
			<fieldset class="new" data-new={step}>
				<span class="caption" id="{id}-{step}">{t('picker.new', { step: t(LABELS[step]) })}</span>
				<label>
					{t('picker.romaji')}
					<input
						bind:value={names[step].romaji}
						aria-describedby="{id}-{step}"
						required
						minlength={rules.catalog_romaji.min_length}
						maxlength={rules.catalog_romaji.max_length}
					/>
				</label>
				<label>
					{t('picker.kanji')}
					<input
						bind:value={names[step].kanji}
						aria-describedby="{id}-{step}"
						lang="ja"
						maxlength={rules.catalog_kanji.max_length}
					/>
				</label>
			</fieldset>
		{/if}
	{/if}
{/each}
{#if anyOther(others)}
	<div class="add">
		<button type="button" class="secondary" disabled={!body || adding} onclick={add}>{t('picker.add')}</button>
		<p class="hint">{t('picker.add_hint')}</p>
		<ErrorMessage {error} />
	</div>
{/if}

<style>
	.invalid {
		color: var(--error);
	}
	label.invalid select {
		border-color: var(--error);
	}
	.new {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: var(--space-2);
		margin: 0;
		padding: 0 0 0 var(--space-3);
		border: none;
		border-left: 2px solid var(--border);
		min-width: 0;
	}
	.caption {
		grid-column: 1 / -1;
		font-size: var(--text-sm);
		color: var(--muted);
	}
	.new label {
		display: grid;
		gap: var(--space-1);
	}
	.add {
		display: grid;
		gap: var(--space-1);
		justify-items: start;
	}
	.hint {
		margin: 0;
		font-size: var(--text-sm);
	}
</style>
