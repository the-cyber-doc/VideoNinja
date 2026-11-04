// Fonts for PDFs that do not embed theirs: EmbedPDF's own fallback fonts (Noto, SIL Open
// Font License), served by the app (never a CDN: the CSP allows 'self' only) under
// _app/immutable/pdf-fonts/<their version>/, copied there at build time (vite.config.ts).
// PDFium asks for one only when a page needs it (per character set), and picks the
// nearest weight: the regular and bold weights are enough (the image stays small).
import { url } from '../base';
import { FONT_SETS, fontsPath } from './font-sets';

/** EmbedPDF's fontFallback configuration, pointing at the app's copies. */
export function fontFallback(version: string = __PDF_FONTS_VERSION__) {
	// Absolute: the engine's worker (a blob: URL) resolves nothing relative.
	const base = new URL(url(`/${fontsPath(version)}`), location.href).href;
	const fonts: Record<number, { url: string; weight?: number; italic?: boolean }[]> = {};
	for (const set of FONT_SETS) {
		const variants = set.files.map((f) => ({
			url: `${base}/${set.name}/${f.file}`,
			weight: f.weight,
			italic: f.italic
		}));
		for (const charset of set.charsets) fonts[charset] = variants;
	}
	return { fonts };
}
