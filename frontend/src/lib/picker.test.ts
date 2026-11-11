// The technique picker's rules: each step narrows the next; "Other…" names a missing entry,
// and what is under a new one can only be new.
import { describe, expect, it } from 'vitest';
import type { Catalog, Place } from './catalog.svelte';
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
	type Names,
	type Others
} from './picker';

const named = (id: string) => ({ id, kanji: '', romaji: id });
const CATALOG: Catalog = {
	schools: [named('gyokko'), named('togakure')],
	categories: [named('taijutsu'), named('muto_dori'), named('buki')],
	weapons: [named('hanbo'), named('jo')],
	sections: [
		{ ...named('gyokko.taijutsu.jo_ryaku'), ryu: 'gyokko', category: 'taijutsu' },
		{ ...named('togakure.buki.hanbo.kamae'), ryu: 'togakure', category: 'buki', weapon: 'hanbo' },
		{ ...named('togakure.taijutsu.a'), ryu: 'togakure', category: 'taijutsu' },
		{ ...named('togakure.taijutsu.b'), ryu: 'togakure', category: 'taijutsu' }
	],
	techniques: [
		{ ...named('gyokko.taijutsu.jo_ryaku.koku'), section: 'gyokko.taijutsu.jo_ryaku' },
		{ ...named('gyokko.taijutsu.jo_ryaku.hicho'), section: 'gyokko.taijutsu.jo_ryaku' },
		{ ...named('togakure.buki.hanbo.kamae.ichi'), section: 'togakure.buki.hanbo.kamae' }
	],
	segments: []
};
const EMPTY: Place = { school: '', category: '', weapon: '', section: '', technique: '' };
const ids = (list: { id: string }[]) => list.map((x) => x.id);
const pick = (steps: [keyof Place, string][], start = { place: EMPTY, others: noOthers() }) =>
	steps.reduce((s, [step, value]) => choose(CATALOG, s.place, s.others, step, value), start);

describe('choose', () => {
	it('a single choice filled in, as far as it goes', () => {
		const { place, others } = pick([['school', 'gyokko']]);
		expect(place).toEqual({ ...EMPTY, school: 'gyokko', category: 'taijutsu', section: 'gyokko.taijutsu.jo_ryaku' });
		expect(anyOther(others)).toBe(false);
		// Under Buki: the weapon, then its single section and technique.
		expect(
			pick([
				['school', 'togakure'],
				['category', 'buki']
			]).place
		).toEqual({
			school: 'togakure',
			category: 'buki',
			weapon: 'hanbo',
			section: 'togakure.buki.hanbo.kamae',
			technique: 'togakure.buki.hanbo.kamae.ichi'
		});
		// Two choices: stops there.
		expect(
			pick([
				['school', 'togakure'],
				['category', 'taijutsu']
			]).place.section
		).toBe('');
	});

	it('Other: the place left empty; what is under a new parent is Other too', () => {
		const school = pick([['school', OTHER]]);
		expect(school.place).toEqual(EMPTY);
		expect(school.others).toEqual({ ...noOthers(), school: true, section: true, technique: true });
		const section = pick([
			['school', 'gyokko'],
			['section', OTHER]
		]);
		expect(section.others).toEqual({ ...noOthers(), section: true, technique: true });
		expect(section.place.category).toBe('taijutsu');
		const weapon = pick([
			['school', 'togakure'],
			['category', 'buki'],
			['weapon', OTHER]
		]);
		expect([weapon.others.section, weapon.place.section]).toEqual([true, '']);
		// Chosen again: back to an existing entry.
		expect(pick([['section', 'gyokko.taijutsu.jo_ryaku']], section).others).toEqual(noOthers());
	});
});

