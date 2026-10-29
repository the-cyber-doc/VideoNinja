// Components take their colours and spacing from app.css's tokens (theme-aware, one
// scale): no colour literal in a component's <style>, no raw gap / margin / padding /
// offset, no font size off the type scale (--text-*) anywhere.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('..', import.meta.url).pathname;
const EXCEPTIONS = ['lib/Flag.svelte']; // a flag's colours are the flag's (in its SVG, not its style)

function svelteFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? svelteFiles(path) : name.endsWith('.svelte') ? [path] : [];
	});
}

describe('styles', () => {
	it('no colour literal in a component (tokens of app.css instead)', () => {
		const offenders = svelteFiles(SRC)
			.map((path) => relative(SRC, path))
			.filter((path) => !EXCEPTIONS.includes(path))
			.flatMap((path) => {
				const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(readFileSync(join(SRC, path), 'utf8'))?.[1] ?? '';
				const found = style.match(/#[0-9a-f]{3,8}\b|\b(rgb|hsl)a?\([^)]*\)/gi) ?? [];
				// A colour computed from a variable (hsl(var(--hue) …): each timeline segment its own) is no literal.
				return found.filter((colour) => !colour.includes('var(')).map((colour) => `${path}: ${colour}`);
			});
		expect(offenders).toEqual([]);
	});

	it('every gap, margin, padding and offset is on the spacing scale (--space-*)', () => {
		const SPACING =
			/^\s*(gap|row-gap|column-gap|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|inset|top|right|bottom|left)\s*:\s*([^;]+);/gm;
		const files = [...svelteFiles(SRC).map((path) => relative(SRC, path)), 'app.css'];
		const offenders = files.flatMap((path) => {
			const text = readFileSync(join(SRC, path), 'utf8');
			const style = path.endsWith('.css')
				? text.slice(text.indexOf('* {'))
				: (/<style[^>]*>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? '');
			return [...style.matchAll(SPACING)]
				.filter(([, , value]) => /(^|[\s(,-])\d*\.?\d+(rem|px|em)\b/.test(value.replace(/var\([^)]*\)/g, '')))
				.map(([line]) => `${path}: ${line.trim()}`);
		});
		expect(offenders).toEqual([]);
	});

	it('every font size is on the type scale (--text-*)', () => {
		const files = [...svelteFiles(SRC).map((path) => relative(SRC, path)), 'app.css'];
		const offenders = files.flatMap((path) => {
			const text = readFileSync(join(SRC, path), 'utf8');
			const style = path.endsWith('.css')
				? text.slice(text.indexOf('* {'))
				: (/<style[^>]*>([\s\S]*?)<\/style>/.exec(text)?.[1] ?? '');
			return [...style.matchAll(/^\s*font-size\s*:\s*([^;]+);/gm)]
				.filter(([, value]) => !/^(var\(--text-[a-z]+\)|inherit)$/.test(value.trim()))
				.map(([line]) => `${path}: ${line.trim()}`);
		});
		expect(offenders).toEqual([]);
	});
});
