import { afterEach, describe, expect, it, vi } from 'vitest';
import { detect, i18n, LANGUAGES, setLang, t, type Lang } from './i18n.svelte';
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
	it('takes the first supported browser language', () => expect(detect(null, ['de-DE', 'fr-FR', 'en'])).toBe('fr'));
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

describe('t fallbacks', () => {
	it('English for a language without the message; unknown placeholders left as they are', () => {
		i18n.lang = 'de' as Lang; // none of its messages
		expect(t('common.password_min', { min: 12 })).toBe('Password (at least 12 characters)');
		setLang('en');
		expect(t('common.password_min')).toBe('Password (at least {min} characters)');
	});
});

describe('at start', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('without a browser (no navigator): English; with a page: <html lang> set', async () => {
		vi.resetModules();
		vi.stubGlobal('navigator', undefined);
		const root = { lang: '' };
		vi.stubGlobal('document', { documentElement: root });
		const fresh = await import('./i18n.svelte');
		expect(fresh.i18n.lang).toBe('en');
		expect(root.lang).toBe('en');
		fresh.setLang('fr');
		expect(root.lang).toBe('fr');
	});
});
