// One book's page (/books/<id>): its PDF downloaded (progress shown), its reference edited,
// its annotations (BookAnnotations) saved through the viewer's helpers once the viewer is
// ready, a first-page picture made again when the book has none, and its pages' text sent
// (the search's) when it was not at the upload. Its dependencies
// (API, download, picture upload) are passed in: tests give fakes.
import { errorFromBody } from '../api/client';
import * as books from '../api/books';
import type { BookAnnotation, BookRow, TagIn } from '../api/types';
import { bookUrl } from '../media';
import { annotatedName, annotatedObjects, type Words } from './annotated';
import { BookAnnotations, type AnnotationDeps } from './annotations.svelte';
import { uploadPicture } from './pictures';
import { sendText } from './text';
import { problems, toDraft, toReference, type ReferenceDraft } from './reference';
import type { ViewerControls } from './ViewerPages.svelte';

export interface BookPageDeps {
	fetch: typeof fetch;
	/** The browser saves a file (a download). */
	save: (file: Blob, name: string) => void;
	editBook: typeof books.editBook;
	replaceThumbnail: typeof books.replaceThumbnail;
	sendText: (bookId: number, pages: string[]) => Promise<void>;
	uploadPicture: typeof uploadPicture;
	annotations: Omit<AnnotationDeps, 'crop' | 'upload'>;
}

/** A file the browser downloads, through a link it clicks. */
export function saveFile(file: Blob, name: string) {
	const link = document.createElement('a');
	link.href = URL.createObjectURL(file);
	link.download = name;
	link.click();
	setTimeout(() => URL.revokeObjectURL(link.href), 60_000);
}

export const DEPS: BookPageDeps = {
	fetch: (...args) => fetch(...args),
	save: saveFile,
	editBook: books.editBook,
	replaceThumbnail: books.replaceThumbnail,
	sendText: (bookId, pages) => sendText(bookId, pages, books.putBookText),
	uploadPicture,
	annotations: {
		create: books.createAnnotation,
		change: books.changeAnnotation,
		remove: books.deleteAnnotation,
		attachImage: books.attachImage
	}
};

/** The PDF's bytes, read as they come (fraction: 0..1, or null when the size is not said). */
export async function downloadPdf(
	url: string,
	progress: (fraction: number | null) => void,
	get: typeof fetch = fetch
): Promise<ArrayBuffer> {
	const res = await get(url, { credentials: 'same-origin' });
	if (!res.ok || !res.body) throw errorFromBody(res.status, null, res.headers.get('X-Request-ID'));
	const total = Number(res.headers.get('Content-Length')) || 0;
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let received = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		chunks.push(value);
		received += value.length;
		progress(total ? Math.min(1, received / total) : null);
	}
	const bytes = new Uint8Array(received);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes.buffer;
}

export class BookPage {
	book = $state<BookRow>() as BookRow;
	pdf = $state<ArrayBuffer | null>(null);
	progress = $state<number | null>(0);
	error = $state<unknown>(null);
	readonly annotations: BookAnnotations;
	#thumbnailTried = false; // once per visit
	#textTried = false; // once per visit
	/** The viewer's helpers, once it is ready. */
	controls = $state<ViewerControls | null>(null);

	// Editing the reference: the draft and tags, shown while editing.
	editing = $state(false);
	draft = $state<ReferenceDraft>() as ReferenceDraft;
	tags = $state<TagIn[]>([]);
	saving = $state(false);
	saved = $state(false);
	downloading = $state(false);
	readonly problems = $derived(this.draft ? problems(this.draft) : {});

	constructor(
		book: BookRow,
		rows: BookAnnotation[],
		private readonly deps: BookPageDeps = DEPS,
		/** The annotation to show first (?annotation=<id>, from a technique's page). */
		private focus: number | null = null,
		/** The page to show first (?page=<n>, from the search). */
		private page: number | null = null
	) {
		this.book = book;
		this.annotations = new BookAnnotations(book.id, rows, {
			...deps.annotations,
			crop: async (pageIndex, rect) => (await this.controls?.crop(pageIndex, rect)) ?? null,
			upload: (picture) => deps.uploadPicture(picture, `annotation-${book.id}.jpg`)
		});
	}

	async load() {
		try {
			this.pdf = await downloadPdf(bookUrl(this.book.id), (f) => (this.progress = f), this.deps.fetch);
		} catch (e) {
			this.error = e;
		}
	}

	/** The viewer is ready: its helpers serve the annotations; a missing first page is made. */
	async ready(controls: ViewerControls) {
		this.controls = controls; // the latest (the viewer says it again when its document changes)
		const focused = this.annotations.rows.find((r) => r.id === this.focus);
		this.focus = null; // once
		if (focused) controls.select(focused);
		else if (this.page) controls.showPage(this.page);
		this.page = null; // once
		await this.#thumbnail(controls);
		await this.#text(controls);
	}

	async #thumbnail(controls: ViewerControls) {
		if (this.book.has_thumbnail || this.#thumbnailTried) return;
		this.#thumbnailTried = true;
		try {
			const picture = await controls.firstPage();
			if (!picture) return;
			const upload = await this.deps.uploadPicture(picture, `book-${this.book.id}.jpg`);
			await this.deps.replaceThumbnail(this.book.id, upload);
			this.book.has_thumbnail = true; // published by the server within seconds
		} catch {
			// not essential: tried again the next time the book is opened
		}
	}

	async #text(controls: ViewerControls) {
		if (this.book.has_text || this.#textTried) return;
		this.#textTried = true;
		try {
			await this.deps.sendText(this.book.id, await controls.pageTexts());
			this.book.has_text = true;
		} catch {
			// not essential: sent again the next time the book is opened
		}
	}

	/** Download a copy of the PDF with every annotation written in it. */
	async download(words: Words, day: string) {
		const pdf = this.pdf;
		const controls = this.controls;
		if (!pdf || !controls) return;
		this.downloading = true;
		this.error = null;
		try {
			const objects = annotatedObjects(this.annotations.rows, words);
			const copy = await controls.annotatedCopy(pdf, objects);
			this.deps.save(new Blob([copy], { type: 'application/pdf' }), annotatedName(this.book.original_filename, day));
		} catch (e) {
			this.error = e;
		} finally {
			this.downloading = false;
		}
	}

	edit() {
		this.draft = toDraft(this.book.reference);
		this.tags = this.book.tags.map((t) => (t.value == null ? { id: t.id } : { id: t.id, value: t.value }));
		this.saved = false;
		this.error = null;
		this.editing = true;
	}

	async save() {
		if (!this.editing || Object.keys(this.problems).length) return;
		this.saving = true;
		this.error = null;
		try {
			this.book = await this.deps.editBook(this.book.id, { reference: toReference(this.draft), tags: this.tags });
			this.editing = false;
			this.saved = true;
		} catch (e) {
			this.error = e;
		} finally {
			this.saving = false;
		}
	}
}
