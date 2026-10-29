import { describe, expect, it } from 'vitest';
import { rangeResponse } from './range';

const clip = () =>
	new Response(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { headers: { 'Content-Type': 'video/mp4' } });
const bytes = async (r: Response) => [...new Uint8Array(await r.arrayBuffer())];

describe('rangeResponse', () => {
	it('no Range: the whole clip', async () => {
		const r = await rangeResponse(clip(), null);
		expect(r.status).toBe(200);
		expect(await bytes(r)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it.each([
		['bytes=0-1', [0, 1], 'bytes 0-1/10'], // Safari's first request
		['bytes=0-', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'bytes 0-9/10'],
		['bytes=7-', [7, 8, 9], 'bytes 7-9/10'], // seeking
		['bytes=8-99', [8, 9], 'bytes 8-9/10'], // past the end: up to the end
		['bytes=-3', [7, 8, 9], 'bytes 7-9/10'] // the last 3 bytes
	])('%s', async (range, expected, contentRange) => {
		const r = await rangeResponse(clip(), range);
		expect(r.status).toBe(206);
		expect(await bytes(r)).toEqual(expected);
		expect(r.headers.get('Content-Range')).toBe(contentRange);
		expect(r.headers.get('Content-Length')).toBe(String(expected.length));
		expect(r.headers.get('Content-Type')).toBe('video/mp4');
	});

	it.each(['bytes=10-', 'bytes=5-2', 'bytes=-', 'items=0-1', 'bytes=0-1,4-5'])('%s: not satisfiable', async (range) => {
		const r = await rangeResponse(clip(), range);
		expect(r.status).toBe(416);
		expect(r.headers.get('Content-Range')).toBe('bytes */10');
	});
});
