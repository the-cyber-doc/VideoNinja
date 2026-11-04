// A book's annotations in the viewer: the server's rows, kept in step with EmbedPDF's
// annotation plugin. The plugin holds them in the browser's copy of the PDF only (that
// copy is never sent): every change it commits (create, update, delete) is saved here,
// one row per PDF annotation (`target`: the annotation object as JSON). A text highlight
// keeps its quote (the text the plugin's highlight tool selected: `custom.text`); a region
// gets its crop (a JPEG, its own upload, published by the
// server). The note and technique are the panel's (never the plugin's). Changes to one
// annotation are sent in order (one chain each). Its dependencies are passed in: tests
// give fakes.
import type { BookAnnotation, BookAnnotationChange, BookAnnotationIn } from '../api/types';
import * as books from '../api/books';

/** The plugin's annotation object, as far as this module reads it. */
export interface PdfAnnotation {
	id: string;
	type: number;
	pageIndex: number;
	rect: Rect;
	segmentRects?: Rect[];
	color?: string;
	strokeColor?: string;
	/** The highlight tool's: the text selected. */
	custom?: { text?: string };
	created?: Date | string;
	modified?: Date | string;
	[key: string]: unknown;
}
export interface Rect {
	origin: { x: number; y: number };
	size: { width: number; height: number };
}
export interface AnnotationEvent {
	type: 'create' | 'update' | 'delete' | 'loaded';
	annotation?: PdfAnnotation;
	committed?: boolean;
}

/** PDF annotation subtypes (ISO 32000): the two tools the viewer offers. */
export const HIGHLIGHT = 9;
export const SQUARE = 5;

export interface AnnotationDeps {
	create: typeof books.createAnnotation;
	change: typeof books.changeAnnotation;
	remove: typeof books.deleteAnnotation;
	attachImage: typeof books.attachImage;
	/** A region of a page as a JPEG (null: not rendered). */
	crop: (pageIndex: number, rect: Rect) => Promise<Blob | null>;
	/** A picture uploaded (tus, kind "image"); its tus ID. */
	upload: (picture: Blob) => Promise<string>;
}

const DATES = ['created', 'modified'] as const;
/** Longest quote kept (the server's annotation_quote rule). */
export const QUOTE_MAX = 4000;
const quoteOf = (a: PdfAnnotation) => a.custom?.text?.replace(/\s+/g, ' ').trim().slice(0, QUOTE_MAX) || null;

/** A stored target back as the plugin's object (dates as Date). */
export function revive(target: string): PdfAnnotation {
	const a = JSON.parse(target) as PdfAnnotation;
	for (const key of DATES) if (typeof a[key] === 'string') a[key] = new Date(a[key] as string);
	return a;
}

export const uidOf = (row: BookAnnotation) => revive(row.target).id;
const kindOf = (a: PdfAnnotation): 'text' | 'region' => (a.type === SQUARE ? 'region' : 'text');
const colorOf = (a: PdfAnnotation) => (a.type === SQUARE ? a.strokeColor : a.color) ?? null;
const COLOR = /^#[0-9A-Fa-f]{3,8}$/;
const sameRect = (a: Rect, b: Rect) =>
	a.origin.x === b.origin.x &&
	a.origin.y === b.origin.y &&
	a.size.width === b.size.width &&
	a.size.height === b.size.height;

export class BookAnnotations {
	rows = $state<BookAnnotation[]>([]);
	/** The panel's annotation (its PDF annotation's ID), or none. */
	selectedUid = $state<string | null>(null);
	error = $state<unknown>(null);
	/** Changes not saved yet. */
	pending = $state(0);
	readonly selected = $derived(this.rows.find((r) => uidOf(r) === this.selectedUid) ?? null);

	/** PDF annotation ID → its row's ID (known: saved or being saved). */
	#ids = new Map<string, number | Promise<number | null>>();
	#chains = new Map<string, Promise<unknown>>();

