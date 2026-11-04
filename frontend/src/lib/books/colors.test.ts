import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANNOTATION_COLORS, token } from './colors';

describe('colours', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('the annotations’: hex values, named', () => {
		for (const c of ANNOTATION_COLORS) expect(c.value).toMatch(/^#[0-9A-F]{6}$/);
	});

	it('a theme colour read from :root', () => {
		vi.stubGlobal('document', { documentElement: {} });
		vi.stubGlobal('getComputedStyle', () => ({
			getPropertyValue: (name: string) => (name === '--accent' ? ' #b3261e ' : '')
		}));
		expect(token('--accent')).toBe('#b3261e');
	});
});
