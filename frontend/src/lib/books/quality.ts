// Whether a highlight's quote looks unreadable. Some PDFs embed fonts without a map from
// their character codes to letters: every reader (and EmbedPDF) then extracts the raw
// codes, often the letters shifted by a constant ("DLUFRQGLWLRQHUV" for
// "airconditioners"), with control characters for the spaces. A heuristic: it flags such
// text, and may miss short fragments or flag rare odd text.

/** Control characters (but tab and line ends), the replacement character, private use. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what it looks for
const BROKEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F�-]/u;
const LATIN_WORD = /[\p{Script=Latin}]+/gu;
const VOWELS = /[aeiouyàâäéèêëîïôöùûüAEIOUYÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/gu;
const UPPER = /\p{Lu}/gu;

/** A run of Latin letters that no language writes: long, almost all capitals, almost no vowels;
 * or very long without a break. */
function garbledWord(word: string): boolean {
	if (word.length >= 25) return true;
	if (word.length < 3) return false;
	const upper = (word.match(UPPER) ?? []).length / word.length;
	const vowels = (word.match(VOWELS) ?? []).length / word.length;
	return upper >= 0.8 && vowels < 0.2;
}

export function looksGarbled(text: string | null | undefined): boolean {
	if (!text) return false;
	if (BROKEN.test(text)) return true;
	const words = text.match(LATIN_WORD) ?? [];
	const letters = words.reduce((n, w) => n + w.length, 0);
	if (!letters) return false; // no Latin text (Japanese…): nothing to judge
	const garbled = words.filter(garbledWord).reduce((n, w) => n + w.length, 0);
	return garbled / letters >= 0.3;
}
