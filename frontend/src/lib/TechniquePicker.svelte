<script lang="ts" generics="P extends Place">
	// A technique, chosen step by step: school › category › weapon (under Buki only) ›
	// section › technique. Each choice narrows the next and resets those after it; a step
	// with a single choice is filled in. Shared by the segments' form and the books'
	// annotations. `place` may carry more fields (a segment): only these five change.
	import { BUKI, categoriesOf, sectionsOf, techniquesOf, weaponsOf, type Catalog, type Place } from './catalog.svelte';
	import { t } from './i18n.svelte';

	let {
		place = $bindable(),
		catalog,
		invalid = () => false,
		required = true,
		onchange = () => {}
	}: {
		place: P;
		catalog: Catalog;
		/** A step shown as missing (the form's own check). */
		invalid?: (step: keyof Place) => boolean;
		required?: boolean;
		/** After any choice (the technique, or a step that reset it). */
		onchange?: () => void;
	} = $props();

	const categories = $derived(place.school ? categoriesOf(catalog, place.school) : []);
	const weapons = $derived(place.category === BUKI ? weaponsOf(catalog, place.school) : []);
	const sections = $derived(
		place.category && (place.category !== BUKI || place.weapon)
			? sectionsOf(catalog, place.school, place.category, place.weapon || undefined)
			: []
	);
	const techniques = $derived(place.section ? techniquesOf(catalog, place.section) : []);

	const STEPS = ['school', 'category', 'weapon', 'section', 'technique'] as const;
	type Step = (typeof STEPS)[number];

	/** `step` was chosen: the steps after it start again, filled in when there is a single choice. */
	function changed(step: Step) {
		for (const next of STEPS.slice(STEPS.indexOf(step) + 1)) place[next] = '' as P[typeof next];
		const only = <T extends { id: string }>(list: T[]) => (list.length === 1 ? list[0].id : '');
		if (!place.category) place.category = only(categoriesOf(catalog, place.school));
		if (place.category === BUKI && !place.weapon) place.weapon = only(weaponsOf(catalog, place.school));
		if (!place.section && place.category && (place.category !== BUKI || place.weapon)) {
			place.section = only(sectionsOf(catalog, place.school, place.category, place.weapon || undefined));
		}
		if (!place.technique && place.section) place.technique = only(techniquesOf(catalog, place.section));
		onchange();
	}
</script>

<label class:invalid={invalid('school')}>
	{t('upload.segment.school')}
	<select bind:value={place.school} onchange={() => changed('school')} {required}>
		<option value="">{t('upload.segment.choose')}</option>
		{#each catalog.schools as school (school.id)}
			<option value={school.id}>{school.romaji}</option>
		{/each}
	</select>
</label>
<label class:invalid={invalid('category')}>
	{t('upload.segment.category')}
	<select bind:value={place.category} onchange={() => changed('category')} disabled={!categories.length} {required}>
		<option value="">{t('upload.segment.choose')}</option>
		{#each categories as category (category.id)}
			<option value={category.id}>{category.romaji}</option>
		{/each}
	</select>
</label>
{#if place.category === BUKI}
	<label class:invalid={invalid('weapon')}>
		{t('upload.segment.weapon')}
		<select bind:value={place.weapon} onchange={() => changed('weapon')} {required}>
			<option value="">{t('upload.segment.choose')}</option>
			{#each weapons as weapon (weapon.id)}
				<option value={weapon.id}>{weapon.romaji}</option>
			{/each}
		</select>
	</label>
{/if}
<label class:invalid={invalid('section')}>
	{t('upload.segment.section')}
	<select bind:value={place.section} onchange={() => changed('section')} disabled={!sections.length} {required}>
		<option value="">{t('upload.segment.choose')}</option>
		{#each sections as section (section.id)}
			<option value={section.id}>{section.romaji}</option>
		{/each}
	</select>
</label>
<label class:invalid={invalid('technique')}>
	{t('upload.segment.technique')}
	<select bind:value={place.technique} onchange={() => onchange()} disabled={!techniques.length} {required}>
		<option value="">{t('upload.segment.choose')}</option>
		{#each techniques as technique (technique.id)}
			<option value={technique.id}>{technique.romaji}</option>
		{/each}
	</select>
</label>

<style>
	.invalid {
		color: var(--error);
	}
	label.invalid select {
		border-color: var(--error);
	}
</style>
