// Test local codecs: the page's logic, its probes, tests and clipboard faked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormatResult } from '#lib/codecs/formats.js';
import { SAMPLES, TARGETS, type DecodeResult, type Sample } from '#lib/codecs/samples.js';
import { browserDeps, CodecTest, SOURCES, type CodecDeps } from './codecs.svelte';

const answers: Record<string, FormatResult> = {
	aac: { encodeHardware: null, encode: true, decode: true, play: { mp4: null } }
};
const whole: DecodeResult = { frames: 120, audio: true, plays: true };
const broken: DecodeResult = { frames: 0, audio: false, plays: false, error: { code: 'cannot_decode' } };

/** Fakes recording the order of the tests; `decodes`: the sample IDs decoded whole. */
function fakes(decodes: string[] = ['h264-aac']) {
	const order: string[] = [];
	const deps: CodecDeps = {
		probe: vi.fn(async () => answers),
		decode: vi.fn(async (sample: Sample) => {
			order.push(`decode ${sample.id}`);
			return decodes.includes(sample.id) ? whole : broken;
		}),
		fetch: vi.fn(async (sample: Sample) => new Blob([sample.id])),
		encode: vi.fn(async (source, target) => {
			order.push(`encode ${target.id} from ${await source.text()}`);
			return { ok: true, seconds: 1, bytes: 10, framesBack: 120 };
		}),
		copy: vi.fn(async () => {}),
		userAgent: () => 'TestBrowser/1'
	};
	return { deps, order };
}

afterEach(() => vi.useRealTimers());

describe('the browser’s answers', () => {
	it('asked at once; an error kept for the page', async () => {
		const { deps } = fakes();
		const test = new CodecTest(deps);
		await test.start();
		expect(test.formats).toEqual(answers);
		const failed = new Error('no');
		vi.mocked(deps.probe).mockRejectedValueOnce(failed);
		await test.start();
		expect(test.error).toBe(failed);
	});
});

describe('the real tests', () => {
	it('the source decoded first, every encoding from it, then the other samples', async () => {
		const { deps, order } = fakes();
		const test = new CodecTest(deps);
		await test.run();
		expect(order).toEqual([
			'decode h264-aac',
			...TARGETS.map((t) => `encode ${t.id} from h264-aac`),
			...SAMPLES.filter((s) => s.id !== 'h264-aac').map((s) => `decode ${s.id}`)
		]);
		expect(test.encodedFrom).toBe('h264-aac');
		expect(Object.keys(test.decoding!)).toHaveLength(SAMPLES.length);
		expect(Object.keys(test.encoding!)).toEqual(TARGETS.map((t) => t.id));
		expect([test.step, test.running]).toEqual([null, false]);
	});

	it('the first source that decodes whole, in order; the ones tried not decoded again', async () => {
		const { deps, order } = fakes(['av1-opus']);
		const test = new CodecTest(deps);
		await test.run();
		expect(test.encodedFrom).toBe('av1-opus');
		expect(order.slice(0, 3)).toEqual(['decode h264-aac', 'decode vp9-opus', 'decode av1-opus']);
		expect(order.filter((o) => o.startsWith('decode'))).toHaveLength(SAMPLES.length);
		expect(SOURCES.every((id) => SAMPLES.some((s) => s.id === id))).toBe(true);
	});

	it('no sample decoded whole: nothing encoded, every sample tried once', async () => {
		const { deps } = fakes([]);
		const test = new CodecTest(deps);
		await test.run();
		expect(test.encodedFrom).toBeNull();
		expect(test.encoding).toEqual({});
		expect(deps.decode).toHaveBeenCalledTimes(SAMPLES.length);
	});

	it('the current step shown while it runs; a second run ignored meanwhile', async () => {
		const { deps } = fakes();
		let release!: () => void;
		vi.mocked(deps.decode).mockImplementationOnce(() => new Promise((resolve) => (release = () => resolve(whole))));
		const test = new CodecTest(deps);
		const running = test.run();
		await vi.waitFor(() => expect(test.step).toEqual({ kind: 'decode', label: 'H.264 + AAC (MP4)' }));
		await test.run(); // ignored
		expect(deps.decode).toHaveBeenCalledOnce();
		release();
		await running;
		expect(test.step).toBeNull();
	});

	it('an unexpected failure: kept for the page, the run ended', async () => {
		const { deps } = fakes();
		const failed = new Error('download');
		vi.mocked(deps.fetch).mockRejectedValueOnce(failed);
		const test = new CodecTest(deps);
		await test.run();
		expect(test.error).toBe(failed);
		expect(test.running).toBe(false);
	});
});

describe('the results', () => {
	it('as JSON: the name (trimmed), the browser, every result', async () => {
		const { deps } = fakes();
		const test = new CodecTest(deps);
		await test.start();
		await test.run();
		test.name = '  Anna, iPhone 13 ';
		const results = JSON.parse(test.results());
		expect(results).toMatchObject({
			name: 'Anna, iPhone 13',
			userAgent: 'TestBrowser/1',
			formats: answers,
			encodedFrom: 'h264-aac'
		});
		expect(results.decoding['h264-aac']).toEqual(whole);
		expect(Object.keys(results.encoding)).toHaveLength(TARGETS.length);
	});

	it('copied: shown for 2 s; a refused clipboard kept as the error', async () => {
		vi.useFakeTimers();
		const { deps } = fakes();
		const test = new CodecTest(deps);
		await test.copy();
		expect(deps.copy).toHaveBeenCalledWith(test.results());
		expect(test.copied).toBe(true);
		vi.advanceTimersByTime(2000);
		expect(test.copied).toBe(false);
		const refused = new Error('NotAllowedError');
		vi.mocked(deps.copy).mockRejectedValueOnce(refused);
		await test.copy();
		expect([test.copied, test.error]).toEqual([false, refused]);
	});
});

describe('in the browser', () => {
	it('the clipboard and the user agent from navigator', async () => {
		const writeText = vi.fn(async () => {});
		vi.stubGlobal('navigator', { clipboard: { writeText }, userAgent: 'Real/2' });
		await browserDeps.copy('x');
		expect(writeText).toHaveBeenCalledWith('x');
		expect(browserDeps.userAgent()).toBe('Real/2');
		vi.unstubAllGlobals();
	});
});
