import { describe, expect, it } from 'vitest';
import { formatTime } from './time';

describe('formatTime', () => {
	it('minutes and seconds', () => {
		expect(formatTime(0)).toBe('0:00');
		expect(formatTime(12)).toBe('0:12');
		expect(formatTime(75)).toBe('1:15');
	});
	it('hours from one hour', () => expect(formatTime(3725)).toBe('1:02:05'));
});
