// The "Test local codecs" page's real tests: the sample clips (static/format-samples/,
// made by tools/codec-samples.sh) really decoded, played and encoded, through WebCodecs
// (Mediabunny). The browser's answers (formats.ts) can say yes to a stream it then fails
// to decode; these show what actually works.
import {
	ALL_FORMATS,
	AudioSampleSink,
	BlobSource,
	BufferTarget,
	Conversion,
	Input,
	Mp4OutputFormat,
	Output,
	QUALITY_MEDIUM,
	VideoSampleSink,
	WebMOutputFormat,
	type AudioCodec,
	type VideoCodec
} from 'mediabunny';
import { url } from '../base';

export interface Sample {
	id: string;
	file: string;
	/** Shown as is (format names are not translated). */
	label: string;
}

/** The sample clips: 4 s, 640x360, 30 fps, a tone (tools/codec-samples.sh). */
export const SAMPLES: Sample[] = [
	{ id: 'h264-aac', file: 'h264-aac.mp4', label: 'H.264 + AAC (MP4)' },
	{ id: 'h265-aac', file: 'h265-aac.mp4', label: 'H.265 + AAC (MP4)' },
	{ id: 'h265-10bit-aac', file: 'h265-10bit-aac.mp4', label: 'H.265 10-bit + AAC (MP4)' },
	{ id: 'vp8-vorbis', file: 'vp8-vorbis.webm', label: 'VP8 + Vorbis (WebM)' },
	{ id: 'vp9-opus', file: 'vp9-opus.webm', label: 'VP9 + Opus (WebM)' },
	{ id: 'av1-opus', file: 'av1-opus.webm', label: 'AV1 + Opus (WebM)' },
	{ id: 'av1-opus-mp4', file: 'av1-opus.mp4', label: 'AV1 + Opus (MP4)' }
];
export const SAMPLE_FRAMES = 120;

export interface Target {
	id: string;
	label: string;
	container: 'mp4' | 'webm';
	video: VideoCodec;
	audio: AudioCodec;
}

/** What each device encodes a sample into. */
export const TARGETS: Target[] = [
	{ id: 'mp4-h264-aac', label: 'H.264 + AAC (MP4)', container: 'mp4', video: 'avc', audio: 'aac' },
	{ id: 'mp4-h265-aac', label: 'H.265 + AAC (MP4)', container: 'mp4', video: 'hevc', audio: 'aac' },
	{ id: 'mp4-vp9-opus', label: 'VP9 + Opus (MP4)', container: 'mp4', video: 'vp9', audio: 'opus' },
	{ id: 'mp4-av1-opus', label: 'AV1 + Opus (MP4)', container: 'mp4', video: 'av1', audio: 'opus' },
	{ id: 'webm-vp8-opus', label: 'VP8 + Opus (WebM)', container: 'webm', video: 'vp8', audio: 'opus' },
	{ id: 'webm-vp9-opus', label: 'VP9 + Opus (WebM)', container: 'webm', video: 'vp9', audio: 'opus' },
	{ id: 'webm-av1-opus', label: 'AV1 + Opus (WebM)', container: 'webm', video: 'av1', audio: 'opus' }
];

/** Why a test failed: translated on the page (codecs.error.<code>); detail = the browser's own words. */
export type ErrorCode =
	'download' | 'no_video' | 'cannot_decode' | 'no_encoder' | 'cannot_convert' | 'timeout' | 'failed';

export interface TestError {
	code: ErrorCode;
	detail?: string;
}

export interface DecodeResult {
	/** Video frames decoded (all of them: SAMPLE_FRAMES). */
	frames: number;
	audio: boolean;
	/** Played by a <video> element (the app's player), picture included. */
	plays: boolean;
	error?: TestError;
}

export interface EncodeResult {
	ok: boolean;
	seconds?: number;
	bytes?: number;
	/** The result decoded back: its frames. */
	framesBack?: number;
	error?: TestError;
}

/** Time limits (seconds): a stuck codec fails its step instead of blocking the others. */
export const LIMITS = { decode: 30, encode: 60, prepare: 30, play: 8 };

class Failure extends Error {
	constructor(
		readonly code: ErrorCode,
		detail?: string
	) {
		super(detail ?? code);
	}
}

const asError = (e: unknown): TestError =>
	e instanceof Failure
		? { code: e.code, ...(e.message !== e.code && { detail: e.message }) }
		: { code: 'failed', detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e) };

/** `step`, or a 'timeout' failure after `seconds` (then `onTimeout`, e.g. to cancel it). */
export function limit<T>(step: Promise<T>, seconds: number, onTimeout?: () => void): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			onTimeout?.();
			reject(new Failure('timeout', `${seconds} s`));
		}, seconds * 1000);
	});
	return Promise.race([step, timeout]).finally(() => clearTimeout(timer));
}

