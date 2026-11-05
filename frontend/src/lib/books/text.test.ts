// A book's page text: read page by page (none or garbled: empty), sent in batches nginx takes.
import { describe, expect, it, vi } from 'vitest';
import { BATCH_BYTES, PAGE_CHARS, batches, pageTexts, sendText, type TextEngine } from './text';

const task = <T>(value: T | Error) => ({
	toPromise: () => (value instanceof Error ? Promise.reject(value) : Promise.resolve(value))
});

describe('pageTexts', () => {
	it('each page, trimmed and cut; a failure or garbled text: empty', async () => {
		const texts = ['  Kamae\n', new Error('no text'), '\u0001\u0002\u0003\u0004\u0005', 'kamae '.repeat(PAGE_CHARS)];
		const engine: TextEngine = { extractText: vi.fn((_doc, [i]) => task(texts[i!]!)) };
		const doc = { pages: [0, 1, 2, 3].map((index) => ({ index })) };
		const out = await pageTexts(engine, doc);
		expect(out.slice(0, 3)).toEqual(['Kamae', '', '']);
		expect(out[3]).toHaveLength(PAGE_CHARS);
		expect(engine.extractText).toHaveBeenCalledWith(doc, [3]);
	});
});

describe('batches', () => {
	it('in order, each under the limit, the last one said; none: one empty batch', () => {
		expect(batches([])).toEqual([{ first: 1, pages: [], last: true }]);
		expect(batches(['a', 'b'])).toEqual([{ first: 1, pages: ['a', 'b'], last: true }]);
		const big = 'é'.repeat(300); // 2 bytes each in UTF-8
		expect(batches([big, big, big, 'x'], 1300)).toEqual([
			{ first: 1, pages: [big, big], last: false },
			{ first: 3, pages: [big, 'x'], last: true }
		]);
		expect(batches(['y'.repeat(BATCH_BYTES + 10)])).toHaveLength(1); // a page alone: sent anyway
	});
});

describe('sendText', () => {
	it('every batch in order; a failure stops', async () => {
		const put = vi.fn(async () => {});
		await sendText(7, ['a'], put);
		expect(put).toHaveBeenCalledWith(7, { first: 1, pages: ['a'], last: true });
		const failing = vi.fn(async () => Promise.reject(new Error('offline')));
		await expect(sendText(7, ['a'], failing)).rejects.toThrow('offline');
	});
});
