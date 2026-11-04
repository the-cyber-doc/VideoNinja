// Chicago bibliography entries (CMOS 18, chapter 14's patterns), in English and French.
import { describe, expect, it } from 'vitest';
import type { Reference } from '../api/types';
import messages from '../messages.json';
import type { MessageKey } from '../i18n.svelte';
import { citation, citationText, creators, joinNames, nameOf, ordinal, year } from './citation';

const words =
	(lang: 'en' | 'fr') =>
	(key: MessageKey, params: Record<string, string | number> = {}) =>
		Object.entries(params).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), messages[key][lang]);
const en = (ref: Reference) => citationText(citation(ref, 'en', words('en')));
const fr = (ref: Reference) => citationText(citation(ref, 'fr', words('fr')));

const HATSUMI = { family: 'Hatsumi', given: 'Masaaki' };
const BOOK: Reference = {
	type: 'book',
	title: 'Ninjutsu: History and Tradition',
	author: [HATSUMI],
	publisher: 'Unique Publications',
	'publisher-place': 'Burbank, CA',
	issued: { 'date-parts': [[1981]] }
};

describe('a book', () => {
	it('author. Title. Place: Publisher, Year.', () => {
		expect(en(BOOK)).toBe('Hatsumi, Masaaki. Ninjutsu: History and Tradition. Burbank, CA: Unique Publications, 1981.');
	});

	it('the title in italics, nothing else', () => {
		const runs = citation(BOOK, 'en', words('en'));
		expect(runs.filter((r) => r.italic).map((r) => r.text)).toEqual(['Ninjutsu: History and Tradition']);
	});

	it('several authors: the first inverted, the serial comma in English, not in French', () => {
		const three = { ...BOOK, author: [HATSUMI, { given: 'Stephen K.', family: 'Hayes' }, { literal: 'Bujinkan' }] };
		expect(en(three)).toMatch(/^Hatsumi, Masaaki, Stephen K. Hayes, and Bujinkan\. /);
		expect(fr(three)).toMatch(/^Hatsumi, Masaaki, Stephen K. Hayes et Bujinkan\. /);
		const two = { ...BOOK, author: [HATSUMI, { given: 'Stephen K.', family: 'Hayes' }] };
		expect(en(two)).toMatch(/^Hatsumi, Masaaki and Stephen K. Hayes\. /);
	});

	it('more than six authors: three, then et al.', () => {
		const many = { ...BOOK, author: Array.from({ length: 7 }, (_, i) => ({ family: `F${i}`, given: `G${i}` })) };
		expect(en(many)).toMatch(/^F0, G0, G1 F1, G2 F2, et al\. Ninjutsu/);
	});

	it('editors lead without authors; translators, edition, volume, series after the title', () => {
		const ref: Reference = {
			...BOOK,
			author: undefined,
			editor: [{ family: 'Nakamura', given: 'Kenji' }, { literal: 'Bujinkan Dōjō' }],
			translator: [{ given: 'Jack', family: 'Hoban' }],
			edition: '2',
			volume: '3',
			'collection-title': 'Densho Studies',
			'collection-number': '7'
		};
		expect(en(ref)).toBe(
			'Nakamura, Kenji and Bujinkan Dōjō, eds. Ninjutsu: History and Tradition. Translated by Jack Hoban. 2nd ed. Vol. 3. Densho Studies 7. Burbank, CA: Unique Publications, 1981.'
		);
		expect(fr({ ...ref, editor: [{ family: 'Nakamura', given: 'Kenji' }] })).toBe(
			'Nakamura, Kenji, dir. Ninjutsu: History and Tradition. Traduit par Jack Hoban. 2e éd. Vol. 3. Densho Studies 7. Burbank, CA: Unique Publications, 1981.'
		);
	});

	it('editors after the title when there are authors; an edition as typed; first publication; a DOI', () => {
		const ref: Reference = {
			...BOOK,
			editor: [{ given: 'Ben', family: 'Jones' }],
			edition: 'Rev. ed.',
			'original-title': '忍術',
			'original-date': { 'date-parts': [[1975]] },
			DOI: '10.1000/xyz'
		};
		expect(en(ref)).toBe(
			'Hatsumi, Masaaki. Ninjutsu: History and Tradition [忍術]. Edited by Ben Jones. Rev. ed. Burbank, CA: Unique Publications, 1981. First published 1975. https://doi.org/10.1000/xyz.'
		);
		expect(en({ ...BOOK, DOI: 'https://doi.org/10.1/a' })).toMatch(/1981\. https:\/\/doi\.org\/10\.1\/a\.$/);
		expect(en({ ...BOOK, URL: 'https://example.org/b' })).toMatch(/1981\. https:\/\/example\.org\/b\.$/);
	});

	it('what is missing is left out', () => {
		expect(en({ type: 'book', title: 'Densho' })).toBe('Densho.');
		expect(en({ type: 'book', title: 'Densho', publisher: 'Kodansha' })).toBe('Densho. Kodansha.');
		expect(en({ type: 'book', title: 'Densho', 'publisher-place': 'Tokyo' })).toBe('Densho. Tokyo.');
		expect(en({ type: 'book', title: 'Densho', issued: { 'date-parts': [[1990]] } })).toBe('Densho. 1990.');
		expect(en({ type: 'book', title: 'What is Budō?' })).toBe('What is Budō?');
	});
});

