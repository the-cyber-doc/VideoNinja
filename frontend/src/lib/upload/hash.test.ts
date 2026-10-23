import { describe, expect, it } from 'vitest';
import { sha256File } from './hash';

describe('sha256File', () => {
	it('hashes in chunks with progress', async () => {
		const progress: number[] = [];
		const digest = await sha256File(new Blob(['abc']), (f) => progress.push(f));
		expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
		expect(progress.at(-1)).toBe(1);
	});

	it('large file: same digest as in one go', async () => {
		const data = new Uint8Array(20 * 1024 * 1024).map((_, i) => i % 251);
		const expected = Buffer.from(await crypto.subtle.digest('SHA-256', data)).toString('hex');
		expect(await sha256File(new Blob([data]))).toBe(expected);
	});

	it('can be cancelled', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(sha256File(new Blob(['abc']), undefined, controller.signal)).rejects.toThrow();
	});
});
