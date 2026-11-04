// A book's annotations as the PDF annotations of a downloaded copy: each row's own (where
// and how the viewer drew it), with its author, its dates and, as its contents, its
// technique and note; each comment as a reply to it (a Text annotation "in reply to" it:
// Acrobat, Firefox, Okular and Preview show a thread). Pure: the engine writes them
// (pdf.ts annotatedCopy).
import type { BookAnnotation, BookComment } from '../api/types';
import { revive, type PdfAnnotation } from './annotations.svelte';

/** PDF annotation subtype of a note (ISO 32000): the replies. */
export const TEXT = 1;
/** A reply's icon size in points (shown where its annotation starts). */
const NOTE_SIZE = 20;

export interface Words {
	/** "Technique: <kanji> <romaji> — <its page's address>", or null when there is none. */
	technique: (id: string) => string | null;
	/** The name of a deleted user. */
	unknownAuthor: string;
}

export function annotatedObjects(rows: BookAnnotation[], comments: BookComment[], words: Words): PdfAnnotation[] {
	const objects: PdfAnnotation[] = [];
	for (const row of rows) {
		const a = revive(row.target);
		const contents = [row.technique && words.technique(row.technique), row.note].filter(Boolean).join('\n\n');
		objects.push({
			...a,
			author: row.created_by ?? words.unknownAuthor,
			created: new Date(row.created_at),
			modified: new Date(row.modified_at),
			...(contents && { contents })
		});
		for (const c of comments.filter((c) => c.annotation === row.id)) {
			objects.push({
				type: TEXT,
				id: `comment-${c.id}`,
				pageIndex: a.pageIndex,
				rect: { origin: a.rect.origin, size: { width: NOTE_SIZE, height: NOTE_SIZE } },
				contents: c.text,
				author: c.user ?? words.unknownAuthor,
				created: new Date(c.created_at),
				modified: new Date(c.modified_at),
				inReplyToId: a.id
			});
		}
	}
	return objects;
}

/** The copy's file name: "<name> (annotated <date>).pdf". */
export function annotatedName(original: string, day: string): string {
	return `${original.replace(/\.pdf$/i, '')} (annotated ${day}).pdf`;
}
