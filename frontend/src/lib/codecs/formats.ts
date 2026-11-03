// The "Test local codecs" page: what this browser says it can do with each common video
// and audio format. Encoding and decoding: WebCodecs (`isConfigSupported`). Playing in the
// browser's own player (the app's <video>): Media Capabilities (`decodingInfo`), in MP4
// (the app's container: nginx cuts clips from MP4 only) and WebM. These are the browser's
// answers, not proofs: samples.ts really decodes and encodes.

export type Kind = 'video' | 'audio';
export type Container = 'mp4' | 'webm';

export interface Format {
	id: string;
	/** Shown as is (format names are not translated). */
	label: string;
	kind: Kind;
	/** WebCodecs codec string, also the `codecs=` of the MIME type. */
	codec: string;
	/** Containers it is stored in, for the playback checks. */
	containers: Container[];
	width?: number;
	height?: number;
}

const HD = { width: 1920, height: 1080 };
const UHD = { width: 3840, height: 2160 };

/** The common profiles of every format in WebCodecs' codec registry. */
export const FORMATS: Format[] = [
	{ id: 'h264-high', label: 'H.264 High 1080p', kind: 'video', codec: 'avc1.640028', containers: ['mp4'], ...HD },
	{ id: 'h264-4k', label: 'H.264 High 4K', kind: 'video', codec: 'avc1.640033', containers: ['mp4'], ...UHD },
	{
		id: 'h264-base',
		label: 'H.264 Baseline 720p',
		kind: 'video',
		codec: 'avc1.42E01F',
		containers: ['mp4'],
		width: 1280,
		height: 720
	},
	{
		id: 'h265-hvc1',
		label: 'H.265 Main 1080p (hvc1)',
		kind: 'video',
		codec: 'hvc1.1.6.L120.90',
		containers: ['mp4'],
		...HD
	},
	{
		id: 'h265-hev1',
		label: 'H.265 Main 1080p (hev1)',
		kind: 'video',
		codec: 'hev1.1.6.L120.90',
		containers: ['mp4'],
		...HD
	},
	{
		id: 'h265-4k',
		label: 'H.265 Main 4K (hvc1)',
		kind: 'video',
		codec: 'hvc1.1.6.L153.90',
		containers: ['mp4'],
		...UHD
	},
	{
		id: 'h265-10',
		label: 'H.265 Main 10 1080p (hvc1)',
		kind: 'video',
		codec: 'hvc1.2.4.L120.90',
		containers: ['mp4'],
		...HD
	},
	{ id: 'vp8', label: 'VP8 1080p', kind: 'video', codec: 'vp8', containers: ['webm'], ...HD },
	{
		id: 'vp9',
		label: 'VP9 profile 0 1080p',
		kind: 'video',
		codec: 'vp09.00.40.08',
		containers: ['mp4', 'webm'],
		...HD
	},
	{
		id: 'vp9-4k',
		label: 'VP9 profile 0 4K',
		kind: 'video',
		codec: 'vp09.00.51.08',
		containers: ['mp4', 'webm'],
		...UHD
	},
	{
		id: 'vp9-10',
		label: 'VP9 profile 2 10-bit 1080p',
		kind: 'video',
		codec: 'vp09.02.40.10',
		containers: ['mp4', 'webm'],
		...HD
	},
	{ id: 'av1', label: 'AV1 Main 1080p', kind: 'video', codec: 'av01.0.08M.08', containers: ['mp4', 'webm'], ...HD },
	{ id: 'av1-4k', label: 'AV1 Main 4K', kind: 'video', codec: 'av01.0.12M.08', containers: ['mp4', 'webm'], ...UHD },
	{
		id: 'av1-10',
		label: 'AV1 Main 10-bit 1080p',
		kind: 'video',
		codec: 'av01.0.08M.10',
		containers: ['mp4', 'webm'],
		...HD
	},
	{ id: 'aac', label: 'AAC-LC', kind: 'audio', codec: 'mp4a.40.2', containers: ['mp4'] },
	{ id: 'he-aac', label: 'HE-AAC', kind: 'audio', codec: 'mp4a.40.5', containers: ['mp4'] },
	{ id: 'opus', label: 'Opus', kind: 'audio', codec: 'opus', containers: ['mp4', 'webm'] },
	{ id: 'vorbis', label: 'Vorbis', kind: 'audio', codec: 'vorbis', containers: ['webm'] },
	{ id: 'flac', label: 'FLAC', kind: 'audio', codec: 'flac', containers: ['mp4'] },
	{ id: 'mp3', label: 'MP3', kind: 'audio', codec: 'mp3', containers: ['mp4'] }
];

