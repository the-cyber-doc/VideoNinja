// The shared components are used: errors shown through ErrorMessage (announced, with
// the request ID of a server failure), icon-only buttons through IconButton (one label
// for both the tooltip and the accessible name).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('..', import.meta.url).pathname;
// Widgets with their own markup (a flag menu, a progress ring): they label themselves.
const OWN_BUTTONS = ['lib/LanguageMenu.svelte', 'lib/OfflineToggle.svelte'];

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? svelteFiles(path) : name.endsWith('.svelte') ? [path] : [];
	});
}
const markup = (path: string) => readFileSync(join(SRC, path), 'utf8').replace(/<style[\s\S]*?<\/style>/, '');
const files = svelteFiles(SRC).map((path) => relative(SRC, path));

describe('shared components', () => {
	it('errors are shown through ErrorMessage', () => {
		const offenders = files.filter((path) => path !== 'lib/ErrorMessage.svelte' && /class="error/.test(markup(path)));
		expect(offenders).toEqual([]);
	});

	it('icon-only buttons are IconButtons (the same title and aria-label written twice)', () => {
		const offenders = files
			.filter((path) => path !== 'lib/IconButton.svelte' && !OWN_BUTTONS.includes(path))
			.flatMap((path) =>
				[...markup(path).matchAll(/<button\b([^>]*?)>/gs)]
					.map(([, attrs]) => [/\btitle=(\{[^}]*\}|"[^"]*")/.exec(attrs)?.[1], /\baria-label=(\{[^}]*\}|"[^"]*")/.exec(attrs)?.[1]])
					.filter(([title, label]) => title && title === label)
					.map(([title]) => `${path}: ${title}`)
			);
		expect(offenders).toEqual([]);
	});
});
