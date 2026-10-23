// Main navigation, centred in the header. One entry per page: add new pages here.
import type { MessageKey } from './i18n.svelte';
import { url } from './base';

export interface NavEntry {
	href: string;
	label: MessageKey;
	/** Shown only with this access (only hides the entry: the API enforces it). */
	access?: string;
}

export const NAV: NavEntry[] = [
	{ href: url('/schools'), label: 'nav.schools' },
	{ href: url('/upload'), label: 'nav.upload', access: 'upload' },
	{ href: url('/videos'), label: 'nav.videos', access: 'video_mgmt' }
];
