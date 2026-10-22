// Main navigation, centred in the header. One entry per page: add new pages here.
import type { MessageKey } from './i18n.svelte';

export interface NavEntry {
	href: string;
	label: MessageKey;
	/** Shown only with this access (only hides the entry: the API enforces it). */
	access?: string;
}

export const NAV: NavEntry[] = [{ href: '/schools', label: 'nav.schools' }];
