// Mass import on the upload page: many videos, no segments yet (added later on the Videos
// page), the same tags for all. Files are added in as many picks as wanted; Process then
// takes them one at a time (hashing reads the disk, tusd and nginx take one upload well):
//   hashing (a known video: duplicate) → uploading (tus, resumable) → submitting → done.
// A failure marks its file and goes on with the next; Process again retries the failed
// ones (their upload resumes). Its dependencies (API, hashing, tus) are passed in: tests
// give fakes.
import type { Upload } from 'tus-js-client';
import { ApiError } from '../api/client';
import type { TagIn, UploadLimits } from '../api/types';
import * as uploads from '../api/uploads';
import { i18n, t } from '../i18n.svelte';
import { refusalText } from './flow.svelte';
import { sha256File } from './hash';
import { refusal } from './rules';
import { startUpload, type UploadCallbacks } from './upload';

export type BatchStatus =
	'waiting' | 'hashing' | 'uploading' | 'submitting' | 'done' | 'duplicate' | 'refused' | 'failed';

export interface BatchItem {
	key: number;
	file: File;
	status: BatchStatus;
	/** Of the hashing or the upload (0–1). */
	progress: number;
	/** The upload is interrupted and being retried. */
	retrying: boolean;
	/** Why it was refused or failed (an ApiError or a t() string). */
	error: unknown;
	sha256?: string;
	/** tus: kept while the page is open, so a retry resumes. */
	uploadUrl?: string;
}

export interface BatchDeps {
	sha256File: (file: File, progress: (fraction: number) => void, signal: AbortSignal) => Promise<string>;
	videoExists: (sha256: string) => Promise<boolean>;
	uploadsAvailable: () => Promise<boolean>;
	submit: typeof uploads.submit;
	startUpload: (
		file: File,
		meta: { sha256: string; originalFilename: string; uploadUrl?: string },
		callbacks: UploadCallbacks
	) => Pick<Upload, 'abort'>;
}

const DEPS: BatchDeps = {
	sha256File,
	videoExists: uploads.videoExists,
	uploadsAvailable: uploads.uploadsAvailable,
	submit: uploads.submit,
	startUpload
};

/** Statuses Process takes. */
const TODO: BatchStatus[] = ['waiting', 'failed'];
/** Statuses "remove finished" drops. */
const FINISHED: BatchStatus[] = ['done', 'duplicate', 'refused'];

/** A file's size for the list: megabytes, gigabytes from 1 GB. */
export function sizeText(bytes: number): string {
	const giga = bytes >= 1024 ** 3;
	return new Intl.NumberFormat(i18n.lang, {
		style: 'unit',
		unit: giga ? 'gigabyte' : 'megabyte',
		maximumFractionDigits: 1
	}).format(bytes / 1024 ** (giga ? 3 : 2));
}

const sameFile = (a: File, b: File) => a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

export class BatchImport {
	items = $state<BatchItem[]>([]);
	/** Given to every video. */
	tags = $state<TagIn[]>([]);
	running = $state(false);
	error = $state<unknown>(null);
	/** The server cannot receive uploads now (its tusd is not running). */
	unavailable = $state(false);
	/** Queued by the last Process (its summary). */
	queued = $state(0);
	/** Bumped at each video queued: "my uploads" reloads. */
	submitted = $state(0);
	readonly pending = $derived(this.items.filter((i) => TODO.includes(i.status)).length);
	readonly finished = $derived(this.items.filter((i) => FINISHED.includes(i.status)).length);

	#key = 0;
	#run: AbortController | null = null;

	constructor(
		/** Largest file and accepted types (null: not known, the server checks anyway). */
		readonly limits: UploadLimits | null,
		unavailable = false,
		private readonly deps: BatchDeps = DEPS
	) {
		this.unavailable = unavailable;
	}

