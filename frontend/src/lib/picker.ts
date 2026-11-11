// The technique picker's rules (TechniquePicker.svelte): school › category › weapon (under
// Buki only) › section › technique, each step narrowing the next, and "Other…" at every step
// for an entry the catalogue lacks. A step set to Other is named (romaji, kanji optional);
// the steps under a new parent can only be new too (a new section has no techniques yet),
// while categories and weapons, shared by every school, stay choosable under a new school.
// "Add to the catalogue" sends the proposal (api/proposals.ts); the entries created are then
// chosen like any other. Pure: the component wires it to the selects.
import type { CreatedEntry, ProposalIn, ProposalStep } from './api/types';
import { BUKI, categoriesOf, sectionsOf, techniquesOf, weaponsOf, type Catalog, type Place } from './catalog.svelte';

export const STEPS = ['school', 'category', 'weapon', 'section', 'technique'] as const;
export type Step = (typeof STEPS)[number];
/** The selects' value for "Other…" (never an ID: IDs are [a-z0-9_.]). */
export const OTHER = '*other*';

/** The steps set to Other (their place field stays ''). */
export type Others = Record<Step, boolean>;
export interface NewName {
	kanji: string;
	romaji: string;
}
export type Names = Record<Step, NewName>;

export const noOthers = (): Others => ({
	school: false,
	category: false,
	weapon: false,
	section: false,
	technique: false
});
export const emptyNames = (): Names => Object.fromEntries(STEPS.map((s) => [s, { kanji: '', romaji: '' }])) as Names;
export const anyOther = (others: Others) => STEPS.some((s) => others[s]);

/** Other because a step above it is: its parent is new, so it cannot exist yet. */
export function forced(others: Others, step: Step): boolean {
	if (step === 'section') return others.school || others.category || others.weapon;
	if (step === 'technique') return others.section || forced(others, 'section');
	return false;
}

/** The weapon step: only under Buki (an existing category: a new one has no weapons). */
export const weaponShown = (place: Place, others: Others) => !others.category && place.category === BUKI;

/** Each step's choices. After a new school, every category and weapon (they are shared);
 * under a new parent, none (Other only). */
export function choices(catalog: Catalog, place: Place, others: Others) {
	const categories = others.school ? catalog.categories : place.school ? categoriesOf(catalog, place.school) : [];
	const weapons = weaponShown(place, others)
		? others.school
			? catalog.weapons
			: weaponsOf(catalog, place.school)
		: [];
	const parentChosen = place.category && (place.category !== BUKI || place.weapon);
	const sections =
		!forced(others, 'section') && parentChosen
			? sectionsOf(catalog, place.school, place.category, place.weapon || undefined)
			: [];
	const techniques = !forced(others, 'technique') && place.section ? techniquesOf(catalog, place.section) : [];
	return { categories, weapons, sections, techniques };
}

/** Whether a step can be chosen yet (its parent chosen, or new). */
export function open(place: Place, others: Others, step: Step): boolean {
	const set = (s: Step) => Boolean(place[s]) || others[s];
	if (step === 'school') return true;
	if (step === 'category') return set('school');
	if (step === 'weapon') return weaponShown(place, others);
	if (step === 'section') return set('category') && (!weaponShown(place, others) || set('weapon'));
	return set('section');
}

/** `step` chosen (an ID, OTHER or ''): the steps after it start again, forced to Other under a new
 * parent, else filled in when there is a single choice. Returns the new place fields and others. */
export function choose(
	catalog: Catalog,
	place: Place,
	others: Others,
	step: Step,
	value: string
): { place: Place; others: Others } {
	const next: Place = { ...place };
	const marks: Others = { ...others };
	marks[step] = value === OTHER;
	next[step] = value === OTHER ? '' : value;
	for (const later of STEPS.slice(STEPS.indexOf(step) + 1)) {
		next[later] = '';
		marks[later] = forced(marks, later);
	}
	const only = <T extends { id: string }>(list: T[]) => (list.length === 1 ? list[0].id : '');
	for (const later of STEPS.slice(STEPS.indexOf(step) + 1)) {
		if (marks[later] || !open(next, marks, later)) continue;
		const lists = choices(catalog, next, marks);
		const list = {
			school: catalog.schools,
			category: lists.categories,
			weapon: lists.weapons,
			section: lists.sections,
			technique: lists.techniques
		}[later];
		next[later] = only(list);
		if (!next[later]) break;
	}
	return { place: next, others: marks };
}

/** What "Add to the catalogue" sends, or null while a step is missing (unchosen, or new without romaji). */
export function proposal(place: Place, others: Others, names: Names): ProposalIn | null {
	const step = (s: Step): ProposalStep | null => {
		if (others[s]) {
			const romaji = names[s].romaji.trim();
			return romaji ? { new: { kanji: names[s].kanji.trim(), romaji } } : null;
		}
		return place[s] ? { id: place[s] } : null;
	};
	const steps = {
		school: step('school'),
		category: step('category'),
		section: step('section'),
		technique: step('technique')
	};
	const weapon = weaponShown(place, others) ? step('weapon') : undefined;
	if (Object.values(steps).includes(null) || weapon === null) return null;
	return { ...(steps as Required<{ [K in keyof typeof steps]: ProposalStep }>), ...(weapon ? { weapon } : {}) };
}

/** The place once the proposal is made: the new entries' IDs where Other was. */
export function placeAfter(place: Place, created: CreatedEntry[], technique: string): Place {
	const made = (kind: Step) => created.find((c) => c.kind === kind)?.id;
	return {
		school: made('school') ?? place.school,
		category: made('category') ?? place.category,
		weapon: made('weapon') ?? place.weapon,
		section: made('section') ?? place.section,
		technique
	};
}
