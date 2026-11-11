// The Options page's proposed entries: drafts, the ID they will get, what the server would
// refuse, and what each can be merged into.
import { describe, expect, it } from 'vitest';
import type { ProposedEntry } from '../api/types';
import type { Catalog } from '../catalog.svelte';
import { changed, entriesOf, idOf, keyOf, mergeTargets, problems, toBody, toDraft } from './proposals';

const entry = (more: Partial<ProposedEntry> = {}): ProposedEntry => ({
	kind: 'technique',
	id: 'gyokko.taijutsu.jo_ryaku.kote',
	name: 'kote',
	kanji: '',
	romaji: 'Kote',
	ryu: null,
	category: null,
	weapon: null,
	section: 'gyokko.taijutsu.jo_ryaku',
	descriptions: { en: '', fr: '' },
	used: 1,
	children: 0,
	proposed_by: 'Aiko',
	proposed_at: '2026-11-10T10:00:00+01:00',
	...more
});
const section = entry({
	kind: 'section',
	id: 'gyokko.taijutsu.kihon',
	name: 'kihon',
	romaji: 'Kihon',
	ryu: 'gyokko',
	category: 'taijutsu',
	section: null
});
const named = (id: string, proposed?: true) => ({ id, kanji: '', romaji: id, ...(proposed ? { proposed } : {}) });
const CATALOG = {
	schools: [named('gyokko'), named('kasumi', true)],
	categories: [named('taijutsu'), named('buki')],
	weapons: [named('hanbo')],
	sections: [{ ...named('gyokko.taijutsu.jo_ryaku'), ryu: 'gyokko', category: 'taijutsu' }],
	techniques: [{ ...named('gyokko.taijutsu.jo_ryaku.koku'), section: 'gyokko.taijutsu.jo_ryaku' }],
	segments: []
} as Catalog;

describe('drafts', () => {
	it('from the server and back: its body, its ID as it will be', () => {
		const d = toDraft(entry({ descriptions: { en: 'Wrist' } }));
		expect([d.key, d.section, d.descriptions]).toEqual([
			'technique:gyokko.taijutsu.jo_ryaku.kote',
			'gyokko.taijutsu.jo_ryaku',
			{ en: 'Wrist', fr: '' }
		]);
		d.name = ' kote_gaeshi ';
		expect(idOf(d)).toBe('gyokko.taijutsu.jo_ryaku.kote_gaeshi');
		expect(toBody(d)).toEqual({
			name: 'kote_gaeshi',
			kanji: '',
			romaji: 'Kote',
			parents: { section: 'gyokko.taijutsu.jo_ryaku' },
			descriptions: { en: 'Wrist', fr: '' }
		});
		const s = toDraft(section);
		expect([idOf(s), toBody(s).parents]).toEqual([
			'gyokko.taijutsu.kihon',
			{ ryu: 'gyokko', category: 'taijutsu', weapon: null }
		]);
		Object.assign(s, { category: 'buki', weapon: 'hanbo' });
		expect([idOf(s), toBody(s).parents]).toEqual([
			'gyokko.buki.hanbo.kihon',
			{ ryu: 'gyokko', category: 'buki', weapon: 'hanbo' }
		]);
		const school = toDraft(entry({ kind: 'school', id: 'kasumi', name: 'kasumi', section: null }));
		expect([idOf(school), toBody(school).parents]).toEqual(['kasumi', {}]);
	});

	it('changed: only what the server would store differently', () => {
		const saved = entry();
		const d = toDraft(saved);
		expect(changed(d, saved)).toBe(false);
		d.romaji = 'Kote ';
		expect(changed(d, saved)).toBe(false); // trimmed
		d.kanji = '小手';
		expect(changed(d, saved)).toBe(true);
	});

	it('problems: the name, the romaji, the parents, the English meaning', () => {
		expect(problems(toDraft(entry()))).toEqual([]);
		expect(problems({ ...toDraft(entry()), name: 'Kote Gaeshi', romaji: ' ', section: '' })).toEqual([
			'name',
			'romaji',
			'parent'
		]);
		expect(problems({ ...toDraft(entry()), name: 'a'.repeat(41) })).toEqual(['name']);
		expect(problems({ ...toDraft(section), ryu: '' })).toEqual(['parent']);
		expect(problems({ ...toDraft(section), category: 'buki' })).toEqual(['weapon']);
		const d = toDraft(entry());
		d.descriptions.fr = 'Poignet';
		expect(problems(d)).toEqual(['meaning']);
	});
});

describe('entries and merge targets', () => {
	it('the catalogue’s, proposed ones as the page has them now; never itself', () => {
		const pending = [entry({ kind: 'school', id: 'kasumi_ryu', romaji: 'Kasumi Ryū', section: null })];
		// "kasumi" is the catalogue's old name of a proposal renamed since: left out.
		expect(entriesOf('school', CATALOG, pending)).toEqual([
			{ id: 'gyokko', romaji: 'gyokko' },
			{ id: 'kasumi_ryu', romaji: 'Kasumi Ryū' }
		]);
		const kote = entry();
		expect(mergeTargets(toDraft(kote), CATALOG, [kote]).map((e) => e.id)).toEqual(['gyokko.taijutsu.jo_ryaku.koku']);
		expect(entriesOf('section', null, [section]).map((e) => e.id)).toEqual(['gyokko.taijutsu.kihon']);
		expect(entriesOf('weapon', CATALOG, []).map((e) => e.id)).toEqual(['hanbo']);
		expect(entriesOf('category', CATALOG, [{ ...section, kind: 'category', id: 'taijutsu' }]).map((e) => e.id)).toEqual(
			['taijutsu', 'buki']
		); // in both: once
		expect(keyOf({ kind: 'weapon', id: 'w' })).toBe('weapon:w');
	});
});
