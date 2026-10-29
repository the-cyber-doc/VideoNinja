// Lint rules (bugs and suspicious code); the layout is Prettier's (.prettierrc), the
// types svelte-check's (`npm run check`).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import ts from 'typescript-eslint';

export default defineConfig(
	globalIgnores([
		'build/',
		'build-*/',
		'.svelte-kit/',
		'.svelte-kit-*/',
		'coverage/',
		'test-results/',
		'playwright-report/',
		'src/lib/api/schema.d.ts'
	]),
	js.configs.recommended,
	ts.configs.recommended,
	svelte.configs.recommended,
	prettier,
	svelte.configs.prettier,
	{
		languageOptions: { globals: { ...globals.browser, ...globals.node } },
		rules: {
			// TypeScript already reports undefined names (and knows the types' globals).
			'no-undef': 'off',
			// `{ dropped: _, ...kept }`: leaving a property out on purpose.
			'@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
			// Every app URL goes through $lib/base.ts url() (the base path), not resolve().
			'svelte/no-navigation-without-resolve': 'off',
			// Reads the reason after the codes (`a11y_autofocus: opened by the user`) as more codes.
			'svelte/no-unused-svelte-ignore': 'off'
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts'],
		languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] } }
	},
	{
		// Modules keep plain caches and functions' temporary sets; what pages must see
		// is a SvelteSet / SvelteMap / $state on purpose (e.g. offline.svelte.ts `saved`).
		files: ['**/*.svelte.ts'],
		rules: { 'svelte/prefer-svelte-reactivity': 'off' }
	}
);