	/** Files picked (one pick or many): listed once each; those the server would refuse, at once. */
	add(files: Iterable<File>) {
		for (const file of files) {
			if (this.items.some((i) => sameFile(i.file, file))) continue;
			const refused = refusal(file, this.limits);
			this.items.push({
				key: ++this.#key,
				file,
				status: refused ? 'refused' : 'waiting',
				progress: 0,
				retrying: false,
				error: refused ? refusalText(refused, this.limits!) : null
			});
		}
	}

	/** The file being sent (its key), else null. */
	current = $state<number | null>(null);

	/** One file out of the list (not the one being sent). */
	remove(key: number) {
		if (key !== this.current) this.items = this.items.filter((i) => i.key !== key);
	}

	/** Out of the list: those queued, already on the server or refused. */
	removeFinished() {
		this.items = this.items.filter((i) => !FINISHED.includes(i.status));
	}

	/** Send every waiting or failed file, one at a time; added ones too, even during the run. */
	async process() {
		if (this.running) return;
		const run = (this.#run = new AbortController());
		this.running = true;
		this.error = null;
		this.queued = 0;
		try {
			this.unavailable = !(await this.deps.uploadsAvailable().catch(() => true)); // not known: tried
			if (this.unavailable) {
				this.error = t('upload.unavailable');
				return;
			}
			const tried = new Set<number>(); // a failure is not retried in the same run
			let item: BatchItem | undefined;
			while (!run.signal.aborted && (item = this.items.find((i) => TODO.includes(i.status) && !tried.has(i.key)))) {
				tried.add(item.key);
				this.current = item.key;
				await this.#send(item, run.signal);
			}
		} finally {
			this.running = false;
			this.current = null;
			this.#run = null;
		}
	}

	/** Stop after nothing: the current file goes back to waiting (its upload resumes next time). */
	stop() {
		this.#run?.abort();
	}

	/** The page is left. */
	dispose() {
		this.stop();
	}

	async #send(item: BatchItem, signal: AbortSignal) {
		item.error = null;
		item.progress = 0;
		try {
			item.status = 'hashing';
			item.sha256 ??= await this.deps.sha256File(item.file, (f) => (item.progress = f), signal);
			if (await this.deps.videoExists(item.sha256)) {
				item.status = 'duplicate';
				return;
			}
			signal.throwIfAborted();
			item.status = 'uploading';
			item.progress = 0;
			const tusId = await this.#upload(item, item.sha256, signal);
			item.status = 'submitting';
			await this.deps.submit(tusId, {
				original_filename: item.file.name,
				all_segments_done: false, // segments: later, on the Videos page
				segments: [],
				tags: $state.snapshot(this.tags)
			});
			item.status = 'done';
			this.queued++;
			this.submitted++;
		} catch (e) {
			item.retrying = false;
			if (signal.aborted) {
				item.status = 'waiting';
				item.progress = 0;
			} else if (e instanceof ApiError && e.code === 'video.exists') {
				item.status = 'duplicate'; // sent meanwhile (another tab, the single upload)
			} else {
				item.status = 'failed';
				item.error = e;
			}
		}
	}

	/** The tus upload, as a promise of its ID; rejected when stopped (the upload is kept). */
	#upload(item: BatchItem, sha256: string, signal: AbortSignal): Promise<string> {
		return new Promise((resolve, reject) => {
			const meta = { sha256, originalFilename: item.file.name, uploadUrl: item.uploadUrl };
			const upload = this.deps.startUpload(item.file, meta, {
				onUrl: (url) => (item.uploadUrl = url),
				onProgress: (fraction) => {
					item.progress = fraction;
					item.retrying = false;
				},
				onRetry: () => (item.retrying = true),
				onSuccess: resolve,
				onError: (e: ApiError) => {
					// The server forgot this upload (expired, deleted): start over next time.
					if (e.status === 404 || e.status === 410) item.uploadUrl = undefined;
					reject(t('upload.batch.failed', { error: e.message }));
				}
			});
			signal.addEventListener(
				'abort',
				() => {
					upload.abort().catch(() => {}); // not terminated: resumed next time
					reject(signal.reason);
				},
				{ once: true }
			);
		});
	}
}
