import { describe, expect, it } from 'vitest';
import { compilePattern, hintId, nameId, valueNameId, valueProblem } from './tags';

const year = { format: 'regexp' as const, pattern: '[12][0-9]{3}' };

describe('tag rules', () => {
	it('a pattern matches the whole value, else none', () => {
		expect(compilePattern('[0-9]+')?.test('12')).toBe(true);
		expect(compilePattern('[0-9]+')?.test('a12')).toBe(false);
		expect(compilePattern('a|b')?.test('ab')).toBe(false); // the alternation grouped
		expect(compilePattern('[12')).toBeNull();
		expect(compilePattern('[a-]')).toBeNull(); // the 'v' flag, as the server's rules say
	});

	it.each([
		[{ format: null }, '', null],
		[{ format: null }, 'x', 'error.tag.no_value'],
		[{ format: 'free' as const }, '', 'error.tag.missing_value'],
		[{ format: 'free' as const }, 'anything', null],
		[{ format: 'list' as const, values: [{ id: 'dojo', name: 'Dojo' }] }, 'dojo', null],
		[{ format: 'list' as const, values: [{ id: 'dojo', name: 'Dojo' }] }, 'Dojo', 'error.tag.value'],
		[{ format: 'list' as const }, 'dojo', 'error.tag.value'],
		[year, '2024', null],
		[year, '0999', 'error.tag.pattern'],
		[{ format: 'regexp' as const }, 'x', 'error.tag.pattern'],
		[{ ...year, max: 2026 }, '2027', 'error.tag.range'],
		[{ format: 'free' as const, min: 1 }, '0', 'error.tag.range'],
		[{ format: 'free' as const, min: 1 }, 'x', 'error.tag.range'],
		[{ format: 'free' as const, min: -5, max: 5 }, '-5', null]
	])('%o, %s: %s', (rule, value, key) => {
		expect(valueProblem(rule, value)?.key ?? null).toBe(key);
	});

	it('the params of the messages', () => {
		expect(valueProblem(year, 'x')?.params).toEqual({ pattern: '[12][0-9]{3}' });
		expect(valueProblem({ format: 'free', max: 9 }, '10')?.params).toEqual({ min: '…', max: 9 });
		expect(valueProblem({ format: 'free', min: 1, max: 9 }, '0')?.params).toEqual({ min: 1, max: 9 });
	});

	it('translation IDs made from the IDs', () => {
		expect([nameId('place'), hintId('place'), valueNameId('place', 'dojo')]).toEqual([
			'tag.place.name',
			'tag.place.hint',
			'tag_value.place.dojo.name'
		]);
	});
});
