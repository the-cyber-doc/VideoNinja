// The real tests on the sample clips. Mediabunny faked: each Input opened takes the next
// file description (its video and audio tracks), each Conversion the next conversion;
// the <video> element faked as in upload/video.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface FakeTrack {
	decodable: boolean;
	codec?: string | null;
	/** Samples the sink yields; an Error: thrown while decoding. */
	samples: number | Error;
	/** Never answers (a stuck decoder). */
	hang?: boolean;
	/** Thrown as is (not an Error). */
	fails?: unknown;
}
interface FakeFile {
	video: FakeTrack | null;
	audio: FakeTrack | null;
}
interface FakeConversion {
	isValid: boolean;
	discarded?: { track: { type: string }; reason: string }[];
	execute?: () => Promise<void>;
	init?: 'hang';
}

const media = vi.hoisted(() => ({
	files: [] as FakeFile[],
	conversions: [] as FakeConversion[],
	disposed: 0,
	closed: 0,
	cancelled: 0,
	options: [] as unknown[]
}));

vi.mock('mediabunny', () => {
	const sink = (track: FakeTrack) => ({
		async *samples() {
			if (track.hang) await new Promise(() => {});
			if (track.fails !== undefined) throw track.fails;
			if (track.samples instanceof Error) throw track.samples;
			for (let i = 0; i < track.samples; i++) yield { close: () => void media.closed++ };
		}
	});
	const trackOf = (t: FakeTrack | null) =>
		t && {
			canDecode: async () => t.decodable,
			getCodecParameterString: async () => (t.codec === undefined ? 'hvc1.1.6.L63.90' : t.codec),
			sink: t
		};
	class Input {
		#file: FakeFile;
		constructor() {
			this.#file = media.files.shift() ?? { video: null, audio: null };
		}
		getPrimaryVideoTrack = async () => trackOf(this.#file.video);
		getPrimaryAudioTrack = async () => trackOf(this.#file.audio);
		dispose = () => void media.disposed++;
	}
	class Sink {
		samples: () => AsyncGenerator<{ close: () => void }>;
		constructor(track: { sink: FakeTrack }) {
			this.samples = sink(track.sink).samples;
		}
	}
	class BufferTarget {
		buffer = new ArrayBuffer(2048);
	}
	class Format {
		constructor(readonly options?: unknown) {}
	}
	class Mp4OutputFormat extends Format {
		kind = 'mp4';
	}
	class WebMOutputFormat extends Format {
		kind = 'webm';
	}
	return {
		ALL_FORMATS: [],
		QUALITY_MEDIUM: 'medium',
		BlobSource: class {},
		BufferTarget,
		Input,
		Output: class {
			constructor(readonly options: unknown) {}
		},
		Mp4OutputFormat,
		WebMOutputFormat,
		VideoSampleSink: Sink,
		AudioSampleSink: Sink,
		Conversion: {
			init: async (options: unknown) => {
				media.options.push(options);
				const c = media.conversions.shift()!;
				if (c.init === 'hang') await new Promise(() => {});
				return {
					isValid: c.isValid,
					discardedTracks: c.discarded ?? [],
					execute: c.execute ?? (async () => {}),
					cancel: async () => void media.cancelled++
				};
			}
		}
	};
});

const { decodeAll, decodeSample, encodeTo, fetchSample, limit, LIMITS, plays, SAMPLES, sampleUrl, TARGETS } =
	await import('./samples');

const whole: FakeFile = { video: { decodable: true, samples: 120 }, audio: { decodable: true, samples: 3 } };

/** How the fake <video> behaves once play() is called. */
type Playing = 'picture' | 'sound only' | 'no frames counted' | 'error' | 'refused' | 'stalls';
let playing: Playing;
let withFrameCallback: boolean;
let videos: FakeVideo[];

class FakeVideo extends EventTarget {
	src = '';
	currentTime = 0;
	videoWidth = 0;
	muted = false;
	playsInline = false;
	style = { cssText: '' };
	attributes: Record<string, string> = {};
	removed = false;
	callbacks: (() => void)[] = [];
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	removeAttribute(name: string) {
		if (name === 'src') this.src = '';
	}
	pause() {}
	load() {}
	remove() {
		this.removed = true;
	}
	getVideoPlaybackQuality() {
		return { totalVideoFrames: playing === 'picture' && !withFrameCallback ? 30 : 0 };
	}
	async play() {
		if (playing === 'refused') throw new Error('NotAllowedError');
		queueMicrotask(() => {
			if (playing === 'error') return void this.dispatchEvent(new Event('error'));
			if (playing === 'stalls') return;
			if (playing === 'picture' || playing === 'no frames counted') this.videoWidth = 640;
			if (playing === 'picture') this.callbacks.splice(0).forEach((c) => c());
			this.currentTime = 0.5;
			this.dispatchEvent(new Event('timeupdate')); // not yet past 1 s
			this.currentTime = 1.5;
			this.dispatchEvent(new Event('timeupdate'));
		});
	}
}

beforeEach(() => {
	media.files = [];
	media.conversions = [];
	media.disposed = media.closed = media.cancelled = 0;
	media.options = [];
	playing = 'picture';
	withFrameCallback = true;
	videos = [];
	vi.stubGlobal('document', {
		body: { append: () => {} },
		createElement: () => {
			const video = new FakeVideo();
			if (withFrameCallback)
				Object.assign(video, { requestVideoFrameCallback: (c: () => void) => video.callbacks.push(c) });
			videos.push(video);
			return video;
		}
	});
	vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sample');
	vi.spyOn(URL, 'revokeObjectURL').mockReturnValue();
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(new Blob(['clip'])))
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('the samples and targets', () => {
	it('unique IDs; the samples served from format-samples/', () => {
		expect(new Set(SAMPLES.map((s) => s.id)).size).toBe(SAMPLES.length);
		expect(new Set(TARGETS.map((t) => t.id)).size).toBe(TARGETS.length);
		expect(sampleUrl(SAMPLES[0])).toBe('/format-samples/h264-aac.mp4');
	});
});

describe('limit', () => {
	it('the step when it ends in time', async () => {
		expect(await limit(Promise.resolve(3), 1)).toBe(3);
	});

	it('a timeout failure otherwise, after telling the step', async () => {
		vi.useFakeTimers();
		const stop = vi.fn();
		const late = limit(new Promise(() => {}), 5, stop);
		const failed = expect(late).rejects.toMatchObject({ code: 'timeout', message: '5 s' });
		await vi.advanceTimersByTimeAsync(5000);
		await failed;
		expect(stop).toHaveBeenCalledOnce();
	});
});

describe('fetchSample', () => {
	it('the file, or a download failure (network, HTTP status)', async () => {
		expect(await (await fetchSample(SAMPLES[0])).text()).toBe('clip');
		vi.mocked(fetch).mockRejectedValueOnce(new TypeError('offline'));
		await expect(fetchSample(SAMPLES[0])).rejects.toMatchObject({ code: 'download', message: 'TypeError: offline' });
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
		await expect(fetchSample(SAMPLES[0])).rejects.toMatchObject({ code: 'download', message: 'HTTP 404' });
	});
});

describe('decodeAll', () => {
	it('every frame and the audio, each sample closed, the input disposed', async () => {
		media.files = [whole];
		expect(await decodeAll(new Blob())).toEqual({ frames: 120, audio: true });
		expect(media.closed).toBe(123);
		expect(media.disposed).toBe(1);
	});

	it('no audio track, or an audio it cannot decode: audio false', async () => {
		media.files = [
			{ video: whole.video, audio: null },
			{ video: whole.video, audio: { decodable: false, samples: 3 } }
		];
		expect(await decodeAll(new Blob())).toEqual({ frames: 120, audio: false });
		expect(await decodeAll(new Blob())).toEqual({ frames: 120, audio: false });
	});

	it('no video; a video it cannot decode (its codec named, or none known)', async () => {
		media.files = [
			{ video: null, audio: null },
			{ video: { decodable: false, samples: 0 }, audio: null },
			{ video: { decodable: false, samples: 0, codec: null }, audio: null }
		];
		await expect(decodeAll(new Blob())).rejects.toMatchObject({ code: 'no_video' });
		await expect(decodeAll(new Blob())).rejects.toMatchObject({ code: 'cannot_decode', message: 'hvc1.1.6.L63.90' });
		await expect(decodeAll(new Blob())).rejects.toMatchObject({ code: 'cannot_decode', message: 'cannot_decode' });
		expect(media.disposed).toBe(3);
	});
});

describe('plays', () => {
	it('picture frames shown past 1 s: yes; the element cleaned up', async () => {
		expect(await plays(new Blob())).toBe(true);
		const [video] = videos;
		expect([video.muted, video.playsInline, video.attributes['aria-hidden'], video.removed, video.src]).toEqual([
			true,
			true,
			'true',
			true,
			''
		]);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:sample');
	});

	it('without requestVideoFrameCallback: the playback quality counts the frames', async () => {
		withFrameCallback = false;
		expect(await plays(new Blob())).toBe(true);
	});

	it.each<Playing>(['sound only', 'no frames counted', 'error', 'refused'])('%s: no', async (how) => {
		playing = how;
		expect(await plays(new Blob())).toBe(false);
	});

	it('neither requestVideoFrameCallback nor getVideoPlaybackQuality: no frames known, no', async () => {
		withFrameCallback = false;
		const create = document.createElement;
		vi.stubGlobal('document', {
			...document,
			createElement: () => Object.assign(create.call(document, 'video'), { getVideoPlaybackQuality: undefined })
		});
		expect(await plays(new Blob())).toBe(false);
	});

	it('no frames counted, without requestVideoFrameCallback either: no', async () => {
		playing = 'no frames counted';
		withFrameCallback = false;
		expect(await plays(new Blob())).toBe(false);
	});

	it('never reaching 1 s: no, after the time limit', async () => {
		vi.useFakeTimers();
		playing = 'stalls';
		const result = plays(new Blob());
		await vi.advanceTimersByTimeAsync(LIMITS.play * 1000);
		expect(await result).toBe(false);
	});
});

describe('decodeSample', () => {
	it('decoded whole and played', async () => {
		media.files = [whole];
		expect(await decodeSample(SAMPLES[0])).toEqual({ frames: 120, audio: true, plays: true });
	});

	it('the download failing: nothing tried', async () => {
		vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }));
		expect(await decodeSample(SAMPLES[0])).toEqual({
			frames: 0,
			audio: false,
			plays: false,
			error: { code: 'download', detail: 'HTTP 500' }
		});
		expect(videos).toEqual([]);
	});

	it('played but not decodable: the code; the browser error as detail; a code alone', async () => {
		media.files = [
			{ video: { decodable: true, samples: new DOMException('Decode error', 'EncodingError') }, audio: null },
			{ video: null, audio: null }
		];
		expect(await decodeSample(SAMPLES[5])).toEqual({
			frames: 0,
			audio: false,
			plays: true,
			error: { code: 'failed', detail: 'EncodingError: Decode error' }
		});
		expect((await decodeSample(SAMPLES[5])).error).toEqual({ code: 'no_video' });
	});

	it('a thrown non-Error: its text as detail', async () => {
		media.files = [{ video: { decodable: true, samples: 0, fails: 'odd' }, audio: null }];
		expect((await decodeSample(SAMPLES[0])).error).toEqual({ code: 'failed', detail: 'odd' });
	});

	it('a decoder that never answers: a timeout', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
		media.files = [{ video: { decodable: true, samples: 1, hang: true }, audio: null }];
		const result = decodeSample(SAMPLES[3]);
		// Second by second: the download and the playback check come first, then the decoder's limit.
		for (let s = 0; s <= LIMITS.play + LIMITS.decode; s++) await vi.advanceTimersByTimeAsync(1000);
		expect((await result).error).toEqual({ code: 'timeout', detail: `${LIMITS.decode} s` });
	});
});

