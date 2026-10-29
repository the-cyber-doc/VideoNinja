// The upload page's steps, as state and actions (the page shows them, and keeps the
// component's own work: the draft's autosave, the guard against leaving, the
// confirmations). The file is opened on this device; nothing is sent before Proceed.
//   pick → hashing (SHA-256; a known video stops here) → edit (a draft, new or
//   resumed) → uploading (tus, resumable) → submitting → pick again (published later).
// Its dependencies (API, drafts, hashing, tus) are passed in: tests give fakes.
import type { Upload } from 'tus-js-client';
import type { ApiError } from '../api/client';
import type { UploadLimits } from '../api/types';
import * as uploads from '../api/uploads';
import { i18n, t } from '../i18n.svelte';
import * as drafts from './draft.svelte';
import type { Draft } from './draft.svelte';
import { sha256File } from './hash';
import { refusal, submitBody } from './rules';
import { startUpload, type UploadCallbacks } from './upload';

export type Step = 'pick' | 'hashing' | 'edit' | 'uploading' | 'submitting';

export interface FlowDeps {
	sha256File: (file: File, progress: (fraction: number) => void, signal: AbortSignal) => Promise<string>;
	videoExists: (sha256: string) => Promise<boolean>;
	uploadsAvailable: () => Promise<boolean>;
	submit: typeof uploads.submit;
	listDrafts: () => Promise<Draft[]>;
	loadDraft: (sha256: string) => Promise<Draft | undefined>;
	newDraft: (sha256: string, file: File) => Draft;
	deleteDraft: (sha256: string) => Promise<void>;
	startUpload: (
		file: File,
		meta: { sha256: string; originalFilename: string; uploadUrl?: string },
		callbacks: UploadCallbacks
	) => Pick<Upload, 'abort'>;
}

const DEPS: FlowDeps = {
	sha256File,
	videoExists: uploads.videoExists,
	uploadsAvailable: uploads.uploadsAvailable,
	submit: uploads.submit,
	listDrafts: drafts.listDrafts,
	loadDraft: drafts.loadDraft,
	newDraft: drafts.newDraft,
	deleteDraft: drafts.deleteDraft,
	startUpload
};

const gigabytes = (bytes: number) =>
	new Intl.NumberFormat(i18n.lang, { maximumSignificantDigits: 3 }).format(bytes / 1024 ** 3);

export class UploadFlow {
	step = $state<Step>('pick');
	file = $state<File | null>(null);
	/** The chosen file, for the video element (an object URL, revoked by reset). */
	src = $state('');
	draft = $state<Draft | null>(null);
	/** Unfinished work saved on this device (shown while picking). */
	drafts = $state<Draft[]>([]);
	hashProgress = $state(0);
	uploadProgress = $state(0);
	duplicate = $state(false);
	resumed = $state(false);
	message = $state('');
	error = $state<unknown>(null);
	/** The server cannot receive uploads now (its tusd is not running). */
	unavailable = $state(false);
	/** The upload is interrupted and being retried. */
	retrying = $state(false);
	/** Bumped when a video was submitted: "my uploads" reloads. */
	submitted = $state(0);
	readonly busy = $derived(this.step === 'hashing' || this.step === 'uploading' || this.step === 'submitting');

	#hashing: AbortController | null = null;
	#upload: Pick<Upload, 'abort'> | null = null;

	constructor(
		/** Largest file and accepted types (null: not known, the server checks anyway). */
		readonly limits: UploadLimits | null,
		unavailable: boolean,
		private readonly deps: FlowDeps = DEPS
	) {
		this.unavailable = unavailable;
		this.reloadDrafts();
	}

	reloadDrafts() {
		this.deps.listDrafts().then(
			(list) => (this.drafts = list),
			() => {}
		);
	}

	checkAvailable() {
		this.deps.uploadsAvailable().then(
			(ok) => (this.unavailable = !ok),
			() => {}
		);
	}

