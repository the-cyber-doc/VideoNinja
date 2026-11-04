// The annotations of a PDF, read in Node with EmbedPDF's own PDFium (the app's engine):
// what a downloaded copy really holds, independently of the page that wrote it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { init } from '@embedpdf/pdfium';
import { PdfEngine, PdfiumNative } from '@embedpdf/engines/pdfium';

const require = createRequire(import.meta.url);

export interface ReadAnnotation {
	type: number;
	id: string;
	author?: string;
	contents?: string;
	/** The colour drawn (a highlight's markup, a square's outline). */
	strokeColor?: string;
	inReplyToId?: string;
}

export async function pdfAnnotations(bytes: Buffer): Promise<ReadAnnotation[]> {
	const wasmBinary = readFileSync(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
	const native = new PdfiumNative(await init({ wasmBinary }), { fontFallback: null });
	const engine = new PdfEngine(native, { imageConverter: async () => new Blob() });
	const content = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) as ArrayBuffer;
	const doc = await engine.openDocumentBuffer({ id: 'read', content }).toPromise();
	const found: ReadAnnotation[] = [];
	for (const page of doc.pages) found.push(...((await engine.getPageAnnotations(doc, page).toPromise()) as never[]));
	await engine.closeDocument(doc).toPromise();
	return found;
}
