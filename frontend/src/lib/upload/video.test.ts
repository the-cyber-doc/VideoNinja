// The editor's hidden videos: the length of a frame, and the film strip's pictures.
// Video and canvas elements faked: what the browser would report, on demand.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FRAME_SAMPLES } from '../frames';
import { makeStrip, measureFrame, STRIP_IMAGES } from './video';

class FakeVideo extends EventTarget {
	src = '';
	currentTime = 0;
	videoWidth = 1920;
	videoHeight = 1080;
	muted = false;
	playsInline = false;
	preload = '';
	style = { cssText: '' };
	attributes: Record<string, string> = {};
	removed = false;
	paused = true;
	/** Frames played: mediaTime per presented frame (30 fps by default). */
	frames: ((callback: (now: number, meta: { mediaTime: number; presentedFrames: number }) => void) => void) | null =
		null;
	play = vi.fn(async () => void (this.paused = false));
	pause = vi.fn(() => void (this.paused = true));
	load = vi.fn();
	remove = () => void (this.removed = true);
	setAttribute(name: string, value: string) {
		this.attributes[name] = value;
	}
	removeAttribute(name: string) {
		if (name === 'src') this.src = '';
	}
}

let created: FakeVideo[];
let images: number;
let videoFactory: () => FakeVideo;

beforeEach(() => {
	created = [];
	images = 0;
	videoFactory = () => {
		const video = new FakeVideo();
		let presented = 0;
		video.frames = (callback) =>
			queueMicrotask(() => {
				presented++;
				callback(0, { mediaTime: presented / 30, presentedFrames: presented });
			});
		return video;
	};
	vi.stubGlobal('document', {
		body: { append: () => {} },
		createElement: (tag: string) => {
			if (tag === 'canvas')
				return {
					width: 0,
					height: 0,
					getContext: () => ({ drawImage: () => void images++ }),
					toDataURL: () => `data:image/jpeg;${images}`
				};
			const video = videoFactory();
			created.push(video);
			Object.assign(video, { requestVideoFrameCallback: video.frames });
			return video;
		}
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('measureFrame', () => {
	it('from the frames a hidden, muted video plays; the video removed afterwards', async () => {
		const seconds = await measureFrame('blob:kata', 0.04);
		expect(seconds).toBeCloseTo(1 / 30);
		const [video] = created;
		expect([video.muted, video.playsInline, video.attributes['aria-hidden'], video.removed, video.src]).toEqual([
			true,
			true,
			'true',
			true,
			''
		]);
	});

	it('a browser that cannot tell: the fallback', async () => {
		videoFactory = () => new FakeVideo(); // no requestVideoFrameCallback
		document.createElement = () => videoFactory() as never;
		expect(await measureFrame('blob:kata', 0.04)).toBe(0.04);
	});

	it('play refused, or no frame within 2 s: the fallback', async () => {
		const refusing = videoFactory;
		videoFactory = () => {
			const video = refusing();
			video.play = vi.fn(async () => Promise.reject(new Error('NotAllowedError')));
			video.frames = () => {};
			return video;
		};
		expect(await measureFrame('blob:kata', 0.04)).toBe(0.04);

		vi.useFakeTimers();
		videoFactory = () => Object.assign(new FakeVideo(), { frames: () => {} });
		const measuring = measureFrame('blob:kata', 0.05);
		await vi.advanceTimersByTimeAsync(2000);
		expect(await measuring).toBe(0.05);
	});

	it('frames all at one time (no duration): the fallback', async () => {
		const still = videoFactory;
		videoFactory = () => {
			const video = still();
			let presented = 0;
			video.frames = (callback) => queueMicrotask(() => callback(0, { mediaTime: 1, presentedFrames: ++presented }));
			return video;
		};
		expect(await measureFrame('blob:kata', 0.04)).toBe(0.04);
		expect(FRAME_SAMPLES).toBeGreaterThan(1);
	});
});

describe('makeStrip', () => {
	/** The probe answers each step: loaded, then every seek. */
	function answering(fail?: 'load' | 'seek') {
		videoFactory = () => {
			const video = new FakeVideo();
			video.addEventListener = ((type: string, listener: () => void) => {
				if (type === 'loadeddata' && fail !== 'load') queueMicrotask(listener);
				if (type === 'seeked' && fail !== 'seek') queueMicrotask(listener);
				if (type === 'error' && fail) queueMicrotask(listener);
			}) as never;
			return video;
		};
	}

	it('pictures across the video, each one reported as it comes', async () => {
		answering();
		const reported: string[][] = [];
		await makeStrip(
			'blob:kata',
			24,
			(list) => reported.push(list),
			() => true
		);
		expect(reported).toHaveLength(STRIP_IMAGES);
		expect(reported.at(-1)).toHaveLength(STRIP_IMAGES);
		expect(created[0].currentTime).toBeCloseTo(23.5); // the middle of the last part
		expect(created[0].src).toBe(''); // released
	});

	it('stops when no longer wanted (another file opened)', async () => {
		answering();
		const reported: string[][] = [];
		let wanted = 3;
		await makeStrip(
			'blob:kata',
			24,
			(list) => reported.push(list),
			() => wanted-- > 0
		);
		expect(reported).toHaveLength(3);
	});

	it('a video that cannot load, or a seek that fails: what it has so far', async () => {
		answering('load');
		const reported: string[][] = [];
		await makeStrip(
			'blob:kata',
			24,
			(list) => reported.push(list),
			() => true
		);
		expect(reported).toEqual([]);
		answering('seek');
		await makeStrip(
			'blob:kata',
			24,
			(list) => reported.push(list),
			() => true
		);
		expect(reported).toEqual([]);
	});

	it('a video without height: a picture one pixel wide at least', async () => {
		answering();
		const flat = videoFactory;
		videoFactory = () => Object.assign(flat(), { videoWidth: 0, videoHeight: 0 });
		await makeStrip(
			'blob:kata',
			24,
			() => {},
			() => true
		);
		expect(created[0].currentTime).toBeGreaterThan(0);
	});
});
