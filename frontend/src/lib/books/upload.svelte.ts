// The book upload page's steps, as state and actions. The PDF is read on this device
// first; nothing is sent before Upload.
//   pick → hashing (SHA-256; a known book stops here) → reading (page count, the PDF's
//   own title and author, page 1 as the thumbnail) → edit (the reference, tags) →
//   uploading (tus: the PDF, then the thumbnail) → submitting → done.
// Its dependencies (API, hashing, PDF reading, tus) are passed in: tests give fakes.
import type { Upload } from 'tus-js-client';
import type { ApiError } from '../api/client';
import type { TagIn } from '../api/types';
import * as books from '../api/books';
import { i18n, t } from '../i18n.svelte';
import { sha256File } from '../upload/hash';
import { startUpload, type UploadCallbacks } from '../upload/upload';
import { readPdf, type PdfFacts } from './pdf';
import { draftFromPdf, emptyDraft, problems, toReference, type ReferenceDraft } from './reference';

export type Step = 'pick' | 'hashing' | 'reading' | 'edit' | 'uploading' | 'submitting' | 'done';

type Kind = 'book' | 'image';

export interface BookUploadDeps {
	sha256File: (file: Blob, progress: (fraction: number) => void, signal: AbortSignal) => Promise<string>;
	bookExists: (sha256: string) => Promise<boolean>;
	readPdf: (file: Blob) => Promise<PdfFacts>;
	submitBook: typeof books.submitBook;
	startUpload: (
		file: Blob,
		meta: { sha256: string; originalFilename: string; kind: Kind },
		callbacks: UploadCallbacks
	) => Pick<Upload, 'abort'>;
	objectUrl: (blob: Blob) => string;
	revokeUrl: (url: string) => void;
}

export const DEPS: BookUploadDeps = {
	sha256File,
	bookExists: books.bookExists,
	readPdf,
	submitBook: books.submitBook,
	startUpload: (file, meta, callbacks) => startUpload(file as File, meta, callbacks),
	objectUrl: (blob) => URL.createObjectURL(blob),
	revokeUrl: (url) => URL.revokeObjectURL(url)
};

const megabytes = (bytes: number) =>
	new Intl.NumberFormat(i18n.lang, { maximumSignificantDigits: 3 }).format(bytes / 1024 ** 2);

export class BookUpload {
	step = $state<Step>('pick');
	file = $state<File | null>(null);
	hashProgress = $state(0);
	uploadProgress = $state(0);
	draft = $state<ReferenceDraft>(emptyDraft());
	tags = $state<TagIn[]>([]);
	pages = $state<number | null>(null);
	/** Page 1, shown while editing (an object URL, revoked by reset). */
	thumbnailSrc = $state('');
	error = $state<unknown>(null);
	retrying = $state(false);
	/** The new book's ID, once submitted. */
	submittedId = $state<number | null>(null);
	readonly busy = $derived(
		this.step === 'hashing' || this.step === 'reading' || this.step === 'uploading' || this.step === 'submitting'
	);
	readonly problems = $derived(problems(this.draft));

	#sha256 = '';
	#thumbnail: Blob | null = null;
	#hashing: AbortController | null = null;
	#upload: Pick<Upload, 'abort'> | null = null;

	constructor(
		/** Largest PDF (null: not known, the server checks anyway). */
		readonly maxBytes: number | null,
		private readonly deps: BookUploadDeps = DEPS
	) {}

	async choose(file: File) {
		this.reset();
		if (!/\.pdf$/i.test(file.name)) {
			this.error = t('books.upload.not_pdf');
			return;
		}
		if (this.maxBytes !== null && file.size > this.maxBytes) {
			this.error = t('books.upload.too_large', { size: megabytes(this.maxBytes) });
			return;
		}
		this.file = file;
		this.step = 'hashing';
		const hashing = (this.#hashing = new AbortController());
		try {
			this.#sha256 = await this.deps.sha256File(file, (f) => (this.hashProgress = f), hashing.signal);
			if (await this.deps.bookExists(this.#sha256)) {
				this.reset();
				this.error = t('books.upload.duplicate');
				return;
			}
			this.step = 'reading';
			const facts = await this.deps.readPdf(file).catch(() => null);
			if (!facts) {
				this.reset();
				this.error = t('books.upload.unreadable');
				return;
			}
			this.pages = facts.pages || null;
			this.#thumbnail = facts.thumbnail;
			if (facts.thumbnail) this.thumbnailSrc = this.deps.objectUrl(facts.thumbnail);
			this.draft = draftFromPdf(facts.title, facts.author);
			this.step = 'edit';
		} catch (e) {
			if (hashing.signal.aborted) return; // cancelled: reset already done
			this.reset();
			this.error = e;
		}
	}

	/** One tus upload; its tus ID. */
	#send(blob: Blob, meta: { sha256: string; originalFilename: string; kind: Kind }, share: [number, number]) {
		return new Promise<string>((resolve, reject) => {
			this.#upload = this.deps.startUpload(blob, meta, {
				onUrl: () => {},
				onProgress: (f) => {
					this.retrying = false;
					this.uploadProgress = share[0] + f * share[1];
				},
				onRetry: () => (this.retrying = true),
				onSuccess: resolve,
				onError: (e: ApiError) => reject(e)
			});
		});
	}

	async proceed() {
		const file = this.file;
		if (this.step !== 'edit' || !file || Object.keys(this.problems).length) return;
		this.step = 'uploading';
		this.error = null;
		try {
			const name = file.name;
			const upload = await this.#send(file, { sha256: this.#sha256, originalFilename: name, kind: 'book' }, [0, 0.95]);
			let thumbnailUpload: string | null = null;
			if (this.#thumbnail) {
				const sha256 = await this.deps.sha256File(this.#thumbnail, () => {}, new AbortController().signal);
				const meta = { sha256, originalFilename: `${name.replace(/\.pdf$/i, '')}.jpg`, kind: 'image' as const };
				thumbnailUpload = await this.#send(this.#thumbnail, meta, [0.95, 0.05]);
			}
			this.step = 'submitting';
			const { id } = await this.deps.submitBook({
				upload,
				thumbnail_upload: thumbnailUpload,
				original_filename: name,
				pages: this.pages,
				reference: toReference(this.draft),
				tags: this.tags
			});
			this.reset();
			this.submittedId = id;
			this.step = 'done';
		} catch (e) {
			this.step = 'edit'; // the form is kept: Upload again sends it again
			this.retrying = false;
			this.error = e;
		}
	}

	/** Stop and forget: the upload in progress is deleted from the server. */
	async cancel() {
		this.#hashing?.abort();
		await this.#upload?.abort(true).catch(() => {});
		this.reset();
	}

	reset() {
		if (this.thumbnailSrc) this.deps.revokeUrl(this.thumbnailSrc);
		this.step = 'pick';
		this.file = null;
		this.hashProgress = 0;
		this.uploadProgress = 0;
		this.draft = emptyDraft();
		this.tags = [];
		this.pages = null;
		this.thumbnailSrc = '';
		this.error = null;
		this.retrying = false;
		this.submittedId = null;
		this.#sha256 = '';
		this.#thumbnail = null;
		this.#hashing = null;
		this.#upload = null;
	}
}