	constructor(
		readonly bookId: number,
		rows: BookAnnotation[],
		private readonly deps: AnnotationDeps
	) {
		this.rows = rows;
		for (const row of rows) this.#ids.set(uidOf(row), row.id);
	}

	/** What the plugin imports: every saved annotation. */
	items() {
		return this.rows.map((row) => ({ annotation: revive(row.target) }));
	}

	/** One annotation's changes, one after the other. */
	#then(uid: string, work: () => Promise<unknown>) {
		this.pending += 1;
		const next = (this.#chains.get(uid) ?? Promise.resolve())
			.then(work)
			.catch((e) => (this.error = e))
			.finally(() => (this.pending -= 1));
		this.#chains.set(uid, next);
		return next;
	}

	async #id(uid: string) {
		return (await this.#ids.get(uid)) ?? null;
	}

	#replace(row: BookAnnotation) {
		const i = this.rows.findIndex((r) => r.id === row.id);
		if (i < 0) this.rows.push(row);
		else this.rows[i] = row;
	}

	/** The plugin's committed changes (the others are previews). Annotations it did not
	 * get from here (the PDF's own) are left alone. */
	handle(event: AnnotationEvent) {
		const a = event.annotation;
		if (!event.committed || !a) return;
		if (event.type === 'create' && !this.#ids.has(a.id)) {
			const saving = this.#create(a);
			this.#ids.set(a.id, saving);
			void this.#then(a.id, () => saving);
			this.selectedUid = a.id;
		} else if (event.type === 'update' && this.#ids.has(a.id)) {
			void this.#then(a.id, () => this.#update(a));
		} else if (event.type === 'delete' && this.#ids.has(a.id)) {
			void this.#then(a.id, async () => {
				const id = await this.#id(a.id);
				this.#ids.delete(a.id);
				if (this.selectedUid === a.id) this.selectedUid = null;
				if (id === null) return;
				await this.deps.remove(id);
				this.rows = this.rows.filter((r) => r.id !== id);
			});
		}
	}

	async #create(a: PdfAnnotation): Promise<number | null> {
		const kind = kindOf(a);
		const color = colorOf(a);
		const body: BookAnnotationIn = {
			page: a.pageIndex + 1,
			kind,
			target: JSON.stringify(a),
			...(color && COLOR.test(color) && { color })
		};
		const quote = kind === 'text' ? quoteOf(a) : null;
		if (quote) body.quote = quote;
		try {
			const row = await this.deps.create(this.bookId, body);
			this.#replace(row);
			if (kind === 'region') await this.#crop(row.id, a);
			return row.id;
		} catch (e) {
			this.error = e;
			return null;
		}
	}

	async #update(a: PdfAnnotation) {
		const id = await this.#id(a.id);
		const row = this.rows.find((r) => r.id === id);
		if (!row) return;
		const before = revive(row.target);
		const change: BookAnnotationChange = { target: JSON.stringify(a), page: a.pageIndex + 1 };
		const color = colorOf(a);
		if (color && COLOR.test(color)) change.color = color;
		const moved = !sameRect(before.rect, a.rect) || before.pageIndex !== a.pageIndex;
		this.#replace(await this.deps.change(row.id, change));
		if (moved && row.kind === 'region') await this.#crop(row.id, a);
	}

	async #crop(id: number, a: PdfAnnotation) {
		const picture = await this.deps.crop(a.pageIndex, a.rect);
		if (!picture) return;
		await this.deps.attachImage(id, await this.deps.upload(picture));
	}

	/** The panel's fields: a note, a technique (null: none). */
	edit(row: BookAnnotation, change: Pick<BookAnnotationChange, 'note' | 'technique'>) {
		return this.#then(uidOf(row), async () => this.#replace(await this.deps.change(row.id, change)));
	}

	/** Waits for every change sent so far (before leaving the page). */
	async settled() {
		await Promise.all(this.#chains.values());
	}
}
