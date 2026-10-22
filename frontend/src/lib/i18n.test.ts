import { describe, expect, it } from 'vitest';
import { detect, LANGUAGES, setLang, t } from './i18n.svelte';
import messages from './messages.json';

describe('messages.json', () => {
	it.each(Object.entries(messages))('%s is translated in every language', (_, message) => {
		for (const lang of Object.keys(LANGUAGES)) {
			expect((message as Record<string, string>)[lang]?.trim()).toBeTruthy();
		}
	});

	it('uses the same placeholders in every language', () => {
		const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();
		for (const message of Object.values(messages)) {
			const [en, ...others] = Object.values(message).map(placeholders);
			for (const p of others) expect(p).toEqual(en);
		}
	});
});

describe('detect', () => {
	it('prefers the saved choice', () => expect(detect('fr', ['en-US'])).toBe('fr'));
	it('ignores an unknown saved value', () => expect(detect('xx', ['fr-CA'])).toBe('fr'));
	it('takes the first supported browser language', () =>
		expect(detect(null, ['de-DE', 'fr-FR', 'en'])).toBe('fr'));
	it('defaults to English', () => expect(detect(null, ['de', 'ja'])).toBe('en'));
});

describe('t', () => {
	it('translates and fills placeholders', () => {
		setLang('fr');
		expect(t('common.password_min', { min: 12 })).toBe('Mot de passe (au moins 12 caractères)');
		setLang('en');
		expect(t('common.password_min', { min: 12 })).toBe('Password (at least 12 characters)');
	});
});
