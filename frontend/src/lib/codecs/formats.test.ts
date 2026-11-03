// The browser's answers per format: WebCodecs and Media Capabilities faked, on demand.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeCheck, encodeCheck, FORMATS, playCheck, probeFormats, type Format } from './formats';

const video = FORMATS.find((f) => f.id === 'h265-hvc1')!;
const audio = FORMATS.find((f) => f.id === 'opus')!;

/** A WebCodecs class whose isConfigSupported answers `answer` (or throws it). */
function codec(answer: boolean | Error) {
	return {
		isConfigSupported: vi.fn(async () => {
			if (answer instanceof Error) throw answer;
			return { supported: answer };
		})
	};
}

function capabilities(answer: Partial<MediaCapabilitiesDecodingInfo> | Error) {
	return {
		decodingInfo: vi.fn(async () => {
			if (answer instanceof Error) throw answer;
			return answer;
		})
	};
}

afterEach(() => vi.unstubAllGlobals());

describe('the formats', () => {
	it('unique IDs; video formats have a size, each its containers', () => {
		expect(new Set(FORMATS.map((f) => f.id)).size).toBe(FORMATS.length);
		for (const f of FORMATS.filter((f) => f.kind === 'video')) expect(f.width && f.height).toBeTruthy();
		for (const f of FORMATS) expect(f.containers.length).toBeGreaterThan(0);
	});
});

describe('encoding', () => {
	it('video: the size, bitrate and hardware hint asked', async () => {
		const encoder = codec(true);
		vi.stubGlobal('VideoEncoder', encoder);
		expect(await encodeCheck(video, 'prefer-hardware')).toBe(true);
		expect(encoder.isConfigSupported).toHaveBeenCalledWith({
			codec: 'hvc1.1.6.L120.90',
			width: 1920,
			height: 1080,
			bitrate: 5_000_000,
			framerate: 30,
			hardwareAcceleration: 'prefer-hardware'
		});
	});

	it('video: no, an error (unknown), no WebCodecs (unknown)', async () => {
		vi.stubGlobal('VideoEncoder', codec(false));
		expect(await encodeCheck(video, 'no-preference')).toBe(false);
		vi.stubGlobal('VideoEncoder', codec(new TypeError('bad')));
		expect(await encodeCheck(video, 'no-preference')).toBeNull();
		vi.stubGlobal('VideoEncoder', undefined);
		expect(await encodeCheck(video, 'no-preference')).toBeNull();
	});

	it('audio: stereo at 48 kHz; no hardware hint for audio (unknown); no WebCodecs', async () => {
		const encoder = codec(true);
		vi.stubGlobal('AudioEncoder', encoder);
		expect(await encodeCheck(audio, 'no-preference')).toBe(true);
		expect(encoder.isConfigSupported).toHaveBeenCalledWith({
			codec: 'opus',
			sampleRate: 48_000,
			numberOfChannels: 2,
			bitrate: 128_000
		});
		expect(await encodeCheck(audio, 'prefer-hardware')).toBeNull();
		vi.stubGlobal('AudioEncoder', undefined);
		expect(await encodeCheck(audio, 'no-preference')).toBeNull();
	});
});

describe('decoding', () => {
	it('video and audio, or unknown without WebCodecs', async () => {
		const decoder = codec(true);
		vi.stubGlobal('VideoDecoder', decoder);
		vi.stubGlobal('AudioDecoder', codec(false));
		expect(await decodeCheck(video)).toBe(true);
		expect(decoder.isConfigSupported).toHaveBeenCalledWith({
			codec: 'hvc1.1.6.L120.90',
			codedWidth: 1920,
			codedHeight: 1080
		});
		expect(await decodeCheck(audio)).toBe(false);
		vi.stubGlobal('VideoDecoder', undefined);
		vi.stubGlobal('AudioDecoder', undefined);
		expect(await decodeCheck(video)).toBeNull();
		expect(await decodeCheck(audio)).toBeNull();
	});
});

describe('playing (Media Capabilities)', () => {
	it('video: the MIME type with its codec, the answer as given', async () => {
		const caps = capabilities({ supported: true, smooth: false, powerEfficient: true });
		vi.stubGlobal('navigator', { mediaCapabilities: caps });
		expect(await playCheck(video, 'mp4')).toEqual({ supported: true, smooth: false, powerEfficient: true });
		expect(caps.decodingInfo).toHaveBeenCalledWith({
			type: 'file',
			video: {
				contentType: 'video/mp4; codecs="hvc1.1.6.L120.90"',
				width: 1920,
				height: 1080,
				bitrate: 5_000_000,
				framerate: 30
			}
		});
	});

	it('audio: channels as text, the sample rate', async () => {
		const caps = capabilities({ supported: false, smooth: false, powerEfficient: false });
		vi.stubGlobal('navigator', { mediaCapabilities: caps });
		expect((await playCheck(audio, 'webm'))?.supported).toBe(false);
		expect(caps.decodingInfo).toHaveBeenCalledWith({
			type: 'file',
			audio: { contentType: 'audio/webm; codecs="opus"', channels: '2', bitrate: 128_000, samplerate: 48_000 }
		});
	});

	it('unknown when it throws, or without the API (or without navigator)', async () => {
		vi.stubGlobal('navigator', { mediaCapabilities: capabilities(new TypeError('bad')) });
		expect(await playCheck(video, 'mp4')).toBeNull();
		vi.stubGlobal('navigator', {});
		expect(await playCheck(video, 'mp4')).toBeNull();
		vi.stubGlobal('navigator', undefined);
		expect(await playCheck(video, 'mp4')).toBeNull();
	});
});

describe('every format', () => {
	it('each asked once per question; audio has no hardware answer; only its containers played', async () => {
		vi.stubGlobal('VideoEncoder', codec(true));
		vi.stubGlobal('AudioEncoder', codec(true));
		vi.stubGlobal('VideoDecoder', codec(true));
		vi.stubGlobal('AudioDecoder', codec(true));
		const caps = capabilities({ supported: true, smooth: true, powerEfficient: false });
		vi.stubGlobal('navigator', { mediaCapabilities: caps });
		const results = await probeFormats();
		expect(Object.keys(results)).toEqual(FORMATS.map((f) => f.id));
		expect(results['h265-hvc1']).toEqual({
			encodeHardware: true,
			encode: true,
			decode: true,
			play: { mp4: { supported: true, smooth: true, powerEfficient: false } }
		});
		expect(results.opus.encodeHardware).toBeNull();
		expect(Object.keys(results.opus.play)).toEqual(['mp4', 'webm']);
		const plays = FORMATS.reduce((n: number, f: Format) => n + f.containers.length, 0);
		expect(caps.decodingInfo).toHaveBeenCalledTimes(plays);
	});
});