describe('encodeTo', () => {
	const mp4 = TARGETS[1]; // H.265 + AAC (MP4)
	const webm = TARGETS[5]; // VP9 + Opus (WebM)

	it('encoded (always re-encoded), timed, its size, decoded back', async () => {
		media.files = [whole, whole];
		media.conversions = [{ isValid: true }];
		const result = await encodeTo(new Blob(), mp4);
		expect(result).toMatchObject({ ok: true, bytes: 2048, framesBack: 120 });
		expect(result.seconds).toBeGreaterThanOrEqual(0);
		expect(media.options[0]).toMatchObject({
			tracks: 'primary',
			video: { codec: 'hevc', keyFrameInterval: 1, forceTranscode: true },
			audio: { codec: 'aac', forceTranscode: true },
			output: { options: { format: { kind: 'mp4', options: { fastStart: 'in-memory' } } } }
		});
	});

	it('into WebM', async () => {
		media.files = [whole, whole];
		media.conversions = [{ isValid: true }];
		expect((await encodeTo(new Blob(), webm)).ok).toBe(true);
		expect(media.options[0]).toMatchObject({ output: { options: { format: { kind: 'webm' } } } });
	});

	it('no encoder for it; another reason it cannot convert', async () => {
		media.files = [whole, whole];
		media.conversions = [
			{ isValid: false, discarded: [{ track: { type: 'video' }, reason: 'no_encodable_target_codec' }] },
			{ isValid: false, discarded: [{ track: { type: 'audio' }, reason: 'undecodable_source_codec' }] }
		];
		expect(await encodeTo(new Blob(), mp4)).toEqual({
			ok: false,
			error: { code: 'no_encoder', detail: 'video: no_encodable_target_codec' }
		});
		expect((await encodeTo(new Blob(), mp4)).error).toEqual({
			code: 'cannot_convert',
			detail: 'audio: undecodable_source_codec'
		});
		expect(media.disposed).toBe(2);
	});

	it('the encoding failing', async () => {
		media.files = [whole];
		media.conversions = [{ isValid: true, execute: async () => Promise.reject(new Error('boom')) }];
		expect((await encodeTo(new Blob(), mp4)).error).toEqual({ code: 'failed', detail: 'Error: boom' });
	});

	it('an encoding that never ends: cancelled, a timeout', async () => {
		vi.useFakeTimers();
		media.files = [whole];
		media.conversions = [{ isValid: true, execute: () => new Promise(() => {}) }];
		const result = encodeTo(new Blob(), mp4);
		await vi.advanceTimersByTimeAsync(LIMITS.encode * 1000);
		expect((await result).error).toEqual({ code: 'timeout', detail: `${LIMITS.encode} s` });
		expect(media.cancelled).toBe(1);
	});

	it('preparing that never ends: a timeout', async () => {
		vi.useFakeTimers();
		media.files = [whole];
		media.conversions = [{ isValid: true, init: 'hang' }];
		const result = encodeTo(new Blob(), mp4);
		await vi.advanceTimersByTimeAsync(LIMITS.prepare * 1000);
		expect((await result).error).toMatchObject({ code: 'timeout' });
	});

	it('written but not decodable back: not ok, its size kept', async () => {
		media.files = [whole, { video: { decodable: false, samples: 0 }, audio: null }];
		media.conversions = [{ isValid: true }];
		expect(await encodeTo(new Blob(), mp4)).toMatchObject({ ok: false, bytes: 2048, framesBack: 0 });
	});
});
