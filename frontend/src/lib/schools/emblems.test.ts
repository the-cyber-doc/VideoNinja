import { describe, expect, it } from 'vitest';
import { GENERIC } from '../cards/emblems';
import { schoolEmblems } from './emblems';

// The schools of db_v1_init.sql.
const SCHOOLS = [
	'togakure',
	'gyokko',
	'kukishinden',
	'koto',
	'shinden',
	'takagi',
	'gikan',
	'gyokushin',
	'kumogakure'
];

describe('school emblems', () => {
	it.each(SCHOOLS)('%s has its own emblem', (id) => {
		expect(schoolEmblems.has(id)).toBe(true);
		expect(schoolEmblems.url(id)).not.toBe(schoolEmblems.url(GENERIC));
	});

	it('falls back to the generic emblem', () => {
		expect(schoolEmblems.has('new_school')).toBe(false);
		expect(schoolEmblems.url('new_school')).toBe(schoolEmblems.url(GENERIC));
		expect(schoolEmblems.url(GENERIC)).toBeTruthy();
	});
});