describe('choices and open', () => {
	it('under a new school, every category and weapon; under a new parent, nothing', () => {
		const others: Others = { ...noOthers(), school: true, section: true, technique: true };
		const place = { ...EMPTY, category: 'buki' };
		const lists = choices(CATALOG, place, others);
		expect([ids(lists.categories), ids(lists.weapons), lists.sections, lists.techniques]).toEqual([
			['taijutsu', 'muto_dori', 'buki'],
			['hanbo', 'jo'],
			[],
			[]
		]);
		expect(choices(CATALOG, EMPTY, noOthers()).categories).toEqual([]); // no school yet
		expect(ids(choices(CATALOG, { ...EMPTY, school: 'togakure', category: 'buki' }, noOthers()).weapons)).toEqual([
			'hanbo'
		]);
	});

	it('a step opens once the one above is chosen or new; a new category has no weapon', () => {
		expect(open(EMPTY, noOthers(), 'school')).toBe(true);
		expect(open(EMPTY, noOthers(), 'category')).toBe(false);
		expect(open(EMPTY, { ...noOthers(), school: true }, 'category')).toBe(true);
		const buki = { ...EMPTY, school: 'togakure', category: 'buki' };
		expect([open(buki, noOthers(), 'weapon'), open(buki, noOthers(), 'section')]).toEqual([true, false]);
		expect(open({ ...buki, weapon: 'jo' }, noOthers(), 'section')).toBe(true);
		const newCategory = { ...noOthers(), category: true };
		expect([open(EMPTY, newCategory, 'weapon'), open({ ...EMPTY, school: 'x' }, newCategory, 'section')]).toEqual([
			false,
			true
		]);
		expect(open(EMPTY, { ...noOthers(), section: true }, 'technique')).toBe(true);
		expect(forced({ ...noOthers(), weapon: true }, 'technique')).toBe(true);
		expect(forced({ ...noOthers(), school: true }, 'category')).toBe(false);
	});
});

describe('proposal', () => {
	const names = (more: Partial<Names>): Names => ({ ...emptyNames(), ...more });

	it('existing steps by ID, new ones by name (kanji optional); a weapon only under Buki', () => {
		const { place, others } = pick([
			['school', 'gyokko'],
			['technique', OTHER]
		]);
		expect(proposal(place, others, names({ technique: { kanji: ' 小手 ', romaji: ' Kote ' } }))).toEqual({
			school: { id: 'gyokko' },
			category: { id: 'taijutsu' },
			section: { id: 'gyokko.taijutsu.jo_ryaku' },
			technique: { new: { kanji: '小手', romaji: 'Kote' } }
		});
		const buki = pick([
			['school', 'togakure'],
			['category', 'buki'],
			['weapon', OTHER]
		]);
		const all = names({
			weapon: { kanji: '', romaji: 'Fundo' },
			section: { kanji: '', romaji: 'Kihon' },
			technique: { kanji: '', romaji: 'Tsuki' }
		});
		expect(proposal(buki.place, buki.others, all)?.weapon).toEqual({ new: { kanji: '', romaji: 'Fundo' } });
	});

	it('a step unchosen, or new without its romaji: nothing to send yet', () => {
		const { place, others } = pick([
			['school', 'gyokko'],
			['technique', OTHER]
		]);
		expect(proposal(place, others, names({ technique: { kanji: '小手', romaji: '  ' } }))).toBeNull();
		expect(proposal({ ...place, section: '' }, others, names({ technique: { kanji: '', romaji: 'K' } }))).toBeNull();
		const buki = pick([
			['school', 'togakure'],
			['category', 'buki'],
			['weapon', '']
		]);
		expect(proposal(buki.place, buki.others, names({}))).toBeNull(); // no weapon
	});
});

describe('placeAfter', () => {
	it('every step new', () => {
		const created = (['school', 'category', 'weapon', 'section'] as const).map((kind) => ({
			kind,
			id: `new-${kind}`,
			kanji: '',
			romaji: kind
		}));
		expect(placeAfter(EMPTY, created, 't')).toEqual({
			school: 'new-school',
			category: 'new-category',
			weapon: 'new-weapon',
			section: 'new-section',
			technique: 't'
		});
	});

	it('the new entries where Other was, the technique made', () => {
		const place = { ...EMPTY, school: 'gyokko', category: 'taijutsu' };
		const created = [
			{
				kind: 'section' as const,
				id: 'gyokko.taijutsu.kihon',
				kanji: '',
				romaji: 'Kihon',
				ryu: 'gyokko',
				category: 'taijutsu'
			},
			{
				kind: 'technique' as const,
				id: 'gyokko.taijutsu.kihon.kote',
				kanji: '',
				romaji: 'Kote',
				section: 'gyokko.taijutsu.kihon'
			}
		];
		expect(placeAfter(place, created, 'gyokko.taijutsu.kihon.kote')).toEqual({
			...place,
			section: 'gyokko.taijutsu.kihon',
			technique: 'gyokko.taijutsu.kihon.kote'
		});
	});
});