	/** Back to picking a file (the draft stays saved). */
	reset() {
		if (this.src) URL.revokeObjectURL(this.src);
		this.file = null;
		this.src = '';
		this.draft = null;
		this.step = 'pick';
		this.hashProgress = this.uploadProgress = 0;
		this.duplicate = this.resumed = false;
		this.#upload = null;
		this.reloadDrafts();
	}

	/** A file picked: refused at once if the server would refuse it, else hashed, then
	 * edited (its saved draft resumed, else a new one). False when refused. */
	async choose(chosen: File): Promise<boolean> {
		this.reset();
		this.message = '';
		this.error = null;
		const refused = refusal(chosen, this.limits);
		if (refused) {
			this.error =
				refused === 'size'
					? t('upload.too_large', { max: gigabytes(this.limits!.max_bytes) })
					: t('upload.wrong_type', { types: this.limits!.extensions.join(', ') });
			return false;
		}
		this.file = chosen;
		this.step = 'hashing';
		this.checkAvailable(); // it may have come back since the page was opened
		const hashing = (this.#hashing = new AbortController());
		try {
			const sha = await this.deps.sha256File(chosen, (f) => (this.hashProgress = f), hashing.signal);
			if (await this.deps.videoExists(sha)) {
				this.duplicate = true;
				this.step = 'pick';
				return true;
			}
			const saved = await this.deps.loadDraft(sha).catch(() => undefined);
			this.resumed = !!saved;
			this.draft = saved ?? this.deps.newDraft(sha, chosen);
			this.src = URL.createObjectURL(chosen);
			this.step = 'edit';
		} catch (e) {
			if (!hashing.signal.aborted) {
				this.error = e;
				this.step = 'pick';
			}
		}
		return true;
	}

	/** The annotation is complete: upload the original, then submit it with the annotation. */
	proceed() {
		const { draft, file } = this;
		if (!draft || !file || this.unavailable) return;
		this.error = null;
		this.message = '';
		this.step = 'uploading';
		this.uploadProgress = 0;
		this.retrying = false;
		const meta = { sha256: draft.sha256, originalFilename: draft.originalFilename, uploadUrl: draft.uploadUrl };
		this.#upload = this.deps.startUpload(file, meta, {
			onUrl: (url) => (draft.uploadUrl = url),
			onProgress: (fraction) => {
				this.uploadProgress = fraction;
				this.retrying = false;
			},
			onRetry: () => (this.retrying = true),
			onSuccess: (tusId) => this.#submit(draft, tusId),
			onError: (e: ApiError) => {
				// The server forgot this upload (expired, deleted): start over next time.
				if (e.status === 404 || e.status === 410) draft.uploadUrl = undefined;
				this.error = t('upload.failed', { error: e.message });
				this.retrying = false;
				this.step = 'edit';
				this.checkAvailable();
			}
		});
	}

	async #submit(draft: Draft, tusId: string) {
		this.step = 'submitting';
		try {
			await this.deps.submit(tusId, submitBody(draft));
			await this.deps.deleteDraft(draft.sha256).catch(() => {});
			this.reset();
			this.message = t('upload.submitted');
			this.submitted++;
		} catch (e) {
			this.error = e;
			this.step = 'edit';
		}
	}

	/** Stop and forget this file's work: the hashing, what was uploaded, the draft. */
	async cancel() {
		this.#hashing?.abort();
		await this.#upload?.abort(true).catch(() => {}); // true: also deletes what was uploaded
		if (this.draft) await this.deps.deleteDraft(this.draft.sha256).catch(() => {});
		this.reset();
	}

	/** A saved draft dropped (the list while picking). */
	async discard(sha256: string) {
		await this.deps.deleteDraft(sha256).catch(() => {});
		this.drafts = this.drafts.filter((d) => d.sha256 !== sha256);
	}

	/** The page is left: stop what runs, keep the draft (the upload resumes from it). */
	dispose() {
		this.#hashing?.abort();
		this.#upload?.abort(); // not terminated: resumed from the draft
		if (this.src) URL.revokeObjectURL(this.src);
	}
}