/** true / false, or null when the browser could not tell (no such API, or it threw). */
export type Answer = boolean | null;

export interface Playback {
	supported: boolean;
	smooth: boolean;
	/** Usually: decoded in hardware. */
	powerEfficient: boolean;
}

export interface FormatResult {
	/** Video only (audio has no such hint): null for audio. */
	encodeHardware: Answer;
	encode: Answer;
	decode: Answer;
	play: Partial<Record<Container, Playback | null>>;
}

const VIDEO_BITRATE = 5_000_000;
const AUDIO_BITRATE = 128_000;
const SAMPLE_RATE = 48_000;

async function ask(test: () => Promise<{ supported?: boolean }>): Promise<Answer> {
	try {
		return !!(await test()).supported;
	} catch {
		return null;
	}
}

export function encodeCheck(format: Format, hardwareAcceleration: HardwareAcceleration): Promise<Answer> {
	if (format.kind === 'video') {
		if (typeof VideoEncoder === 'undefined') return Promise.resolve(null);
		return ask(() =>
			VideoEncoder.isConfigSupported({
				codec: format.codec,
				width: format.width!,
				height: format.height!,
				bitrate: VIDEO_BITRATE,
				framerate: 30,
				hardwareAcceleration
			})
		);
	}
	if (hardwareAcceleration === 'prefer-hardware' || typeof AudioEncoder === 'undefined') return Promise.resolve(null);
	return ask(() =>
		AudioEncoder.isConfigSupported({
			codec: format.codec,
			sampleRate: SAMPLE_RATE,
			numberOfChannels: 2,
			bitrate: AUDIO_BITRATE
		})
	);
}

export function decodeCheck(format: Format): Promise<Answer> {
	if (format.kind === 'video') {
		if (typeof VideoDecoder === 'undefined') return Promise.resolve(null);
		return ask(() =>
			VideoDecoder.isConfigSupported({ codec: format.codec, codedWidth: format.width!, codedHeight: format.height! })
		);
	}
	if (typeof AudioDecoder === 'undefined') return Promise.resolve(null);
	return ask(() =>
		AudioDecoder.isConfigSupported({ codec: format.codec, sampleRate: SAMPLE_RATE, numberOfChannels: 2 })
	);
}

export async function playCheck(format: Format, container: Container): Promise<Playback | null> {
	const capabilities = globalThis.navigator?.mediaCapabilities;
	if (!capabilities) return null;
	const contentType = `${format.kind}/${container}; codecs="${format.codec}"`;
	try {
		const info = await capabilities.decodingInfo(
			format.kind === 'video'
				? {
						type: 'file',
						video: {
							contentType,
							width: format.width!,
							height: format.height!,
							bitrate: VIDEO_BITRATE,
							framerate: 30
						}
					}
				: { type: 'file', audio: { contentType, channels: '2', bitrate: AUDIO_BITRATE, samplerate: SAMPLE_RATE } }
		);
		return { supported: info.supported, smooth: info.smooth, powerEfficient: info.powerEfficient };
	} catch {
		return null;
	}
}

/** Every format's answers, one question at a time (some browsers stall on many at once). */
export async function probeFormats(): Promise<Record<string, FormatResult>> {
	const results: Record<string, FormatResult> = {};
	for (const format of FORMATS) {
		const play: FormatResult['play'] = {};
		for (const container of format.containers) play[container] = await playCheck(format, container);
		results[format.id] = {
			encodeHardware: await encodeCheck(format, 'prefer-hardware'),
			encode: await encodeCheck(format, 'no-preference'),
			decode: await decodeCheck(format),
			play
		};
	}
	return results;
}
