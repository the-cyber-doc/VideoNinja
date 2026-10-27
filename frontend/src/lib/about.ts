// What the About page shows about this build (set at build time, vite.config.ts).
/** The release ("0.0.5", the Docker images' tag) or "dev". */
export const version: string = __APP_VERSION__;
/** Short commit SHA ("-dirty": built with uncommitted changes). */
export const build: string = __APP_BUILD__;
export const buildDate = new Date(__BUILD_DATE__);

export const GITHUB_URL = 'https://github.com/the-cyber-doc/VideoNinja';
export const LICENSE_URL = `${GITHUB_URL}/blob/main/LICENSE`;
// The four images (videoninja-nginx, -api, -encoder, -tusd).
export const DOCKER_URL = 'https://hub.docker.com/u/thecyberdoc';
export const COPYRIGHT_HOLDER = 'the-cyber-doc';
