// The Options page's proposed entries ("Other" in the technique picker): one draft each, as
// the admin corrects it (its name = the last part of its ID, kanji, romaji, parent, meanings),
// the ID it will get, what is wrong with it, and the entries it can be merged into. Pure:
// ../../routes/(app)/options/proposals.svelte.ts runs the actions, ProposalForm shows them.
import type { EntryEdit, ProposedEntry, ProposedKind } from '../api/types';
import { BUKI, type Catalog } from '../catalog.svelte';
import { rules } from '../validation';

export const KINDS: readonly ProposedKind[] = ['school', 'category', 'weapon', 'section', 'technique'];

export interface ProposalDraft {
	/** Its key while on the page: kind and ID as the server has them. */
	key: string;
	kind: ProposedKind;
	savedId: string;
	name: string;
	kanji: string;
	romaji: string;
	ryu: string;
	category: string;
	weapon: string;
	section: string;
	descriptions: { en: string; fr: string };
}

export const keyOf = (e: { kind: ProposedKind; id: string }) => `${e.kind}:${e.id}`;

export function toDraft(entry: ProposedEntry): ProposalDraft {
	return {
		key: keyOf(entry),
		kind: entry.kind,
		savedId: entry.id,
		name: entry.name,
		kanji: entry.kanji,
		romaji: entry.romaji,
		ryu: entry.ryu ?? '',
		category: entry.category ?? '',
		weapon: entry.weapon ?? '',
		section: entry.section ?? '',
		descriptions: { en: entry.descriptions.en ?? '', fr: entry.descriptions.fr ?? '' }
	};
}

/** The ID it will have once saved (the server builds it the same way). */
export function idOf(d: ProposalDraft): string {
	const name = d.name.trim();
	if (d.kind === 'section')
		return [d.ryu, d.category, d.category === BUKI ? d.weapon : '', name].filter(Boolean).join('.');
	if (d.kind === 'technique') return `${d.section}.${name}`;
	return name;
}

export function toBody(d: ProposalDraft): EntryEdit {
	const parents =
		d.kind === 'section'
			? { ryu: d.ryu, category: d.category, weapon: d.category === BUKI ? d.weapon : null }
			: d.kind === 'technique'
				? { section: d.section }
				: {};
	return {
		name: d.name.trim(),
		kanji: d.kanji.trim(),
		romaji: d.romaji.trim(),
		parents,
		descriptions: { en: d.descriptions.en.trim(), fr: d.descriptions.fr.trim() }
	};
}

const NAME = new RegExp(rules.catalog_name.pattern, 'v');

export type Problem = 'name' | 'romaji' | 'parent' | 'weapon' | 'meaning';

/** What the server would refuse (each a message: options.proposals.problem.<problem>). */
export function problems(d: ProposalDraft): Problem[] {
	const out: Problem[] = [];
	const name = d.name.trim();
	if (!NAME.test(name) || name.length > rules.catalog_name.max_length) out.push('name');
	if (!d.romaji.trim()) out.push('romaji');
	if (d.kind === 'section' && (!d.ryu || !d.category)) out.push('parent');
	if (d.kind === 'section' && d.category === BUKI && !d.weapon) out.push('weapon');
	if (d.kind === 'technique' && !d.section) out.push('parent');
	if (d.descriptions.fr.trim() && !d.descriptions.en.trim()) out.push('meaning');
	return out;
}

/** Changed since it was loaded (it must be saved before it is validated). */
export const changed = (d: ProposalDraft, saved: ProposedEntry) =>
	JSON.stringify(toBody(d)) !== JSON.stringify(toBody(toDraft(saved)));

/** The entries of a kind in the catalogue, with the proposed ones as the page has them now
 * (the catalogue's copy may still show one under its former ID). */
export function entriesOf(kind: ProposedKind, catalog: Catalog | null, pending: ProposedEntry[]) {
	const lists = {
		school: catalog?.schools,
		category: catalog?.categories,
		weapon: catalog?.weapons,
		section: catalog?.sections,
		technique: catalog?.techniques
	};
	const mine = pending.filter((p) => p.kind === kind);
	const current = new Set(mine.map((p) => p.id));
	const known = (lists[kind] ?? []).filter((e) => !e.proposed || current.has(e.id));
	const seen = new Set(known.map((e) => e.id));
	return [...known, ...mine.filter((p) => !seen.has(p.id))].map((e) => ({ id: e.id, romaji: e.romaji }));
}

/** What it can be merged into: the other entries of its kind. */
export const mergeTargets = (d: ProposalDraft, catalog: Catalog | null, pending: ProposedEntry[]) =>
	entriesOf(d.kind, catalog, pending).filter((e) => e.id !== d.savedId);
