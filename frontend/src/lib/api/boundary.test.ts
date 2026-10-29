// Every API call goes through a module of lib/api/: the components and pages hold no
// API URL and do not call the transport (client.ts) themselves.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('../..', import.meta.url).pathname;
const OUTSIDE = ['lib/api/', 'service-worker/']; // the transport and its modules; the SW proxies requests

function files(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? files(path) : /\.(ts|svelte)$/.test(name) ? [path] : [];
	});
}

describe('API boundary', () => {
	it('no API URL or transport call outside lib/api/', () => {
		const offenders = files(SRC)
			.map((path) => relative(SRC, path))
			.filter((path) => !OUTSIDE.some((dir) => path.startsWith(dir)) && !path.endsWith('.test.ts'))
			.filter((path) => {
				const code = readFileSync(join(SRC, path), 'utf8').replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, '');
				return /['"`]\/api\//.test(code) || /\b(api|ndjson)\s*[<(]/.test(code);
			});
		expect(offenders).toEqual([]);
	});
});
