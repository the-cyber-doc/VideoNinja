// "Test local codecs": the browser's answers for every format (formats.ts), then, on
// request, the real tests on the sample clips (samples.ts), and the results copied as
// JSON for whoever asked (nothing is sent by the app). The run order matters: a decoder
// that hangs can block the browser's codecs until a reload (seen in WebKit), so a source
// sample is found first, the encodings run next, and the other samples are decoded last.
import { probeFormats, type FormatResult } from '#lib/codecs/formats.js';
import {
	decodeSample,
	encodeTo,
	fetchSample,
	SAMPLE_FRAMES,
	SAMPLES,
	TARGETS,
	type DecodeResult,
	type EncodeResult,
	type Sample,
	type Target
} from '#lib/codecs/samples.js';

export interface CodecDeps {
	probe: () => Promise<Record<string, FormatResult>>;
	decode: (sample: Sample) => Promise<DecodeResult>;
	fetch: (sample: Sample) => Promise<Blob>;
	encode: (source: Blob, target: Target) => Promise<EncodeResult>;
	copy: (text: string) => Promise<void>;
	userAgent: () => string;
}

export const browserDeps: CodecDeps = {
	probe: probeFormats,
	decode: decodeSample,
	fetch: fetchSample,
	encode: encodeTo,
	copy: (text) => navigator.clipboard.writeText(text),
	userAgent: () => navigator.userAgent
};

/** The encodings start from the first of these samples decoded whole. */
export const SOURCES = ['h264-aac', 'vp9-opus', 'av1-opus', 'h265-aac', 'vp8-vorbis', 'av1-opus-mp4'];

/** What the page is doing now: shown with the sample or target's name. */
export type Step = { kind: 'decode' | 'encode'; label: string } | null;

export class CodecTest {
	formats = $state<Record<string, FormatResult> | null>(null);
	decoding = $state<Record<string, DecodeResult> | null>(null);
	encoding = $state<Record<string, EncodeResult> | null>(null);
	/** The sample the encodings started from; null: none decoded whole (nothing encoded). */
	encodedFrom = $state<string | null>(null);
	step = $state<Step>(null);
	name = $state('');
	copied = $state(false);
	error = $state<unknown>(null);
	readonly #deps: CodecDeps;

	constructor(deps: CodecDeps = browserDeps) {
		this.#deps = deps;
	}

	get running() {
		return this.step !== null;
	}

	/** The browser's answers (at once on opening the page: quick, nothing downloaded). */
	async start() {
		try {
			this.formats = await this.#deps.probe();
		} catch (e) {
			this.error = e;
		}
	}

	async run() {
		if (this.running) return;
		this.error = null;
		this.decoding = {};
		this.encoding = {};
		this.encodedFrom = null;
		// Read back: $state keeps a reactive copy, not the objects assigned.
		const decoding = this.decoding;
		const encoding = this.encoding;
		const decode = async (sample: Sample) => {
			this.step = { kind: 'decode', label: sample.label };
			decoding[sample.id] = await this.#deps.decode(sample);
			return decoding[sample.id].frames === SAMPLE_FRAMES;
		};
		try {
			for (const id of SOURCES) {
				const sample = SAMPLES.find((s) => s.id === id)!;
				if (!(await decode(sample))) continue;
				this.encodedFrom = id;
				const source = await this.#deps.fetch(sample);
				for (const target of TARGETS) {
					this.step = { kind: 'encode', label: target.label };
					encoding[target.id] = await this.#deps.encode(source, target);
				}
				break;
			}
			for (const sample of SAMPLES) if (!decoding[sample.id]) await decode(sample);
		} catch (e) {
			this.error = e;
		} finally {
			this.step = null;
		}
	}

	/** Everything found, as JSON: to send to whoever asked (mail, messenger…). */
	results(): string {
		return JSON.stringify(
			{
				name: this.name.trim(),
				userAgent: this.#deps.userAgent(),
				formats: this.formats,
				decoding: this.decoding,
				encoding: this.encoding,
				encodedFrom: this.encodedFrom
			},
			null,
			1
		);
	}

	async copy() {
		this.error = null;
		try {
			await this.#deps.copy(this.results());
			this.copied = true;
			setTimeout(() => (this.copied = false), 2000);
		} catch (e) {
			this.error = e;
		}
	}
}