describe('parts of other works', () => {
	it('a chapter: “Title.” In Book, edited by …, pages.', () => {
		const ref: Reference = {
			type: 'chapter',
			title: 'The Nine Schools',
			author: [HATSUMI],
			'container-title': 'Essence of Ninjutsu',
			editor: [{ given: 'Ben', family: 'Jones' }],
			page: '12–34',
			publisher: 'Contemporary Books',
			'publisher-place': 'Chicago',
			issued: { 'date-parts': [[1988]] }
		};
		expect(en(ref)).toBe(
			'Hatsumi, Masaaki. “The Nine Schools.” In Essence of Ninjutsu, edited by Ben Jones, 12–34. Chicago: Contemporary Books, 1988.'
		);
		expect(fr(ref)).toBe(
			'Hatsumi, Masaaki. « The Nine Schools ». Dans Essence of Ninjutsu, sous la direction de Ben Jones, 12–34. Chicago: Contemporary Books, 1988.'
		);
		expect(citation(ref, 'en', words('en')).find((r) => r.italic)?.text).toBe('Essence of Ninjutsu');
		expect(en({ type: 'chapter', title: 'Why?' })).toBe('“Why?”');
		expect(en({ type: 'chapter', title: 'Kata', 'container-title': 'Budō' })).toBe('“Kata.” In Budō.');
	});

	it('an article: “Title.” Journal volume, no. issue (Year): pages.', () => {
		const ref: Reference = {
			type: 'article-journal',
			title: 'Koryū Today',
			author: [{ given: 'Ellis', family: 'Amdur' }],
			'container-title': 'Journal of Asian Martial Arts',
			volume: '12',
			issue: '3',
			page: '8–29',
			issued: { 'date-parts': [[2003, 5]] }
		};
		expect(en(ref)).toBe('Amdur, Ellis. “Koryū Today.” Journal of Asian Martial Arts 12, no. 3 (2003): 8–29.');
		expect(en({ type: 'article-journal', title: 'Koryū', 'container-title': 'Budō' })).toBe('“Koryū.” Budō.');
		expect(en({ type: 'article-journal', title: 'Koryū', page: '3' })).toBe('“Koryū.” 3.');
	});

	it('a thesis and a manuscript', () => {
		const thesis: Reference = {
			type: 'thesis',
			title: 'Ninja in History',
			author: [{ literal: 'Kawakami Jinichi' }],
			genre: 'PhD diss.',
			publisher: 'Mie University',
			issued: { 'date-parts': [[2015]] }
		};
		expect(en(thesis)).toBe('Kawakami Jinichi. “Ninja in History.” PhD diss., Mie University, 2015.');
		const scroll: Reference = {
			type: 'manuscript',
			title: 'Togakure-ryū Ninpō Taijutsu Densho',
			issued: { 'date-parts': [[1800]] },
			archive: 'Bujinkan Honbu Dōjō',
			'archive-place': 'Noda'
		};
		expect(en(scroll)).toBe('“Togakure-ryū Ninpō Taijutsu Densho.” Manuscript, 1800. Bujinkan Honbu Dōjō, Noda.');
		expect(fr({ ...scroll, issued: undefined, genre: 'Makimono' })).toBe(
			'« Togakure-ryū Ninpō Taijutsu Densho ». Makimono. Bujinkan Honbu Dōjō, Noda.'
		);
	});
});

describe('helpers', () => {
	it('ordinals', () => {
		expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((n) => ordinal(n, 'en'))).toEqual([
			'1st',
			'2nd',
			'3rd',
			'4th',
			'11th',
			'12th',
			'13th',
			'21st',
			'22nd',
			'23rd',
			'101st',
			'111th'
		]);
		expect([1, 2, 10].map((n) => ordinal(n, 'fr'))).toEqual(['1re', '2e', '10e']);
	});

	it('names, lists of names, years, who wrote it', () => {
		expect([nameOf({ family: 'Hatsumi' }), nameOf({ family: 'Hatsumi' }, true), nameOf({})]).toEqual([
			'Hatsumi',
			'Hatsumi',
			''
		]);
		expect(joinNames(['A'], 'en', words('en'))).toBe('A');
		expect([year(undefined), year(null), year({ 'date-parts': [[]] }), year(BOOK.issued)]).toEqual([
			undefined,
			undefined,
			undefined,
			1981
		]);
		expect(creators(BOOK, 'en', words('en'))).toBe('Masaaki Hatsumi');
		expect(creators({ ...BOOK, author: [], editor: [{ literal: 'Bujinkan' }] }, 'en', words('en'))).toBe('Bujinkan');
		expect(creators({ type: 'book', title: 'x' }, 'en', words('en'))).toBe('');
	});
});