export const sampleUrl = (sample: Sample) => url(`/format-samples/${sample.file}`);

export async function fetchSample(sample: Sample): Promise<Blob> {
	let response: Response;
	try {
		response = await fetch(sampleUrl(sample));
	} catch (e) {
		throw new Failure('download', String(e));
	}
	if (!response.ok) throw new Failure('download', `HTTP ${response.status}`);
	return response.blob();
}

/** Every video frame and the audio really decoded. */
export async function decodeAll(blob: Blob): Promise<{ frames: number; audio: boolean }> {
	const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
	try {
		const video = await input.getPrimaryVideoTrack();
		if (!video) throw new Failure('no_video');
		if (!(await video.canDecode()))
			throw new Failure('cannot_decode', (await video.getCodecParameterString()) ?? undefined);
		let frames = 0;
		for await (const sample of new VideoSampleSink(video).samples()) {
			frames++;
			sample.close();
		}
		const track = await input.getPrimaryAudioTrack();
		let audio = false;
		if (track && (await track.canDecode())) {
			for await (const sample of new AudioSampleSink(track).samples()) {
				audio = true;
				sample.close();
			}
		}
		return { frames, audio };
	} finally {
		input.dispose();
	}
}

/** Played by a <video> element, picture included: past 1 s with frames shown, within
 * LIMITS.play, muted (autoplay allowed). In the page (tiny, transparent): some browsers show
 * no frames for a detached element. The audio alone moves the clock, so frames are counted. */
export function plays(blob: Blob): Promise<boolean> {
	return new Promise((resolve) => {
		const video = document.createElement('video');
		const src = URL.createObjectURL(blob);
		let frames = 0;
		const done = (ok: boolean) => {
			clearTimeout(timer);
			video.pause();
			video.removeAttribute('src');
			video.load();
			video.remove();
			URL.revokeObjectURL(src);
			resolve(ok);
		};
		const timer = setTimeout(() => done(false), LIMITS.play * 1000);
		const shown = () => frames || (video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0);
		const count = () => {
			frames++;
			video.requestVideoFrameCallback(count);
		};
		if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(count);
		video.muted = true;
		video.playsInline = true;
		video.setAttribute('aria-hidden', 'true');
		video.style.cssText = 'position:fixed;left:0;bottom:0;width:4px;height:4px;opacity:0.01;pointer-events:none';
		video.addEventListener('timeupdate', () => {
			if (video.currentTime > 1) done(video.videoWidth > 0 && shown() > 0);
		});
		video.addEventListener('error', () => done(false));
		document.body.append(video);
		video.src = src;
		video.play().catch(() => done(false));
	});
}

export async function decodeSample(sample: Sample): Promise<DecodeResult> {
	let blob: Blob;
	try {
		blob = await fetchSample(sample);
	} catch (e) {
		return { frames: 0, audio: false, plays: false, error: asError(e) };
	}
	const played = await plays(blob);
	try {
		return { ...(await limit(decodeAll(blob), LIMITS.decode)), plays: played };
	} catch (e) {
		return { frames: 0, audio: false, plays: played, error: asError(e) };
	}
}

/** The source encoded into the target (always re-encoded), then decoded back. */
export async function encodeTo(source: Blob, target: Target): Promise<EncodeResult> {
	const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
	const buffer = new BufferTarget();
	try {
		const format =
			target.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
		const conversion = await limit(
			Conversion.init({
				input,
				output: new Output({ format, target: buffer }),
				tracks: 'primary',
				video: { codec: target.video, quality: QUALITY_MEDIUM, keyFrameInterval: 1, forceTranscode: true },
				audio: { codec: target.audio, forceTranscode: true },
				showWarnings: false
			}),
			LIMITS.prepare
		);
		if (!conversion.isValid) {
			const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join(', ');
			throw new Failure(why.includes('no_encodable_target_codec') ? 'no_encoder' : 'cannot_convert', why);
		}
		const start = performance.now();
		await limit(conversion.execute(), LIMITS.encode, () => void conversion.cancel());
		const seconds = Number(((performance.now() - start) / 1000).toFixed(2));
		const result = new Blob([buffer.buffer!]);
		const back = await limit(decodeAll(result), LIMITS.decode).catch(() => ({ frames: 0 }));
		return { ok: back.frames > 0, seconds, bytes: result.size, framesBack: back.frames };
	} catch (e) {
		return { ok: false, error: asError(e) };
	} finally {
		input.dispose();
	}
}
