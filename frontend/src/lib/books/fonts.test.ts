// Fallback fonts for PDFs that do not embed theirs: from the app, never a CDN.
import { FontCharset } from '@embedpdf/models';
import { describe, expect, it, vi } from 'vitest';
import { FONT_SETS, fontsPath } from './font-sets';
import { fontFallback } from './fonts';

vi.stubGlobal('location', { href: 'https://example.org/books/7' });

describe('fallback fonts', () => {
	it('every character set to the app’s copies, in a folder per version', () => {
		const { fonts } = fontFallback('2.0.0');
		expect(fonts[FontCharset.SHIFTJIS].map((f) => f.url).sort()).toEqual([
			'https://example.org/_app/immutable/pdf-fonts/2.0.0/jp/NotoSansJP-Bold.otf',
			'https://example.org/_app/immutable/pdf-fonts/2.0.0/jp/NotoSansJP-Regular.otf'
		]);
		expect(fonts[FontCharset.CYRILLIC]).toBe(fonts[FontCharset.GREEK]); // the Latin set for both
		for (const variants of Object.values(fonts))
			for (const f of variants) expect(f.url).toMatch(/^https:\/\/example\.org\/_app\/immutable\/pdf-fonts\//); // never a CDN
		expect(fontFallback().fonts[FontCharset.HANGEUL][0].url).toMatch(
			/^https:\/\/example\.org\/_app\/immutable\/pdf-fonts\/[^/]+\/kr\//
		);
	});

	it('regular and bold only (italic too, for Latin)', () => {
		for (const set of FONT_SETS) for (const f of set.files) expect([undefined, 400, 700]).toContain(f.weight);
		expect(
			FONT_SETS.find((s) => s.name === 'latin')!
				.files.map((f) => f.file)
				.sort()
		).toEqual(['NotoSans-Bold.ttf', 'NotoSans-BoldItalic.ttf', 'NotoSans-Italic.ttf', 'NotoSans-Regular.ttf']);
		expect(fontsPath('1.2.3')).toBe('_app/immutable/pdf-fonts/1.2.3');
	});
});
