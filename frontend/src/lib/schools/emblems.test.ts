import { describe, expect, it } from 'vitest';
import { emblemUrl, GENERIC, hasEmblem } from './emblems';

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

describe('emblems', () => {
	it.each(SCHOOLS)('%s has its own emblem', (id) => {
		expect(hasEmblem(id)).toBe(true);
		expect(emblemUrl(id)).not.toBe(emblemUrl(GENERIC));
	});

	it('falls back to the generic emblem', () => {
		expect(hasEmblem('new_school')).toBe(false);
		expect(emblemUrl('new_school')).toBe(emblemUrl(GENERIC));
		expect(emblemUrl(GENERIC)).toBeTruthy();
	});
});
