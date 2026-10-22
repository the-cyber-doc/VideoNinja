import { describe, expect, it } from 'vitest';
import { GENERIC } from '../cards/emblems';
import { levelEmblems } from './emblems';

// The levels of db_v1_init.sql.
describe('level emblems', () => {
	it.each(['shoden', 'chuden', 'okuden'])('%s has its own emblem', (id) => {
		expect(levelEmblems.has(id)).toBe(true);
		expect(levelEmblems.url(id)).not.toBe(levelEmblems.url(GENERIC));
	});

	it('falls back to the generic emblem', () => {
		expect(levelEmblems.url('new_level')).toBe(levelEmblems.url(GENERIC));
		expect(levelEmblems.url(GENERIC)).toBeTruthy();
	});
});
