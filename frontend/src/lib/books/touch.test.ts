// A finger over a page: a swipe scrolls, held still first it selects.
import { describe, expect, it } from 'vitest';
import { intentOf, LONG_PRESS_MS, SLOP_PX } from './touch';

describe('intentOf', () => {
	it('not moved past the jitter: undecided, however long', () => {
		expect(intentOf(10, 3, 4)).toBe('undecided');
		expect(intentOf(5000, 0, SLOP_PX - 1)).toBe('undecided');
	});
	it('moved at once: a scroll; moved after a long press: a selection', () => {
		expect(intentOf(50, 0, -40)).toBe('scroll');
		expect(intentOf(LONG_PRESS_MS - 1, SLOP_PX, 0)).toBe('scroll');
		expect(intentOf(LONG_PRESS_MS, SLOP_PX, 0)).toBe('select');
		expect(intentOf(900, 30, 2)).toBe('select');
	});
});
