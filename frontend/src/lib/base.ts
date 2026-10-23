// The app's base path: '' at the domain's root, e.g. '/videoninja' under a
// subfolder (BASE_PATH at build time, vite.config.ts). Every app-absolute URL
// the browser requests or links to goes through url().

export const base: string = __BASE_PATH__;

/** An app path ('/api/catalog', '/schools') as the browser must request it. */
export const url = (path: string) => base + path;
