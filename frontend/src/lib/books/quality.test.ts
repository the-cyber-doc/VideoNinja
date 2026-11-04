// Unreadable quotes: text a PDF gives without a character map for its font.
import { describe, expect, it } from 'vitest';
import { looksGarbled } from './quality';

describe('looksGarbled', () => {
	it('the codes of a font without its map: shifted letters, control characters for spaces', () => {
		// From a real PDF (a CPAP manual): "ors, airconditioners). Note: When positioning the device, make sure…"
		expect(looksGarbled('RUV\u000fDLUFRQGLWLRQHUV \u0011 Note: :KHQSRVLWLRQLQJWKHGHYLFH')).toBe(true);
		expect(looksGarbled('3ODFHWKHGHYLFHRQDÀUPÁDWVXUIDFHVRPHZKHUH only way to turn off the device.')).toBe(true);
		expect(looksGarbled('KDQGOH WKH PDVN FDUHIXOOB')).toBe(true); // shifted, spaces kept
		expect(looksGarbled('text � lost')).toBe(true);
	});

	it('real text, in any language, acronyms and all', () => {
		for (const text of [
			'The device should be used only with masks and connectors recommended by Philips Respironics.',
			'Togakure-ryu Ninpō Taijutsu: the CPAP and BPAP devices (NATO, UNESCO, HTTPS).',
			'L’école du tigre de jade, Gyokko-ryū Kosshijutsu.',
			'忍術 秘伝',
			'Strengths',
			'',
			null,
			undefined
		])
			expect(looksGarbled(text), String(text)).toBe(false);
	});
});
