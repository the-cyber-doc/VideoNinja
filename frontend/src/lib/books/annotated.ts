// A book's annotations as the PDF annotations of a downloaded copy: each row's own (where
// and how the viewer drew it), with its author, its dates and, as its contents, its
// technique and note. Pure: the engine writes them (pdf.ts annotatedCopy).
import type { BookAnnotation } from '../api/types';
import { revive, type PdfAnnotation } from './annotations.svelte';

export interface Words {
	/** "Technique: <kanji> <romaji> — <its page's address>", or null when there is none. */
	technique: (id: string) => string | null;
	/** The name of a deleted user. */
	unknownAuthor: string;
}

export function annotatedObjects(rows: BookAnnotation[], words: Words): PdfAnnotation[] {
	return rows.map((row) => {
		const a = revive(row.target);
		const contents = [row.technique && words.technique(row.technique), row.note].filter(Boolean).join('\n\n');
		return {
			...a,
			author: row.created_by ?? words.unknownAuthor,
			created: new Date(row.created_at),
			modified: new Date(row.modified_at),
			...(contents && { contents })
		};
	});
}

/** The copy's file name: "<name> (annotated <date>).pdf". */
export function annotatedName(original: string, day: string): string {
	return `${original.replace(/\.pdf$/i, '')} (annotated ${day}).pdf`;
}
