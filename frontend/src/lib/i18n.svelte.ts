// UI translations. Every message, in every language, is in messages.json:
// { "key": { "en": "…", "fr": "…" } }, with {name} placeholders.
// Content (school descriptions, role names…) is translated by the backend,
// from the Accept-Language header that api.ts sends with every request.
import messages from './messages.json';

/** Supported languages, each named in its own language (for the language menu). */
export const LANGUAGES = { en: 'English', fr: 'Français' } as const;
export type Lang = keyof typeof LANGUAGES;
export type MessageKey = keyof typeof messages;

const DEFAULT: Lang = 'en';
const STORAGE_KEY = 'lang';

export const isLang = (value: unknown): value is Lang =>
	typeof value === 'string' && Object.hasOwn(LANGUAGES, value);

/** The language chosen in the menu, else the browser's (system's) first supported one, else English. */
export function detect(saved: string | null, preferred: readonly string[]): Lang {
	if (isLang(saved)) return saved;
	for (const tag of preferred) {
		const lang = tag.split('-')[0].toLowerCase();
		if (isLang(lang)) return lang;
	}
	return DEFAULT;
}

function saved(): string | null {
	try {
		return localStorage.getItem(STORAGE_KEY);
	} catch {
		return null; // storage blocked (private mode, site data disabled)
	}
}

export const i18n = $state<{ lang: Lang }>({
	lang: detect(saved(), globalThis.navigator?.languages ?? [])
});

// <html lang>: screen readers, hyphenation and spell-checking follow it.
const setHtmlLang = () => {
	if (typeof document !== 'undefined') document.documentElement.lang = i18n.lang;
};
setHtmlLang();

export function setLang(lang: Lang) {
	i18n.lang = lang;
	setHtmlLang();
	try {
		localStorage.setItem(STORAGE_KEY, lang);
	} catch {
		// not remembered: detected again on the next visit
	}
}

/** The message in the current language (English if missing), placeholders filled in. */
export function t(key: MessageKey, params: Record<string, string | number> = {}): string {
	const message: Record<string, string> = messages[key];
	const text = message[i18n.lang] ?? message[DEFAULT];
	return text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match));
}
