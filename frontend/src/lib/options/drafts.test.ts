import { describe, expect, it } from 'vitest';
import type { TagDefinition } from '../api/types';
import { changed, filterValues, newDraft, newValue, problems, ruleOf, toBody, toDraft } from './drafts';

const PLACE: TagDefinition = {
	id: 'place',
	names: { en: 'Place', fr: 'Lieu' },
	format: 'list',
	regexp: null,
	hint: null,
	input_mode: 'text',
	min: null,
	max: null,
	values: [
		{ id: 'dojo', names: { en: 'Dojo', fr: 'Dojo' }, used: 2 },
		{ id: 'beach', names: { en: 'Beach', fr: 'Plage' }, used: 0 }
	],
	used: 2
};
const YEAR: TagDefinition = {
	...PLACE,
	id: 'year',
	names: { en: 'Year', fr: 'Année' },
	format: 'regexp',
	regexp: '[12][0-9]{3}',
	hint: { en: 'A year', fr: 'Une année' },
	input_mode: 'numeric',
	max: 2026,
	values: []
};

describe('tag drafts', () => {
	it('from the server and back, unchanged', () => {
		const draft = toDraft(PLACE);
		expect(draft).toMatchObject({ savedId: 'place', id: 'place', format: 'list', min: '', max: '', used: 2 });
		expect(draft.values.map((v) => [v.id, v.previousId, v.used])).toEqual([
			['dojo', 'dojo', 2],
			['beach', 'beach', 0]
		]);
		expect(toBody(draft)).toEqual({
			id: 'place',
			names: { en: 'Place', fr: 'Lieu' },
			format: 'list',
			regexp: null,
			hint: null,
			input_mode: 'text',
			min: null,
			max: null,
			values: [
				{ id: 'dojo', previous_id: 'dojo', names: { en: 'Dojo', fr: 'Dojo' } },
				{ id: 'beach', previous_id: 'beach', names: { en: 'Beach', fr: 'Plage' } }
			]
		});
		expect(changed(draft)).toBe(false);
		expect(problems(draft)).toEqual([]);
		expect(toDraft(PLACE, 7).key).toBe(7);
	});

	it('a regexp tag: hint, keyboard, bounds as typed', () => {
		const draft = toDraft({ ...YEAR, hint: { en: 'A year' } as never, format: null });
		expect(draft).toMatchObject({ format: 'none', hint: { en: 'A year', fr: '' } });
		expect(toDraft({ ...YEAR, min: 1900 }).min).toBe('1900');
		const year = toDraft(YEAR);
		expect(year.max).toBe('2026');
		year.min = ' 1900 ';
		expect(toBody(year)).toMatchObject({ format: 'regexp', input_mode: 'numeric', min: 1900, max: 2026, values: [] });
		expect(changed(year)).toBe(true);
		year.inputMode = 'text';
		expect(toBody(year)).toMatchObject({ min: null, max: null });
	});

	it('the fields of other formats are not sent, edits trimmed', () => {
		const draft = toDraft(YEAR);
		draft.format = 'free';
		draft.id = ' year ';
		draft.names.en = ' Year ';
		expect(toBody(draft)).toMatchObject({ id: 'year', names: { en: 'Year' }, regexp: null, format: 'free' });
		draft.hint = { en: ' ', fr: '' };
		expect(toBody(draft).hint).toBeNull();
		draft.format = 'none';
		expect(toBody(draft)).toMatchObject({ format: null, hint: null, input_mode: 'text', min: null, values: [] });
	});

	it('new tags and values', () => {
		const draft = newDraft();
		expect(draft).toMatchObject({ savedId: null, format: 'list', values: [], original: '' });
		expect(changed(draft)).toBe(true);
		const value = newValue();
		expect(value).toMatchObject({ id: '', previousId: null, used: 0 });
		expect(value.key).not.toBe(draft.key);
	});

	it('what stops it from being saved', () => {
		const draft = newDraft();
		expect(problems(draft)).toEqual(['options.tags.problem.id', 'options.tags.problem.names']);
		Object.assign(draft, { id: 'Place', names: { en: 'Place', fr: 'Lieu' } });
		expect(problems(draft)).toEqual(['options.tags.problem.id']);
		draft.id = 'place';
		draft.values = [newValue(), newValue()];
		expect(problems(draft)).toEqual([
			'options.tags.problem.value_id',
			'options.tags.problem.value_names',
			'options.tags.problem.duplicate'
		]);
		draft.values = [{ ...newValue(), id: 'do-jo', names: { en: 'Dojo', fr: 'Dojo' } }];
		expect(problems(draft)).toEqual([]);

		draft.format = 'regexp';
		expect(problems(draft)).toEqual(['options.tags.problem.regexp']);
		draft.regexp = '[12';
		expect(problems(draft)).toEqual(['options.tags.problem.regexp']);
		draft.regexp = 'x'.repeat(257);
		expect(problems(draft)).toEqual(['options.tags.problem.regexp']);
		draft.regexp = '[0-9]+';
		draft.hint = { en: 'Digits', fr: '' };
		expect(problems(draft)).toEqual(['options.tags.problem.hint']);
		draft.hint.fr = 'Chiffres';
		draft.inputMode = 'numeric';
		for (const [min, max, ok] of [
			['', '', true],
			['1', '', true],
			['x', '', false],
			['', '1.5', false],
			['3', '2', false],
			['-2', '2', true]
		] as const) {
			Object.assign(draft, { min, max });
			expect(problems(draft)).toEqual(ok ? [] : ['options.tags.problem.range']);
		}
	});

	it('the rule for the test field', () => {
		const draft = toDraft(YEAR);
		expect(ruleOf(draft, 'fr')).toEqual({
			format: 'regexp',
			values: [],
			regexp: '[12][0-9]{3}',
			min: null,
			max: 2026
		});
		expect(ruleOf(toDraft(PLACE), 'fr').values).toEqual([
			{ id: 'dojo', name: 'Dojo' },
			{ id: 'beach', name: 'Plage' }
		]);
	});

	it('values filtered by ID or name, case and accents ignored', () => {
		const values = toDraft(PLACE).values;
		expect(filterValues(values, '  ')).toBe(values);
		expect(filterValues(values, 'PLÂ').map((v) => v.id)).toEqual(['beach']);
		expect(filterValues(values, 'doj').map((v) => v.id)).toEqual(['dojo']);
		expect(filterValues(values, 'zzz')).toEqual([]);
	});
});
