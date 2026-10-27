// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	/** BASE_PATH at build time (vite.config.ts): use $lib/base.ts. */
	const __BASE_PATH__: string;
	/** Version, commit and date of the build (vite.config.ts): use $lib/about.ts. */
	const __APP_VERSION__: string;
	const __APP_BUILD__: string;
	const __BUILD_DATE__: string;

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
