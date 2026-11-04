import { describe, expect, it } from 'vitest';
import {
	draftFromPdf,
	emptyDraft,
	emptyName,
	FIELDS,
	formatDate,
	parseDate,
	problems,
	ruleOf,
	toDraft,
	toReference,
	TYPES,
	type ReferenceDraft
} from './reference';
import { rules } from '../validation';

const draft = (d: Partial<ReferenceDraft> = {}): ReferenceDraft => ({ ...emptyDraft(), ...d });

describe('the form per type', () => {
	it('every type asks for a title first', () => {
		for (const type of TYPES) expect(FIELDS[type][0]).toBe('title');
	});

	it('each field follows a rule of validation.json', () => {
		expect(ruleOf('URL')).toBe(rules.reference_url);
		expect(ruleOf('language')).toBe(rules.reference_language);
		expect(ruleOf('note')).toBe(rules.reference_note);
		expect(ruleOf('edition')).toBe(rules.reference_short);
		expect(ruleOf('ISBN')).toBe(rules.reference_short);
		expect(ruleOf('publisher')).toBe(rules.reference_text);
	});
});

describe('dates', () => {
	it('a year, a month, a day', () => {
		expect(parseDate('1981')).toEqual({ 'date-parts': [[1981]] });
		expect(parseDate(' 1981-5 ')).toEqual({ 'date-parts': [[1981, 5]] });
		expect(parseDate('1981-05-12')).toEqual({ 'date-parts': [[1981, 5, 12]] });
		for (const bad of ['', 'May 1981', '0', '1981-13', '1981-00', '1981-02-32', '1981-02-00', '12345'])
			expect(parseDate(bad)).toBeNull();
	});

	it('shown back as typed', () => {
		expect(formatDate({ 'date-parts': [[1981, 5, 2]] })).toBe('1981-05-02');
		expect(formatDate(null)).toBe('');
	});
});

describe('draft → CSL', () => {
	it('only the filled fields of its type, names by role, empty rows dropped', () => {
		const d = draft({
			type: 'chapter',
			fields: {
				title: ' The Nine Schools ',
				'container-title': 'Essence of Ninjutsu',
				issued: '1988',
				issue: '3', // not a chapter's field
				publisher: '  '
			},
			names: [
				{ role: 'author', family: 'Hatsumi', given: 'Masaaki', literal: false },
				{ role: 'editor', family: 'Bujinkan', given: 'ignored', literal: true },
				{ role: 'translator', family: 'Hoban', given: '', literal: false },
				emptyName('author')
			]
		});
		expect(toReference(d)).toEqual({
			type: 'chapter',
			title: 'The Nine Schools',
			'container-title': 'Essence of Ninjutsu',
			issued: { 'date-parts': [[1988]] },
			author: [{ family: 'Hatsumi', given: 'Masaaki' }],
			editor: [{ literal: 'Bujinkan' }],
			translator: [{ family: 'Hoban' }]
		});
	});

	it('and back', () => {
		const ref = toReference(
			draft({
				fields: { title: 'Ninjutsu', issued: '1981-05', URL: 'https://x.org' },
				names: [
					{ role: 'author', family: 'Hatsumi', given: 'Masaaki', literal: false },
					{ role: 'editor', family: 'Bujinkan', given: '', literal: true }
				]
			})
		);
		expect(toDraft(ref)).toEqual({
			type: 'book',
			fields: { title: 'Ninjutsu', issued: '1981-05', URL: 'https://x.org' },
			names: [
				{ role: 'author', family: 'Hatsumi', given: 'Masaaki', literal: false },
				{ role: 'editor', family: 'Bujinkan', given: '', literal: true }
			]
		});
		expect(toDraft({ type: 'book', title: 'x', publisher: null, author: [{ family: 'F' }] }).names).toEqual([
			{ role: 'author', family: 'F', given: '', literal: false }
		]);
		expect(toDraft({ type: 'book', title: 'x', author: [{}] }).names[0].family).toBe('');
	});

	it('from the PDF’s own metadata', () => {
		expect(draftFromPdf('Ninjutsu', 'Masaaki Hatsumi')).toEqual({
			type: 'book',
			fields: { title: 'Ninjutsu' },
			names: [{ role: 'author', family: 'Masaaki Hatsumi', given: '', literal: true }]
		});
		expect(draftFromPdf(null, null)).toEqual(emptyDraft());
	});
});

describe('problems', () => {
	it('a title is needed; dates, lengths and patterns checked; a given name needs a family name', () => {
		expect(problems(draft())).toEqual({ title: 'books.reference.title_missing' });
		expect(
			problems(
				draft({
					fields: {
						title: 'x',
						issued: 'May',
						edition: 'x'.repeat(rules.reference_short.max_length + 1),
						URL: 'ftp://x',
						language: 'en-GB'
					},
					names: [{ role: 'author', family: '', given: 'Masaaki', literal: false }]
				})
			)
		).toEqual({
			issued: 'books.reference.date_invalid',
			edition: 'books.reference.too_long',
			URL: 'books.reference.invalid',
			names: 'books.reference.family_missing'
		});
		expect(problems(draft({ fields: { title: 'x', issued: '1981' } }))).toEqual({});
	});
});
