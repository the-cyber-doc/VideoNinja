// The fallback fonts the build copies (vite.config.ts) and the viewer asks for (fonts.ts):
// EmbedPDF's own (Noto, SIL Open Font License), their regular and bold weights. No app
// code here (the build imports it).
import { FontCharset } from '@embedpdf/models';
import { fonts as arabic } from '@embedpdf/fonts-arabic';
import { fonts as hebrew } from '@embedpdf/fonts-hebrew';
import { fonts as jp } from '@embedpdf/fonts-jp';
import { fonts as kr } from '@embedpdf/fonts-kr';
import { fonts as latin } from '@embedpdf/fonts-latin';
import { fonts as sc } from '@embedpdf/fonts-sc';
import { fonts as tc } from '@embedpdf/fonts-tc';

interface FontFile {
	file: string;
	weight?: number;
	italic?: boolean;
}

/** The weights kept: regular and bold (italic too, for Latin). */
const kept = (list: readonly FontFile[]) =>
	list.filter((f) => f.weight === undefined || f.weight === 400 || f.weight === 700);

/** Each set: its folder, its files (the packages' own lists), the character sets it covers. */
export const FONT_SETS = [
	{ name: 'jp', files: kept(jp), charsets: [FontCharset.SHIFTJIS] },
	{ name: 'kr', files: kept(kr), charsets: [FontCharset.HANGEUL] },
	{ name: 'sc', files: kept(sc), charsets: [FontCharset.GB2312] },
	{ name: 'tc', files: kept(tc), charsets: [FontCharset.CHINESEBIG5] },
	{ name: 'arabic', files: kept(arabic), charsets: [FontCharset.ARABIC] },
	{ name: 'hebrew', files: kept(hebrew), charsets: [FontCharset.HEBREW] },
	{ name: 'latin', files: kept(latin), charsets: [FontCharset.CYRILLIC, FontCharset.GREEK, FontCharset.VIETNAMESE] }
] as const;

/** Where the build puts them (vite.config.ts), under the app's base: a new version, a new folder. */
export const fontsPath = (version: string) => `_app/immutable/pdf-fonts/${version}`;
